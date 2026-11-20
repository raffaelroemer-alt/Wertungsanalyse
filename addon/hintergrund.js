// Hintergrundskript (Service Worker in Chrome, Hintergrundseite in Firefox): startet die Analyse auf Klick, ruft die Anthropic-API auf und
// speichert Ergebnisse je Adresse. Der API-Schlüssel liegt nur in chrome.storage.local.

const VORGABEN = { modell: "claude-opus-5-5", effort: "high" };
const API = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2026-10-21";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
// Modelle, die den serverseitigen Ersatz bei Ablehnung ("fallbacks": "default") annehmen
const MIT_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-fable-5-2", "claude-sonnet-5-5"]);
// US-Dollar je Million Tokens: Eingabe, Ausgabe, Cache-Lesen (nur zur Schätzung, wie wertung.py)
const PREISE = {
  "claude-opus-5-5": [4, 20, 0.2], "claude-opus-5": [5, 25, 0.5], "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-sonnet-5": [2, 10, 0.2], "claude-haiku-5-5": [0.1, 0.5, 0.01], "claude-fable-5-2": [8, 40, 0.2],
};
const MAX_TOKENS = 32000;
const MAX_ZEICHEN = 150000;

class Fehler extends Error {
  constructor(code, text) { super(text); this.code = code; }
}

// ---------------------------------------------------------------- Klick auf das Symbol

chrome.action.onClicked.addListener(async (tab) => {
  if (!/^https?:/.test(tab.url || "")) {
    hinweisAmSymbol(tab.id, "Auf dieser Seite kann nichts analysiert werden (nur http/https).");
    return;
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["markierung.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lib/Readability.js", "gemeinsam.js", "inhalt.js"] });
  } catch (e) {
    hinweisAmSymbol(tab.id, "Diese Seite lässt keine Erweiterungen zu: " + e.message);
  }
});

// Firefox für Android kennt kein Abzeichen am Symbol: jeden Aufruf einzeln absichern
function hinweisAmSymbol(tabId, text) {
  const versuchen = (f) => { try { Promise.resolve(f()).catch(() => {}); } catch { /* nicht unterstützt */ } };
  versuchen(() => chrome.action.setBadgeBackgroundColor({ tabId, color: "#b00020" }));
  versuchen(() => chrome.action.setBadgeText({ tabId, text: "!" }));
  versuchen(() => chrome.action.setTitle({ tabId, title: text }));
  setTimeout(() => {
    versuchen(() => chrome.action.setBadgeText({ tabId, text: "" }));
    versuchen(() => chrome.action.setTitle({ tabId, title: "Artikel auf Wertung analysieren" }));
  }, 6000);
}

chrome.runtime.onMessage.addListener((nachricht, absender, antworten) => {
  if (nachricht?.art === "einstellungen_oeffnen") chrome.runtime.openOptionsPage();
  if (nachricht?.art === "bericht_oeffnen") {
    // Antwort an die Leiste, damit ein Fehler dort sichtbar wird statt still zu verschwinden
    berichtOeffnen(nachricht.daten, absender.tab).then(
      () => antworten({ ok: true }),
      (e) => antworten({ ok: false, text: (e && e.message) || String(e) }));
    return true; // Antwort kommt asynchron
  }
});

// Bericht: Daten unter eigener Nummer ablegen (nur die letzten fünf bleiben), Druckansicht neben dem Artikel öffnen
const BERICHTE_BEHALTEN = 5;
async function berichtOeffnen(daten, tab) {
  const id = Date.now().toString(36);
  const alt = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith("bericht:")).sort();
  await chrome.storage.local.remove(alt.slice(0, Math.max(0, alt.length - (BERICHTE_BEHALTEN - 1))));
  await chrome.storage.local.set({ ["bericht:" + id]: daten });
  const url = chrome.runtime.getURL("bericht.html?id=" + id);
  try {
    await chrome.tabs.create({ url, ...(tab ? { index: tab.index + 1, openerTabId: tab.id } : {}) });
  } catch {
    // Firefox für Android kennt openerTabId nicht und lehnt dann den ganzen Aufruf ab: nur mit der Adresse öffnen
    await chrome.tabs.create({ url });
  }
}

// ---------------------------------------------------------------- Analyse über einen Port

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "analyse") return;
  const abbruch = new AbortController();
  port.onDisconnect.addListener(() => abbruch.abort());
  port.onMessage.addListener(async (nachricht) => {
    if (nachricht.art !== "start" && nachricht.art !== "spiegel") return;
    const senden = (inhalt) => { try { port.postMessage(inhalt); } catch { /* Tab geschlossen */ } };
    try {
      const schluessel = speicherSchluessel(nachricht.url);
      const spiegelSchluessel = schluessel.replace(/^ergebnis:/, "spiegel:");
      if (nachricht.art === "spiegel") {
        const spiegel = await spiegelprobe(nachricht.text, senden, abbruch.signal);
        await chrome.storage.local.set({ [spiegelSchluessel]: spiegel });
        senden({ art: "spiegel_fertig", spiegel });
        return;
      }
      const gemerkterSpiegel = (await chrome.storage.local.get(spiegelSchluessel))[spiegelSchluessel] || null;
      if (!nachricht.neu) {
        const gemerkt = (await chrome.storage.local.get(schluessel))[schluessel];
        if (gemerkt) { senden({ art: "fertig", ergebnis: gemerkt, spiegel: gemerkterSpiegel, ausSpeicher: true }); return; }
      }
      const ergebnis = await analysieren(nachricht.text, (stand) => senden({ art: "stand", ...stand }), abbruch.signal);
      ergebnis.url = nachricht.url;
      if (nachricht.tv) ergebnis.tv = nachricht.tv; // Fernsehbeitrag: Absätze mit Zeiten für die Redezeit
      await chrome.storage.local.set({ [schluessel]: ergebnis });
      senden({ art: "fertig", ergebnis, spiegel: gemerkterSpiegel, ausSpeicher: false });
    } catch (e) {
      if (abbruch.signal.aborted) return;
      senden({ art: "fehler", code: e.code || "unbekannt", text: e.message });
    }
  });
});

// Ergebnisse je Adresse: ohne Sprungmarke und ohne Verfolgungsparameter
function speicherSchluessel(url) {
  const u = new URL(url);
  u.hash = "";
  for (const name of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_|wt_|ref$|at_)/i.test(name)) u.searchParams.delete(name);
  }
  return "ergebnis:" + u.toString();
}

// Die Analyse läuft ohne erzwungenes Format: Ihr Schema ist für die Grammatik der API zu groß
// ("compiled grammar is too large"). Das Schema steht im Prompt, die Antwort wird gegen das volle Schema geprüft.
async function analysieren(text, melden, signal) {
  const { daten, meta } = await apiAufruf("analyse/prompt.md", "analyse/schema.json", text, melden, signal, false);
  return { analyse: daten, meta };
}

// Spiegelprobe: Gegenfassung mit vertauschten Seiten schreiben, dann mit demselben Prompt analysieren.
async function spiegelprobe(text, senden, signal) {
  const schritt = (name) => (stand) => senden({ art: "stand", schritt: name, ...stand });
  const gegen = await apiAufruf("analyse/spiegel_prompt.md", "analyse/spiegel_schema.json", text,
    schritt("Gegenfassung schreiben (1/2)"), signal, true);
  const spiegel = { gegenfassung: gegen.daten, meta_gegenfassung: gegen.meta, analyse: null, meta: null };
  if (gegen.daten.spiegelbar && gegen.daten.text.trim()) {
    const a = await analysieren(gegen.daten.text, schritt("Gegenfassung analysieren (2/2)"), signal);
    spiegel.analyse = a.analyse;
    spiegel.meta = a.meta;
  }
  return spiegel;
}

async function apiAufruf(promptDatei, schemaDatei, text, melden, signal, erzwungen) {
  const einst = { ...VORGABEN, ...(await chrome.storage.local.get(["apiKey", "modell", "effort"])) };
  if (!einst.apiKey) throw new Fehler("schluessel", "Kein API-Schlüssel gespeichert. Bitte auf der Einstellungsseite eintragen.");
  if (text.length > MAX_ZEICHEN) throw new Fehler("zu_lang", `Der Artikel ist zu lang (${text.length} Zeichen, höchstens ${MAX_ZEICHEN}).`);

  const [prompt, schema] = await Promise.all([
    fetch(chrome.runtime.getURL(promptDatei)).then((r) => r.text()),
    fetch(chrome.runtime.getURL(schemaDatei)).then((r) => r.json()),
  ]);
  const anfrage = {
    model: einst.modell,
    max_tokens: MAX_TOKENS,
    stream: true,
    thinking: { type: "adaptive" },
    output_config: erzwungen
      ? { effort: einst.effort, format: { type: "json_schema", schema: apiSchema(schema) } }
      : { effort: einst.effort },
    system: [{ type: "text", text: erzwungen ? prompt : mitSchema(prompt, schema), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `<artikel>\n${text.trim()}\n</artikel>` }],
  };
  const kopf = {
    "content-type": "application/json",
    "x-api-key": einst.apiKey,
    "anthropic-version": API_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (MIT_FALLBACK.has(einst.modell)) {
    anfrage.fallbacks = "default";
    kopf["anthropic-beta"] = FALLBACK_BETA;
  }

  const beginn = Date.now();
  // Hält den Service Worker (Chrome) während langer Anfragen wach; in Firefox tut das das "ping" der Leiste über den Port
  const wach = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20000);
  try {
    melden({ phase: "sendet", sekunden: 0 });
    let antwort;
    try {
      antwort = await fetch(API, { method: "POST", headers: kopf, body: JSON.stringify(anfrage), signal });
    } catch (e) {
      if (signal.aborted) throw e;
      throw new Fehler("netz", "Keine Verbindung zur API (Netzwerk oder Firewall).");
    }
    if (!antwort.ok) throw await apiFehler(antwort, einst.modell);
    const ergebnis = await stromLesen(antwort, melden, beginn);
    const daten = enumsAngleichen(auswerten(ergebnis), schema);
    const fehler = schemaFehler(daten, schema);
    if (fehler.length) {
      throw new Fehler("format", `Die Antwort passt nicht zum Schema (${fehler.length} Stellen): ${fehler.slice(0, 3).join("; ")}`);
    }
    return { daten, meta: metaDaten(ergebnis, einst, beginn) };
  } finally {
    clearInterval(wach);
  }
}

async function apiFehler(antwort, modell) {
  let meldung = "";
  try { meldung = (await antwort.json())?.error?.message || ""; } catch { /* kein JSON */ }
  const s = antwort.status;
  if (s === 401) return new Fehler("schluessel", "Der API-Schlüssel ist ungültig (401). Bitte auf der Einstellungsseite prüfen.");
  if (s === 403) return new Fehler("schluessel", "Der API-Schlüssel hat keine Berechtigung (403).");
  if (s === 404) return new Fehler("modell", `Modell „${modell}“ ist unbekannt (404). Bitte auf der Einstellungsseite ändern.`);
  if (s === 413) return new Fehler("zu_lang", "Der Artikel ist für eine Anfrage zu groß (413).");
  if (s === 429) return new Fehler("limit", "Ratenlimit erreicht (429). Bitte gleich noch einmal versuchen.");
  if (s === 400 && /credit balance/i.test(meldung)) return new Fehler("guthaben", "Das API-Guthaben ist aufgebraucht. Aufladen unter platform.claude.com › Settings › Billing.");
  if (s === 400) return new Fehler("anfrage", "Die API hat die Anfrage abgelehnt (400): " + meldung);
  if (s >= 500) return new Fehler("server", `Die API ist gerade überlastet oder gestört (${s}). Bitte später noch einmal.`);
  return new Fehler("api", `API-Fehler ${s}: ${meldung}`);
}

// Liest die Server-Sent-Events der Antwort und sammelt Text, Modell, Nutzung und Abbruchgrund.
async function stromLesen(antwort, melden, beginn) {
  const leser = antwort.body.getReader();
  const decoder = new TextDecoder();
  const st = { text: "", modell: null, usage: {}, stop: null, phase: "denkt nach" };
  const bloecke = {};
  let puffer = "", letzteMeldung = 0;
  const meldenGedrosselt = (erzwingen) => {
    const jetzt = Date.now();
    if (!erzwingen && jetzt - letzteMeldung < 2000) return;
    letzteMeldung = jetzt;
    melden({ phase: st.phase, sekunden: Math.round((jetzt - beginn) / 1000), zeichen: st.text.length });
  };
  const ticker = setInterval(() => meldenGedrosselt(true), 3000);
  try {
    for (;;) {
      const { value, done } = await leser.read();
      if (done) break;
      puffer += decoder.decode(value, { stream: true });
      let ende;
      while ((ende = puffer.indexOf("\n\n")) >= 0) {
        const roh = puffer.slice(0, ende);
        puffer = puffer.slice(ende + 2);
        const daten = roh.split("\n").filter((z) => z.startsWith("data:")).map((z) => z.slice(5).trim()).join("");
        if (!daten) continue;
        const ev = JSON.parse(daten);
        switch (ev.type) {
          case "message_start":
            st.modell = ev.message.model;
            Object.assign(st.usage, ev.message.usage || {});
            break;
          case "content_block_start":
            bloecke[ev.index] = ev.content_block.type;
            if (ev.content_block.type === "thinking") st.phase = "denkt nach";
            if (ev.content_block.type === "text") st.phase = "schreibt das Ergebnis";
            // Ersatzmodell übernimmt: bisherigen Teiltext verwerfen
            if (ev.content_block.type === "fallback") { st.text = ""; st.phase = "Ersatzmodell übernimmt"; }
            meldenGedrosselt(true);
            break;
          case "content_block_delta":
            if (ev.delta.type === "text_delta" && bloecke[ev.index] === "text") st.text += ev.delta.text;
            meldenGedrosselt(false);
            break;
          case "message_delta":
            if (ev.delta?.stop_reason) st.stop = ev.delta.stop_reason;
            Object.assign(st.usage, ev.usage || {});
            break;
          case "error":
            throw new Fehler(ev.error?.type === "overloaded_error" ? "server" : "api",
              "Fehler während der Antwort: " + (ev.error?.message || "unbekannt"));
        }
      }
    }
  } finally {
    clearInterval(ticker);
  }
  return st;
}

// ---------------------------------------------------------------- Schema (wie wertung.py)

// Die API lehnt zu große Grammatiken ab ("compiled grammar is too large"); enum vergrößert sie stark.
// Deshalb geht das Schema ohne enum an die API, die Antwort wird hier gegen das volle Schema geprüft.
function apiSchema(s) {
  if (Array.isArray(s)) return s.map(apiSchema);
  if (!s || typeof s !== "object") return s;
  const neu = {};
  for (const [k, v] of Object.entries(s)) if (k !== "enum") neu[k] = apiSchema(v);
  if (Array.isArray(s.enum)) neu.description = (s.description ? s.description + ". " : "") + "Erlaubte Werte: " + s.enum.join(", ");
  return neu;
}

const aufloesen = (s, defs) => (s && s.$ref ? defs[s.$ref.split("/").pop()] : s);

// Groß/Klein von enum-Werten angleichen (die API garantiert die Schreibung nicht)
function enumsAngleichen(wert, schema, defs = schema.$defs || {}) {
  const s = aufloesen(schema, defs);
  if (typeof wert === "string" && Array.isArray(s.enum) && !s.enum.includes(wert)) {
    const t = s.enum.find((e) => typeof e === "string" && e.toLowerCase() === wert.trim().toLowerCase());
    return t === undefined ? wert : t;
  }
  if (Array.isArray(wert)) return s.items ? wert.map((x) => enumsAngleichen(x, s.items, defs)) : wert;
  if (wert && typeof wert === "object") {
    const props = s.properties || {};
    return Object.fromEntries(Object.entries(wert).map(([k, v]) => [k, props[k] ? enumsAngleichen(v, props[k], defs) : v]));
  }
  return wert;
}

function schemaFehler(wert, schema, pfad = "$", defs = schema.$defs || {}) {
  const s = aufloesen(schema, defs);
  const typ = s.type;
  const istObjekt = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const passt = { object: istObjekt, array: Array.isArray, string: (x) => typeof x === "string",
    boolean: (x) => typeof x === "boolean", integer: Number.isInteger }[typ];
  if (passt && !passt(wert)) return [`${pfad}: erwartet ${typ}`];
  const f = [];
  if (Array.isArray(s.enum) && !s.enum.includes(wert)) f.push(`${pfad}: ${JSON.stringify(wert)} nicht erlaubt`);
  if (typ === "object") {
    for (const k of s.required || []) if (!(k in wert)) f.push(`${pfad}.${k}: fehlt`);
    if (s.additionalProperties === false) for (const k of Object.keys(wert)) if (!(k in (s.properties || {}))) f.push(`${pfad}.${k}: unbekannt`);
    for (const [k, t] of Object.entries(s.properties || {})) if (k in wert) f.push(...schemaFehler(wert[k], t, `${pfad}.${k}`, defs));
  }
  if (typ === "array" && s.items) wert.forEach((x, i) => f.push(...schemaFehler(x, s.items, `${pfad}[${i}]`, defs)));
  return f;
}

function auswerten(st) {
  if (st.stop === "refusal") throw new Fehler("abgelehnt", "Das Modell hat die Analyse dieses Textes abgelehnt.");
  if (st.stop === "max_tokens") throw new Fehler("abgeschnitten", `Die Antwort wurde abgeschnitten (max_tokens ${MAX_TOKENS}).`);
  try {
    return jsonAusText(st.text);
  } catch {
    throw new Fehler("format", "Die Antwort war kein gültiges JSON.");
  }
}

// Prompt plus Schema als Text, für Anfragen ohne erzwungenes Format (wie wertung.py)
function mitSchema(prompt, schema) {
  return `${prompt.trimEnd()}\n\n<schema>\n${JSON.stringify(schema)}\n</schema>\n`;
}

// JSON aus der Antwort, auch wenn das Modell doch eine Codeblock-Markierung oder einen Satz davor schreibt
function jsonAusText(text) {
  const t = text.trim();
  const anfang = t.indexOf("{"), ende = t.lastIndexOf("}");
  if (anfang < 0 || ende < anfang) throw new SyntaxError("kein JSON-Objekt");
  return JSON.parse(t.slice(anfang, ende + 1));
}

function metaDaten(st, einst, beginn) {
  const u = st.usage;
  const [ein, aus, lesen] = PREISE[einst.modell] || [0, 0, 0];
  const kosten = ((u.input_tokens || 0) * ein + (u.cache_creation_input_tokens || 0) * ein * 1.25
    + (u.cache_read_input_tokens || 0) * lesen + (u.output_tokens || 0) * aus) / 1e6;
  return {
    modell_angefragt: einst.modell,
    modell: st.modell,
    effort: einst.effort,
    zeit: new Date().toISOString(),
    dauer_s: Math.round((Date.now() - beginn) / 100) / 10,
    tokens: { eingabe: u.input_tokens, cache_geschrieben: u.cache_creation_input_tokens,
      cache_gelesen: u.cache_read_input_tokens, ausgabe: u.output_tokens },
    kosten_usd_ca: PREISE[einst.modell] ? Math.round(kosten * 10000) / 10000 : null,
  };
}
