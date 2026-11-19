// Inhaltsskript: zieht den Artikeltext mit Readability, schickt ihn zur Analyse ans Hintergrundskript,
// markiert die Fundstellen im Seitentext und zeigt die Seitenleiste. Wird nur auf Klick eingefügt.
(() => {
  if (window.__wertungsanalyse) { window.__wertungsanalyse.klick(); return; }
  const WA = (window.__wertungsanalyse = {});

  const DIM = {
    wortwahl: { name: "Wortwahl", farbe: "rgb(232,128,0)" },
    epistemisch: { name: "Epistemische Rahmung", farbe: "rgb(156,54,181)" },
    quellen: { name: "Quellen & Zuschreibung", farbe: "rgb(28,126,214)" },
    auswahl: { name: "Auswahl & Gewichtung", farbe: "rgb(47,158,68)" },
    ueberschrift: { name: "Überschrift & Vorspann", farbe: "rgb(224,49,49)" },
  };
  const MUSTER = {
    moralische_klammer: "Moralische Klammer",
    moralische_delegitimierung: "Moralische Delegitimierung",
    dichotomie: "Dichotomie",
    vereinnahmendes_wir: "Vereinnahmendes Wir",
    umbenennung: "Umbenennung",
    leitbegriff_wiederholung: "Leitbegriff-Wiederholung",
    angstappell: "Angstappell",
    suendenbock: "Sündenbock",
  };
  const STIMMEN_TYP = {
    regierung_verwaltung: "Regierung/Verwaltung", partei_parlament: "Partei/Parlament", justiz: "Justiz",
    sicherheit: "Polizei/Militär", wirtschaft: "Wirtschaft", verband: "Verband/Gewerkschaft",
    zivilgesellschaft: "Zivilgesellschaft", wissenschaft: "Wissenschaft", internationale_organisation: "Internat. Organisation",
    medien: "Medien", betroffene: "Betroffene/Bürger", sonstige: "Sonstige",
  };
  const VERMERK = { angefragt_ohne_antwort: "angefragt, keine Antwort", aeusserung_abgelehnt: "wollte sich nicht äußern" };
  const GATTUNG_KOMMENTAR =new Set(["Kommentar/Meinung", "Glosse"]);
  const MIN_SAETZE_FUER_ANTEIL = 15;

  // ------------------------------------------------------------ Vereinheitlichung (wie wertung.py)

  const ERSETZEN = {
    "„": '"', "“": '"', "”": '"', "«": '"', "»": '"', "‟": '"', "″": '"',
    "‚": "'", "‘": "'", "’": "'", "‹": "'", "›": "'", "´": "'", "`": "'",
    "–": "-", "—": "-", "‑": "-", "‐": "-", "−": "-",
  };
  const UNSICHTBAR = new Set(["­", "​", "‌", "‍", "﻿"]);

  // Ein Zeichen in Vergleichsform: "" = weglassen, " " = Leerraum, sonst ein Zeichen
  function zeichen(c) {
    if (UNSICHTBAR.has(c)) return "";
    if (/\s/.test(c)) return " ";
    const m = ERSETZEN[c] || c;
    const k = m.toLowerCase();
    return k.length === 1 ? k : m;
  }

  function normalisieren(text) {
    let aus = "";
    for (const c of text.normalize("NFC")) {
      const z = zeichen(c);
      if (z === "") continue;
      if (z === " " && (aus === "" || aus.endsWith(" "))) continue;
      aus += z;
    }
    return aus.trimEnd();
  }

  // ------------------------------------------------------------ Artikeltext

  const BLOCK = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE",
    "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE",
    "SECTION", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL", "BR", "DETAILS", "SUMMARY", "CAPTION"]);

  function artikelText() {
    if (typeof Readability !== "function") return null;
    const artikel = new Readability(document.cloneNode(true), { charThreshold: 300 }).parse();
    if (!artikel || (artikel.textContent || "").trim().length < 400) return null;
    // Inhalt in einem inerten Dokument lesen (DOMParser führt nichts aus)
    const doc = new DOMParser().parseFromString(artikel.content || "", "text/html");
    const zeilen = [];
    const titel = (artikel.title || "").replace(/\s+/g, " ").trim();
    const ausgeben = (text, marke) => {
      text = text.replace(/\s+/g, " ").trim();
      if (!text) return;
      if (marke === "[Zwischenüberschrift]" && text === titel) return;
      zeilen.push(marke ? `${marke} ${text}` : text);
    };
    const hatBlock = (el) => [...el.querySelectorAll("*")].some((k) => BLOCK.has(k.tagName));
    const markeFuer = (el, geerbt) => {
      if (/^H[1-6]$/.test(el.tagName)) return "[Zwischenüberschrift]";
      if (el.tagName === "FIGCAPTION" || el.tagName === "CAPTION") return "[Bildunterschrift]";
      if (el.tagName === "ASIDE") return "[Kasten]";
      return geerbt;
    };
    const gehen = (el, marke) => {
      let lose = "";
      for (const k of el.childNodes) {
        if (k.nodeType === Node.TEXT_NODE) { lose += k.textContent; continue; }
        if (k.nodeType !== Node.ELEMENT_NODE) continue;
        if (!BLOCK.has(k.tagName)) { lose += k.textContent; continue; }
        ausgeben(lose, marke); lose = "";
        const m = markeFuer(k, marke);
        if (hatBlock(k)) gehen(k, m); else ausgeben(k.textContent, m);
      }
      ausgeben(lose, marke);
    };
    gehen(doc.body, "");
    // Vorspann, den Readability oft außerhalb des Inhalts lässt – nur wenn er auf der Seite sichtbar steht
    const ganz = normalisieren(zeilen.join(" "));
    const auszug = (artikel.excerpt || "").replace(/\s+/g, " ").trim();
    if (auszug.length > 40 && !ganz.includes(normalisieren(auszug).slice(0, 60))
        && normalisieren(document.body.innerText).includes(normalisieren(auszug))) {
      zeilen.unshift(`[Vorspann] ${auszug}`);
    }
    return [`URL: ${location.href}`, titel, ...zeilen].join("\n");
  }

  function ganzeSeiteText() {
    const text = document.body.innerText.replace(/\n{3,}/g, "\n\n").trim();
    return text.length < 200 ? null : `URL: ${location.href}\n${text}`;
  }

  // ------------------------------------------------------------ Fundstellen im Seitentext

  const blockCache = new WeakMap();
  function blockVon(el) {
    const anfang = el;
    while (el && el !== document.body && !BLOCK.has(el.tagName)) el = el.parentElement;
    blockCache.set(anfang, el);
    return el;
  }

  // Vergleichsform des sichtbaren Seitentexts mit Zuordnung jedes Zeichens zu Textknoten und Stelle
  function seitenIndex() {
    const knoten = [], kn = [], off = [];
    let text = "", letzterBlock = null;
    const gaenger = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest("script, style, noscript, textarea, template, select, #wa-host")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = gaenger.nextNode(); n; n = gaenger.nextNode()) {
      const block = blockCache.get(n.parentElement) ?? blockVon(n.parentElement);
      if (block !== letzterBlock && text && !text.endsWith(" ")) { text += " "; kn.push(-1); off.push(-1); }
      letzterBlock = block;
      const ki = knoten.push(n) - 1;
      const daten = n.data;
      for (let i = 0; i < daten.length; i++) {
        let z = zeichen(daten[i]);
        if (z === "") continue;
        if (z === " " && (text === "" || text.endsWith(" "))) continue;
        text += z; kn.push(ki); off.push(i);
      }
    }
    return { text, knoten, kn, off };
  }

  function sichtbar(knoten) {
    const el = knoten.parentElement;
    return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function finden(index, zitat) {
    const z = normalisieren(zitat).trim();
    if (!z) return null;
    const kandidaten = [];
    for (let pos = index.text.indexOf(z); pos >= 0 && kandidaten.length < 20; pos = index.text.indexOf(z, pos + 1)) {
      kandidaten.push({ start: pos, ende: pos + z.length - 1 });
    }
    if (!kandidaten.length) return null;
    const knotenAn = (k) => index.knoten[index.kn[k.start]];
    const imArtikel = (k) => !!knotenAn(k).parentElement.closest("article, main, [role=main]");
    return kandidaten.find((k) => sichtbar(knotenAn(k)) && imArtikel(k))
      || kandidaten.find((k) => sichtbar(knotenAn(k))) || kandidaten[0];
  }

  function umhuellen(textKnoten, von, bis, vorlage) {
    let mitte = textKnoten;
    if (von > 0) mitte = mitte.splitText(von);
    if (bis - von < mitte.length) mitte.splitText(bis - von);
    const mark = vorlage.cloneNode(false);
    mitte.parentNode.insertBefore(mark, mitte);
    mark.appendChild(mitte);
    return mark;
  }

  function markierungenEntfernen() {
    for (const m of document.querySelectorAll("wa-mark")) {
      const eltern = m.parentNode;
      while (m.firstChild) eltern.insertBefore(m.firstChild, m);
      eltern.removeChild(m);
      eltern.normalize();
    }
  }

  // Setzt alle Markierungen; gibt je Markierung die Nummer ihres Bereichs zurück (oder -1 = nicht gefunden)
  function markieren(markierungen) {
    markierungenEntfernen();
    const index = seitenIndex();
    const bereiche = [];
    const zuordnung = markierungen.map((m, i) => {
      const treffer = finden(index, m.zitat);
      if (!treffer) return -1;
      const vorhanden = bereiche.findIndex((b) => treffer.start <= b.ende && b.start <= treffer.ende);
      if (vorhanden >= 0) { bereiche[vorhanden].befunde.push(i); return vorhanden; }
      return bereiche.push({ ...treffer, befunde: [i], marks: [] }) - 1;
    });
    // Von hinten nach vorn umhüllen: splitText lässt den Anfang im alten Knoten, frühere Stellen bleiben gültig
    const reihenfolge = bereiche.map((b, i) => i).sort((a, b) => bereiche[b].start - bereiche[a].start);
    for (const bi of reihenfolge) {
      const b = bereiche[bi];
      const erste = markierungen[b.befunde[0]];
      const vorlage = document.createElement("wa-mark");
      vorlage.className = `wa-${erste.dimension}` + (erste.strittig ? " wa-strittig" : "") + (erste.nur_struktur ? " wa-struktur" : "");
      vorlage.dataset.wa = String(bi);
      const stuecke = [];
      for (let p = b.start; p <= b.ende; p++) {
        const k = index.kn[p];
        if (k < 0) continue;
        const letztes = stuecke[stuecke.length - 1];
        if (letztes && letztes.k === k) letztes.bis = index.off[p] + 1;
        else stuecke.push({ k, von: index.off[p], bis: index.off[p] + 1 });
      }
      for (const s of stuecke.reverse()) {
        try { b.marks.unshift(umhuellen(index.knoten[s.k], s.von, s.bis, vorlage)); } catch { /* Knoten verschwunden */ }
      }
    }
    return { zuordnung, bereiche };
  }

  // Bereich (Range) eines Zitats im aktuellen Seitentext, ohne das DOM zu verändern; null = nicht gefunden
  function stelleFinden(index, zitat) {
    const t = finden(index, zitat);
    if (!t) return null;
    let s = t.start, e = t.ende;
    while (s <= e && index.kn[s] < 0) s++;
    while (e >= s && index.kn[e] < 0) e--;
    if (s > e) return null;
    const r = document.createRange();
    r.setStart(index.knoten[index.kn[s]], index.off[s]);
    r.setEnd(index.knoten[index.kn[e]], index.off[e] + 1);
    return r;
  }

  // Belege der Muster werden nicht dauerhaft markiert, sondern auf Klick kurz hervorgehoben (CSS Custom Highlight)
  function stelleZeigen(zitat) {
    const r = stelleFinden(seitenIndex(), zitat);
    if (!r) return;
    (r.startContainer.parentElement || document.body).scrollIntoView({ behavior: "smooth", block: "center" });
    if (window.CSS && CSS.highlights && typeof Highlight === "function") {
      CSS.highlights.set("wa-muster", new Highlight(r));
      clearTimeout(WA.musterZeit);
      WA.musterZeit = setTimeout(() => CSS.highlights.delete("wa-muster"), 2500);
    }
  }

  // ------------------------------------------------------------ Seitenleiste

  const host = document.createElement("div");
  host.id = "wa-host";
  host.style.cssText = "all: initial; position: fixed; top: 0; right: 0; z-index: 2147483647;";
  const schatten = host.attachShadow({ mode: "open" });
  schatten.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .leiste { position: fixed; top: 0; right: 0; width: min(380px, 92vw); height: 100vh; background: #fff; color: #1b1b1b;
      font: 13.5px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: -4px 0 18px rgba(0,0,0,.18);
      display: flex; flex-direction: column; border-left: 1px solid #ddd; }
    .leiste[hidden], .tip[hidden] { display: none; }
    header { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid #e5e5e5; background: #fafafa; }
    header h1 { font-size: 15px; margin: 0; flex: 1; }
    button { font: inherit; font-size: 12.5px; border: 1px solid #ccc; background: #fff; border-radius: 6px; padding: 3px 8px; cursor: pointer; color: inherit; }
    button:hover { background: #f0f0f0; }
    label.schalter { display: flex; align-items: center; gap: 4px; font-size: 12.5px; cursor: pointer; }
    .inhalt { overflow-y: auto; padding: 4px 14px 24px; flex: 1; }
    section { padding: 10px 0; border-bottom: 1px solid #eee; }
    section:last-child { border-bottom: 0; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #666; margin: 0 0 6px; font-weight: 600; }
    .gross { font-size: 16px; font-weight: 600; }
    .klein { font-size: 12px; color: #555; }
    .warn { background: #fff4e5; border: 1px solid #f5c26b; border-radius: 6px; padding: 6px 8px; margin: 6px 0; font-size: 12.5px; }
    .fehler { background: #fdecea; border: 1px solid #f19a93; border-radius: 6px; padding: 10px; margin: 12px 0; }
    .fehler b { display: block; margin-bottom: 4px; }
    .tw { margin: 6px 0 8px; }
    .tw-kopf { display: flex; align-items: center; gap: 8px; }
    .tw-name { flex: 1; }
    .balken { display: flex; gap: 2px; }
    .balken i { width: 14px; height: 8px; border-radius: 2px; background: #e6e6e6; display: block; }
    .punkt { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; }
    ul { margin: 4px 0; padding-left: 18px; }
    li { margin: 3px 0; }
    .fund { list-style: none; margin-left: -18px; padding: 4px 6px; border-radius: 6px; cursor: pointer; display: flex; gap: 6px; align-items: baseline; }
    .fund:hover { background: #f4f4f4; }
    .fund.fehlt { cursor: default; opacity: .75; }
    .marke { font-size: 11px; border: 1px solid #ccc; border-radius: 4px; padding: 0 4px; margin-left: 4px; color: #555; white-space: nowrap; }
    .laden { text-align: center; padding: 40px 10px; }
    .kreis { width: 34px; height: 34px; border: 4px solid #ddd; border-top-color: #555; border-radius: 50%;
      margin: 0 auto 14px; animation: dreh 1s linear infinite; }
    @keyframes dreh { to { transform: rotate(360deg); } }
    .tip { position: fixed; max-width: 360px; background: #1f1f1f; color: #fff; border-radius: 8px; padding: 8px 10px;
      font: 12.5px/1.45 system-ui, "Segoe UI", sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.3); pointer-events: none; }
    .tip .befund + .befund { border-top: 1px solid #444; margin-top: 6px; padding-top: 6px; }
    .tip .dim { font-weight: 600; }
    .tip .alt { color: #b9f6ca; margin-top: 3px; }
    .tip .wirk { color: #ffe0a3; margin-top: 3px; }
    .tip .leiter { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; margin-top: 5px; }
    .tip .pol { color: #999; font-weight: 600; padding: 0 2px; }
    .tip .stufe { border: 1px solid #555; border-radius: 4px; padding: 0 5px; color: #ccc; font-size: 12px; }
    .tip .stufe.neutral { border-color: #b9f6ca; color: #b9f6ca; }
    .tip .stufe.gewaehlt { background: #fff; color: #1f1f1f; border-color: #fff; font-weight: 600; }
    .fuss { font-size: 11.5px; color: #777; padding-top: 10px; }
    .muster { margin: 6px 0 10px; }
    .ok { background: #ebf7ee; border: 1px solid #8fd19e; border-radius: 6px; padding: 6px 8px; margin: 6px 0; font-size: 12.5px; }
    table.vergleich { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 12.5px; }
    table.vergleich th { font-weight: 600; color: #666; text-align: left; font-size: 11.5px; }
    table.vergleich td, table.vergleich th { padding: 2px 4px; }
    table.vergleich td.zahl { text-align: center; font-weight: 600; }
    details { margin-top: 8px; }
    summary { cursor: pointer; font-weight: 600; }
    .gegentext { white-space: pre-wrap; font-size: 12.5px; background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 8px; margin-top: 6px; }
    .pos { margin: 4px 0; }
    .pos-kopf { display: flex; gap: 8px; }
    .pos-kopf span:first-child { flex: 1; }
    .pos-balken { height: 6px; border-radius: 3px; background: #555; margin-top: 2px; }
    h3 { font-size: 12px; font-weight: 600; margin: 10px 0 2px; color: #444; }
  </style>
  <div class="leiste">
    <header>
      <h1>Wertungsanalyse</h1>
      <label class="schalter" title="Markierungen im Artikel ein- oder ausblenden"><input type="checkbox" id="an" checked> Markierungen</label>
      <button id="neu" title="Neu analysieren (kostet einen API-Aufruf)">↻</button>
      <button id="einst" title="Einstellungen">⚙</button>
      <button id="zu" title="Leiste schließen (Klick aufs Symbol öffnet sie wieder)">✕</button>
    </header>
    <div class="inhalt" id="inhalt"></div>
  </div>
  <div class="tip" id="tip" hidden></div>`;
  document.documentElement.appendChild(host);

  const $ = (id) => schatten.getElementById(id);
  const leiste = schatten.querySelector(".leiste");
  let zustand = { ergebnis: null, karte: null, laeuft: false, port: null, text: "", spiegel: null, spiegelLaeuft: false };

  function el(tag, attribute, ...kinder) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attribute || {})) {
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of kinder.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
    return e;
  }
  const inhaltSetzen = (...kinder) => $("inhalt").replaceChildren(...kinder);

  $("zu").addEventListener("click", () => { leiste.hidden = true; });
  $("einst").addEventListener("click", () => chrome.runtime.sendMessage({ art: "einstellungen_oeffnen" }));
  $("neu").addEventListener("click", () => starten({ neu: true }));
  $("an").addEventListener("change", (e) => {
    document.documentElement.classList.toggle("wa-aus", !e.target.checked);
    if (!e.target.checked) $("tip").hidden = true;
  });

  WA.klick = () => { leiste.hidden = !leiste.hidden; };

  // ------------------------------------------------------------ Ablauf

  function starten({ neu = false, ganzeSeite = false } = {}) {
    if (zustand.laeuft) return;
    leiste.hidden = false;
    const text = ganzeSeite ? ganzeSeiteText() : artikelText();
    if (!text) {
      fehlerZeigen("kein_artikel", "Auf dieser Seite wurde kein Artikel erkannt (zu wenig zusammenhängender Text).");
      return;
    }
    zustand.laeuft = true;
    zustand.text = text;
    ladenZeigen({ phase: "wird vorbereitet", sekunden: 0 });
    const port = chrome.runtime.connect({ name: "analyse" });
    zustand.port = port;
    let erledigt = false;
    port.onMessage.addListener((n) => {
      if (n.art === "stand") ladenZeigen(n);
      else if (n.art === "fertig") { erledigt = true; zustand.laeuft = false; port.disconnect(); zustand.spiegel = n.spiegel || null; ergebnisZeigen(n.ergebnis, n.ausSpeicher); }
      else if (n.art === "fehler") { erledigt = true; zustand.laeuft = false; port.disconnect(); fehlerZeigen(n.code, n.text); }
    });
    port.onDisconnect.addListener(() => {
      if (erledigt) return;
      zustand.laeuft = false;
      fehlerZeigen("verbindung", "Die Verbindung zum Hintergrundskript ist abgebrochen. Bitte noch einmal versuchen.");
    });
    port.postMessage({ art: "start", url: location.href, text, neu });
  }

  function ladenZeigen(stand) {
    const phase = {
      "wird vorbereitet": "wird vorbereitet …", sendet: "Anfrage wird gesendet …", "denkt nach": "Das Modell denkt nach …",
      "schreibt das Ergebnis": "Das Ergebnis wird geschrieben …", "Ersatzmodell übernimmt": "Ein Ersatzmodell übernimmt …",
    }[stand.phase] || stand.phase;
    inhaltSetzen(el("div", { class: "laden" },
      el("div", { class: "kreis" }),
      el("div", { class: "gross" }, phase),
      el("div", { class: "klein" }, `${stand.sekunden || 0} s` + (stand.zeichen ? ` · ${stand.zeichen} Zeichen` : "")),
      el("p", { class: "klein" }, "Eine Analyse dauert je nach Länge und Modell etwa 30 bis 120 Sekunden.")));
  }

  function fehlerZeigen(code, text) {
    const titel = {
      kein_artikel: "Kein Artikel erkannt", schluessel: "API-Schlüssel fehlt oder ist ungültig", modell: "Modell unbekannt",
      guthaben: "Kein API-Guthaben", limit: "Ratenlimit", server: "API gestört", netz: "Keine Verbindung",
      abgelehnt: "Analyse abgelehnt", zu_lang: "Artikel zu lang",
    }[code] || "Fehler";
    const knoepfe = [];
    if (["schluessel", "modell", "guthaben"].includes(code)) {
      knoepfe.push(el("button", { onclick: () => chrome.runtime.sendMessage({ art: "einstellungen_oeffnen" }) }, "Einstellungen öffnen"));
    }
    if (code === "kein_artikel") {
      knoepfe.push(el("button", { onclick: () => starten({ ganzeSeite: true }) }, "Ganze Seite analysieren"));
    } else {
      knoepfe.push(el("button", { onclick: () => starten() }, "Noch einmal"));
    }
    inhaltSetzen(el("div", { class: "fehler" }, el("b", {}, titel), el("div", {}, text),
      el("div", { style: "margin-top:8px; display:flex; gap:6px;" }, knoepfe)));
  }

  function ergebnisZeigen(ergebnis, ausSpeicher) {
    zustand.ergebnis = ergebnis;
    const a = ergebnis.analyse;
    const karte = markieren(a.markierungen);
    zustand.karte = karte;
    document.documentElement.classList.toggle("wa-aus", !$("an").checked);

    const abschnitte = [];
    // Gattung
    const textlage = { unvollstaendig: "Der Text ist unvollständig (z. B. Bezahlschranke).",
      nur_zusammenfassung: "Es lag nur eine Zusammenfassung vor, kein Wortlaut.", kein_artikel: "Das Modell hat hier keinen Artikel erkannt." }[a.textlage];
    abschnitte.push(el("section", {}, el("h2", {}, "Gattung"),
      el("div", { class: "gross" }, a.gattung.art),
      el("div", { class: "klein" }, a.gattung.begruendung),
      GATTUNG_KOMMENTAR.has(a.gattung.art) && el("div", { class: "klein", style: "margin-top:4px" }, "Bei Meinungstexten ist Wertung Teil der Gattung, kein Fehler."),
      a.kennzeichnungsproblem.vorhanden && el("div", { class: "warn" }, el("b", {}, "Kennzeichnungsproblem: "), a.kennzeichnungsproblem.begruendung),
      textlage && el("div", { class: "warn" }, textlage)));

    // Kennzahl
    const k = a.kennzahl;
    const kurz = k.gesamt < MIN_SAETZE_FUER_ANTEIL;
    abschnitte.push(el("section", {}, el("h2", {}, "Kennzahl"),
      el("div", { class: "gross" }, `${k.markiert} von ${k.gesamt} Sätzen wertend` + (!kurz && k.gesamt ? ` (${Math.round(100 * k.markiert / k.gesamt)} %)` : "")),
      el("div", { class: "klein" }, (k.strittig ? `plus ${k.strittig} strittige. ` : "")
        + (kurz ? `Kurzer Text (unter ${MIN_SAETZE_FUER_ANTEIL} Sätzen): nur absolute Zahlen.` : "Gezählt: Überschrift, Vorspann, Zwischenüberschriften, Fließtext."))));

    // Teilwerte
    abschnitte.push(el("section", {}, el("h2", {}, "Teilwerte (0–4)"),
      Object.entries(DIM).map(([schl, d]) => {
        const tw = a.teilwerte[schl];
        return el("div", { class: "tw" },
          el("div", { class: "tw-kopf" },
            el("span", { class: "punkt", style: `background:${d.farbe}` }),
            el("span", { class: "tw-name" }, d.name),
            el("span", { class: "balken" }, [1, 2, 3, 4].map((s) => el("i", { style: s <= tw.wert ? `background:${d.farbe}` : "" }))),
            el("b", {}, String(tw.wert))),
          el("div", { class: "klein" }, tw.begruendung));
      }),
      el("div", { class: "klein" }, "0 keine · 1 vereinzelt · 2 wiederkehrend · 3 häufig · 4 durchgehend. Gestrichelt markiert = strittig, gepunktet = nur strukturell.")));

    // Richtung
    const r = a.richtung;
    const richtungText = { parteinahme: "Parteinahme", zuspitzung_ohne_parteinahme: "Zuspitzung ohne Parteinahme",
      keine_erkennbare_richtung: "Keine erkennbare Richtung" }[r.einordnung];
    abschnitte.push(el("section", {}, el("h2", {}, "Richtung der Wertung"),
      el("div", { class: "gross" }, richtungText),
      r.zugunsten.length > 0 && el("div", {}, "zugunsten: ", el("b", {}, r.zugunsten.join(", "))),
      r.zulasten.length > 0 && el("div", {}, "zulasten: ", el("b", {}, r.zulasten.join(", "))),
      el("div", { class: "klein" }, r.begruendung)));

    // Strategische Muster
    const sm = a.strategische_muster;
    if (!sm) {
      abschnitte.push(el("section", {}, el("h2", {}, "Strategische Muster"),
        el("div", { class: "klein" }, "Dieses Ergebnis stammt aus einer älteren Version ohne Musterprüfung. ↻ analysiert neu (kostet).")));
    } else {
      const index = sm.muster.length ? seitenIndex() : null;
      abschnitte.push(el("section", {}, el("h2", {}, `Strategische Muster (${sm.muster.length})`),
        sm.muster.length === 0 && el("div", {}, "Keine Muster gezielter Rahmung erkannt."),
        sm.muster.map((mu) => el("div", { class: "muster" },
          el("div", {}, el("b", {}, MUSTER[mu.art] || mu.art), mu.strittig && el("span", { class: "marke" }, "strittig")),
          el("div", { class: "klein" }, mu.begruendung),
          el("ul", {}, mu.belege.map((b) => {
            const da = !!stelleFinden(index, b);
            return el("li", { class: "fund" + (da ? "" : " fehlt"), onclick: () => da && stelleZeigen(b) },
              el("span", {}, da ? "" : "⚠ ", `„${b}“`));
          })))),
        sm.leitbegriffe.length > 0 && el("div", { class: "klein", style: "margin-top:6px" }, "Leitbegriffe: ", sm.leitbegriffe.join(" · ")),
        el("div", { class: "klein", style: "margin-top:6px" },
          "Muster beschreiben, wie der Text gebaut ist, nicht was jemand beabsichtigt hat. Sie zählen nicht in Teilwerten und Kennzahl.")));
    }

    // Wer kommt zu Wort
    abschnitte.push(stimmenAbschnitt(a.stimmen));

    // Spiegelprobe (auf Knopfdruck, eigener API-Aufruf)
    abschnitte.push(el("section", { id: "spiegel" }, spiegelInhalt()));

    // Neutrale Fassung
    abschnitte.push(el("section", {}, el("h2", {}, "Neutrale Fassung"), el("div", {}, a.neutrale_fassung)));

    // Fundstellen
    const fehlend = karte.zuordnung.filter((z) => z < 0).length;
    abschnitte.push(el("section", {}, el("h2", {}, `Fundstellen (${a.markierungen.length})`),
      fehlend > 0 && el("div", { class: "warn" }, `${fehlend} von ${a.markierungen.length} Fundstellen wurden im Seitentext nicht gefunden `
        + "(Seite geändert oder Text außerhalb des sichtbaren Bereichs). Sie stehen unten mit ⚠."),
      a.markierungen.length === 0 && el("div", { class: "klein" }, "Keine wertenden Stellen markiert."),
      el("ul", {}, a.markierungen.map((m, i) => {
        const bi = karte.zuordnung[i];
        const d = DIM[m.dimension];
        return el("li", { class: "fund" + (bi < 0 ? " fehlt" : ""), title: m.begruendung,
          onclick: () => bi >= 0 && hinspringen(bi) },
          el("span", { class: "punkt", style: `background:${d.farbe}` }),
          el("span", {}, bi < 0 ? "⚠ " : "", `„${m.zitat}“`,
            m.strittig && el("span", { class: "marke" }, "strittig"),
            m.nur_struktur && el("span", { class: "marke" }, "strukturell"),
            m.ausserhalb_zaehlbasis && el("span", { class: "marke" }, "außerhalb Zählbasis"),
            bi < 0 && el("div", { class: "klein" }, "nicht im Seitentext gefunden")));
      }))));

    // Hinweise
    if (a.hinweise.length) abschnitte.push(el("section", {}, el("h2", {}, "Hinweise"), el("ul", {}, a.hinweise.map((h) => el("li", {}, h)))));

    // Fuß
    const m = ergebnis.meta;
    const datum = new Date(m.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
    abschnitte.push(el("div", { class: "fuss" },
      `${m.modell || m.modell_angefragt}, effort ${m.effort}, ${m.dauer_s} s`
      + (m.kosten_usd_ca != null ? `, ca. ${m.kosten_usd_ca.toFixed(2).replace(".", ",")} $` : "")
      + (m.modell && m.modell !== m.modell_angefragt ? ` (Ersatzmodell statt ${m.modell_angefragt})` : "")
      + `. Analysiert am ${datum}.` + (ausSpeicher ? " Aus dem Zwischenspeicher, ohne neuen API-Aufruf." : "")));

    inhaltSetzen(...abschnitte);
  }

  // ------------------------------------------------------------ Spiegelprobe

  // Schreibt eine Gegenfassung mit vertauschten Seiten und analysiert sie; Vergleich mit der Analyse des Originals.
  function spiegelStarten() {
    if (zustand.spiegelLaeuft || !zustand.text) return;
    zustand.spiegelLaeuft = true;
    const abschnitt = $("spiegel");
    const zeigen = (...k) => abschnitt && abschnitt.replaceChildren(...k);
    zeigen(el("h2", {}, "Spiegelprobe"), el("div", { class: "klein" }, "wird vorbereitet …"));
    const port = chrome.runtime.connect({ name: "analyse" });
    let erledigt = false;
    const ende = () => { erledigt = true; zustand.spiegelLaeuft = false; port.disconnect(); };
    port.onMessage.addListener((n) => {
      if (n.art === "stand") {
        zeigen(el("h2", {}, "Spiegelprobe"),
          el("div", {}, el("b", {}, n.schritt || ""), ` · ${n.phase || ""} · ${n.sekunden || 0} s`),
          el("div", { class: "klein" }, "Zwei Aufrufe nacheinander, zusammen etwa so lange wie zwei Analysen."));
      } else if (n.art === "spiegel_fertig") {
        ende(); zustand.spiegel = n.spiegel; zeigen(...spiegelInhalt());
      } else if (n.art === "fehler") {
        ende(); zeigen(el("h2", {}, "Spiegelprobe"), el("div", { class: "warn" }, n.text),
          el("button", { onclick: spiegelStarten }, "Noch einmal"));
      }
    });
    port.onDisconnect.addListener(() => {
      if (erledigt) return;
      zustand.spiegelLaeuft = false;
      zeigen(el("h2", {}, "Spiegelprobe"), el("div", { class: "warn" }, "Die Verbindung ist abgebrochen."),
        el("button", { onclick: spiegelStarten }, "Noch einmal"));
    });
    port.postMessage({ art: "spiegel", url: location.href, text: zustand.text });
  }

  function spiegelInhalt() {
    const titel = el("h2", {}, "Spiegelprobe");
    const sp = zustand.spiegel;
    const a = zustand.ergebnis && zustand.ergebnis.analyse;
    if (!sp) {
      return [titel,
        el("div", { class: "klein" }, "Schreibt eine Gegenfassung des Artikels mit vertauschten Seiten, gleich stark und ohne neue "
          + "Fakten, und analysiert sie genauso. Wird sie anders bewertet, misst die Analyse die Seiten ungleich."),
        el("button", { style: "margin-top:6px", onclick: spiegelStarten, title: "Zwei API-Aufrufe, etwa doppelte Kosten" },
          zustand.text ? "Spiegelprobe starten (2 Aufrufe)" : "Erst neu analysieren (↻)")];
    }
    const g = sp.gegenfassung;
    const neu = el("button", { style: "margin-top:8px", onclick: spiegelStarten, title: "Zwei API-Aufrufe" }, "↻ Spiegelprobe neu");
    if (!g.spiegelbar || !sp.analyse) {
      return [titel, el("div", {}, "Nicht spiegelbar: ", g.streitfrage), neu];
    }
    const s = sp.analyse;
    const abweichend = [];
    const zeilen = Object.entries(DIM).map(([schl, d]) => {
      const wo = a.teilwerte[schl].wert, ws = s.teilwerte[schl].wert;
      if (Math.abs(wo - ws) > 1) abweichend.push(d.name);
      return el("tr", {}, el("td", {}, el("span", { class: "punkt", style: `background:${d.farbe}` }), " ", d.name),
        el("td", { class: "zahl" }, String(wo)), el("td", { class: "zahl" }, String(ws)),
        el("td", {}, Math.abs(wo - ws) > 1 ? el("span", { class: "marke" }, "abweichend") : ""));
    });
    // Nur nicht strittige Muster entscheiden; Muster, die nur strittig vorkommen, werden bloß genannt (wie wertung.py)
    const arten = (x, strittig) => new Set(((x.strategische_muster || {}).muster || [])
      .filter((m) => !!m.strittig === strittig).map((m) => m.art));
    const mo = arten(a, false), ms = arten(s, false);
    const so = [...arten(a, true)].filter((x) => !mo.has(x)), ss = [...arten(s, true)].filter((x) => !ms.has(x));
    const musterGleich = mo.size === ms.size && [...mo].every((x) => ms.has(x));
    if (!musterGleich) abweichend.push("Muster");
    if (a.kennzeichnungsproblem.vorhanden !== s.kennzeichnungsproblem.vorhanden) abweichend.push("Kennzeichnung");
    if (a.richtung.einordnung !== s.richtung.einordnung) abweichend.push("Richtung");
    const namen = (menge) => [...menge].map((x) => MUSTER[x] || x).join(", ") || "keine";
    const richtung = (r) => ({ parteinahme: "Parteinahme", zuspitzung_ohne_parteinahme: "Zuspitzung", keine_erkennbare_richtung: "keine Richtung" }[r.einordnung])
      + (r.zugunsten.length ? ` zugunsten ${r.zugunsten.join(", ")}` : "");
    const seite = { seite_a: g.seite_a, seite_b: g.seite_b }[g.original_beguenstigt];
    return [titel,
      el("div", { class: "klein" }, "Streitfrage: ", g.streitfrage),
      seite && el("div", { class: "klein" }, "Das Original begünstigt: ", el("b", {}, seite)),
      el("div", { class: abweichend.length ? "warn" : "ok" },
        abweichend.length
          ? el("span", {}, el("b", {}, "Ungleich bewertet: "), abweichend.join(", "),
            ". Entweder misst die Analyse die Seiten unterschiedlich, oder die Gegenfassung ist nicht gleich stark geraten. Unten lesen, um das zu unterscheiden.")
          : el("span", {}, el("b", {}, "Symmetrisch: "), "Die Gegenfassung wird gleich bewertet.")),
      el("table", { class: "vergleich" },
        el("tr", {}, el("th", {}, ""), el("th", {}, "Original"), el("th", {}, "Gegenf."), el("th", {}, "")), zeilen),
      el("div", { class: "klein" }, "Muster: ", namen(mo), musterGleich ? "" : ` · Gegenfassung: ${namen(ms)}`,
        (so.length || ss.length) ? ` (strittig: ${namen(so)} · Gegenfassung: ${namen(ss)}; zählt nicht)` : ""),
      el("div", { class: "klein" }, "Richtung: ", richtung(a.richtung), " · Gegenfassung: ", richtung(s.richtung)),
      g.nicht_gespiegelt.length > 0 && el("div", { class: "klein", style: "margin-top:4px" },
        `Nicht gespiegelt (${g.nicht_gespiegelt.length}): `, g.nicht_gespiegelt.join(" · ")),
      el("details", {},
        el("summary", {}, "Gegenfassung lesen"),
        el("div", { class: "warn" }, "Konstruierter Prüftext mit vertauschten Seiten, kein echter Artikel. Nicht weitergeben."),
        g.tausch.length > 0 && el("ul", {}, g.tausch.map((t) => el("li", { class: "klein" }, `„${t.original}“ → „${t.spiegel}“`))),
        el("div", { class: "gegentext" }, g.text)),
      el("div", { class: "klein" }, "Ein einzelner Lauf schwankt; erst wiederholte Abweichungen sind aussagekräftig."),
      neu];
  }

  // Verzeichnis der Stimmen: Aussagen je Position (Balken), je Typ, die Stimmen selbst, Akteure ohne Stimme
  function stimmenAbschnitt(st) {
    const titel = "Wer kommt zu Wort";
    if (!st) {
      return el("section", {}, el("h2", {}, titel),
        el("div", { class: "klein" }, "Dieses Ergebnis stammt aus einer älteren Version ohne Stimmenverzeichnis. ↻ analysiert neu (kostet)."));
    }
    const liste = st.liste;
    const summe = liste.reduce((n, s) => n + s.aussagen, 0);
    // Positionen in der Reihenfolge ihres ersten Auftretens, gleicher Wortlaut = gleiche Position
    const positionen = new Map();
    for (const s of liste) {
      const schl = s.position.trim().toLowerCase();
      const p = positionen.get(schl) || { name: s.position.trim(), stimmen: 0, aussagen: 0 };
      p.stimmen += 1; p.aussagen += s.aussagen;
      positionen.set(schl, p);
    }
    const mitHaltung = [...positionen.keys()].some((k) => k !== "ohne position");
    const typen = new Map();
    for (const s of liste) typen.set(s.typ, (typen.get(s.typ) || 0) + s.aussagen);
    const index = liste.length ? seitenIndex() : null;

    return el("section", {}, el("h2", {}, titel),
      liste.length === 0
        ? el("div", {}, "Der Text schreibt niemandem eine Aussage zu.")
        : el("div", { class: "gross" }, `${liste.length} ${liste.length === 1 ? "Stimme" : "Stimmen"}, ${summe} ${summe === 1 ? "Aussage" : "Aussagen"}`),
      mitHaltung && el("h3", {}, "Aussagen nach Position"),
      mitHaltung && [...positionen.values()].map((p) => el("div", { class: "pos" },
        el("div", { class: "pos-kopf" }, el("span", {}, p.name),
          el("span", { class: "klein" }, `${p.aussagen} (${p.stimmen} ${p.stimmen === 1 ? "Stimme" : "Stimmen"})`)),
        el("div", { class: "pos-balken", style: `width:${summe ? Math.max(2, Math.round(100 * p.aussagen / summe)) : 0}%` }))),
      liste.length > 0 && el("h3", {}, "Aussagen nach Herkunft"),
      liste.length > 0 && el("div", { class: "klein" },
        [...typen.entries()].sort((x, y) => y[1] - x[1]).map(([t, n]) => `${STIMMEN_TYP[t] || t} ${n}`).join(" · ")),
      liste.length > 0 && el("h3", {}, "Stimmen"),
      liste.length > 0 && el("ul", {}, liste.map((s) => {
        const da = !!stelleFinden(index, s.erstes_vorkommen);
        return el("li", { class: "fund" + (da ? "" : " fehlt"), title: `„${s.erstes_vorkommen}“`,
          onclick: () => da && stelleZeigen(s.erstes_vorkommen) },
          el("span", {}, da ? "" : "⚠ ", el("b", {}, s.sprecher), ` · ${s.aussagen}×`,
            s.anonym && el("span", { class: "marke" }, "anonym"),
            el("div", { class: "klein" }, STIMMEN_TYP[s.typ] || s.typ, mitHaltung ? ` · ${s.position}` : "")));
      })),
      st.ohne_stimme.length > 0 && el("h3", {}, "Genannt, aber ohne eigene Aussage"),
      st.ohne_stimme.length > 0 && el("ul", {}, st.ohne_stimme.map((o) => el("li", {},
        el("b", {}, o.akteur), `: ${o.rolle}`, VERMERK[o.vermerk] && el("span", { class: "marke" }, VERMERK[o.vermerk])))),
      el("div", { class: "klein", style: "margin-top:6px" },
        "Bestandsaufnahme aus dem Text, zählt nicht in Teilwerten und Kennzahl. Wer im Text gar nicht vorkommt, wird nicht als fehlend gewertet."));
  }

  function hinspringen(bi) {
    const marks = zustand.karte.bereiche[bi].marks;
    if (!marks.length) return;
    marks[0].scrollIntoView({ behavior: "smooth", block: "center" });
    for (const m of marks) m.classList.add("wa-blinken");
    setTimeout(() => marks.forEach((m) => m.classList.remove("wa-blinken")), 1600);
  }

  // ------------------------------------------------------------ Hinweis beim Überfahren

  // Wortleiter: Stufen von abwertend (links) bis aufwertend (rechts), gewähltes Wort gefüllt, neutrales umrandet
  function wortleiter(wl) {
    const n = wl && Array.isArray(wl.stufen) ? wl.stufen.length : 0;
    if (n < 2 || !(wl.gewaehlt >= 0 && wl.gewaehlt < n)) return null;
    return el("div", { class: "leiter" },
      el("span", { class: "pol" }, "−"),
      wl.stufen.map((s, i) => el("span", {
        class: "stufe" + (i === wl.gewaehlt ? " gewaehlt" : "") + (i === wl.neutral ? " neutral" : ""),
        title: i === wl.gewaehlt ? "im Artikel" : i === wl.neutral ? "neutral" : "",
      }, s)),
      el("span", { class: "pol" }, "+"));
  }

  document.addEventListener("mouseover", (e) => {
    const mark = e.target instanceof Element ? e.target.closest("wa-mark") : null;
    const tip = $("tip");
    if (!mark || !zustand.karte || document.documentElement.classList.contains("wa-aus")) { tip.hidden = true; return; }
    const bereich = zustand.karte.bereiche[Number(mark.dataset.wa)];
    if (!bereich) return;
    tip.replaceChildren(...bereich.befunde.map((i) => {
      const m = zustand.ergebnis.analyse.markierungen[i];
      const d = DIM[m.dimension];
      return el("div", { class: "befund" },
        el("div", { class: "dim", style: `color:${d.farbe}; filter: brightness(1.6)` },
          d.name + (m.strittig ? " · strittig" : "") + (m.nur_struktur ? " · strukturell" : "")),
        el("div", {}, m.begruendung),
        m.wirkung && el("div", { class: "wirk" }, "Wirkung: " + m.wirkung),
        wortleiter(m.wortleiter),
        el("div", { class: "alt" }, "Neutral: " + m.alternative));
    }));
    tip.hidden = false;
    const r = mark.getBoundingClientRect();
    const breite = Math.min(360, window.innerWidth - 20);
    tip.style.left = Math.max(10, Math.min(r.left, window.innerWidth - breite - 10)) + "px";
    const hoehe = tip.offsetHeight;
    tip.style.top = (r.bottom + 8 + hoehe < window.innerHeight ? r.bottom + 8 : Math.max(10, r.top - hoehe - 8)) + "px";
  });

  starten();
})();
