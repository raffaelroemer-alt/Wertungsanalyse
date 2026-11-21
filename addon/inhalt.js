// Inhaltsskript: zieht den Artikeltext mit Readability, schickt ihn zur Analyse ans Hintergrundskript,
// markiert die Fundstellen im Seitentext und zeigt die Seitenleiste. Wird nur auf Klick eingefügt.
(() => {
  if (window.__wertungsanalyse) { window.__wertungsanalyse.klick(); return; }
  const WA = (window.__wertungsanalyse = {});

  const { DIM, MUSTER, STIMMEN_TYP, VERMERK, RICHTUNG, TEXTLAGE, GATTUNG_KOMMENTAR, STUFEN,
    zeichen, normalisieren, kennzahlText, spiegelVergleich, stimmenZaehlen, metaText, el,
    zeilenLesen, textIndex, bereicheFinden, artikelDarstellen, fundDarstellen,
    tagesschauVideos, untertitelLesen, transkriptText, redezeit, beitraegeBerechnen, beitraegeDarstellen,
    youtubeAbschnitte, youtubeAbsaetze, youtubeText, absatzEtikett, zitatwertungenDarstellen } = globalThis.WA_GEMEINSAM;

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
    hinscrollen(r, r.startContainer.parentElement || document.body);
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
  // Gerüst ohne innerHTML: Seiten mit Trusted Types (YouTube) blockieren HTML aus Zeichenketten
  const stil = document.createElement("style");
  stil.textContent = `
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
    button:disabled { opacity: .45; cursor: default; background: #fff; }
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
    #klapp { display: none; }
    /* Fernsehbeitrag: Transkript mit Markierungen und ausführliche Fundstellen in der Leiste */
    .tv { background: #eef5fc; border: 1px solid #b6d4f2; border-radius: 6px; padding: 6px 8px; margin: 6px 0; font-size: 12.5px; }
    .artikel { font: 13.5px/1.55 Georgia, "Times New Roman", serif; }
    .artikel .ueberschrift { font-weight: bold; font-size: 15px; margin: 4px 0 6px; }
    .artikel p { margin: 0 0 7px; }
    .artikel p.oton { padding-left: 7px; border-left: 2px solid #bbb; }
    .artikel .markenname { display: block; font: 10.5px system-ui, "Segoe UI", sans-serif; color: #888; }
    .artikel .blinken, .fundliste .blinken { background: #fff3bf; transition: background .3s; }
    .wa { --wa: 120, 120, 120; background: rgba(var(--wa), .2); border-bottom: 2px solid rgb(var(--wa)); border-radius: 2px; }
    .wa.strittig { background: rgba(var(--wa), .07); border-bottom-style: dashed; }
    .wa.struktur { background: transparent; border-bottom-style: dotted; }
    sup.nr { font: bold 9.5px system-ui, sans-serif; color: rgb(var(--wa)); margin-left: 1px; }
    .d-wortwahl { --wa: 232, 128, 0; } .d-epistemisch { --wa: 156, 54, 181; } .d-quellen { --wa: 28, 126, 214; }
    .d-auswahl { --wa: 47, 158, 68; } .d-ueberschrift { --wa: 224, 49, 49; }
    .fundliste .fund { display: grid; grid-template-columns: 22px 1fr; gap: 6px; margin: 0; padding: 6px 4px; border-bottom: 1px solid #eee; border-radius: 0; }
    .fundliste .nr-kreis { width: 20px; height: 20px; border-radius: 50%; color: #fff; font-weight: 700; font-size: 11px;
      display: flex; align-items: center; justify-content: center; background: rgb(var(--wa)); }
    .fundliste .dim { font-weight: 600; color: rgb(var(--wa)); font-size: 12px; }
    .fundliste .zitat { font-family: Georgia, serif; }
    .fundliste .begr, .fundliste .wirk, .fundliste .alt { font-size: 12.5px; margin-top: 1px; }
    .fundliste .wirk { color: #7a5200; } .fundliste .alt { color: #1e7b34; }
    .fundliste .etikett { font-size: 11px; border: 1px solid #ccc; border-radius: 4px; padding: 0 4px; margin-left: 4px; color: #555; font-weight: normal; }
    .fundliste .leiter { display: flex; flex-wrap: wrap; gap: 3px; margin: 3px 0; font-size: 12px; }
    .fundliste .leiter .pol { color: #999; font-weight: 700; }
    .fundliste .stufe { border: 1px solid #ccc; border-radius: 4px; padding: 0 5px; color: #555; }
    .fundliste .stufe.neutral { border-color: #2f9e44; color: #1e7b34; }
    .artikel .beitrag-kopf { font: 600 12.5px system-ui, "Segoe UI", sans-serif; color: #1c5fa8; border-top: 1px solid #b6d4f2;
      padding-top: 6px; margin: 12px 0 6px; }
    .beitrag { padding: 6px 4px; border-bottom: 1px solid #eee; }
    .beitrag:hover { background: #f4f4f4; }
    .beitrag-titel b { font-size: 13px; }
    .ohne-ut { color: #888; }
    .marke.unw { border-color: #e8a23a; color: #8a5300; background: #fff4e5; }
    .fundliste .stufe.gewaehlt { background: #1b1b1b; border-color: #1b1b1b; color: #fff; font-weight: 600; }
    /* Handy: Leiste als Bereich am unteren Rand, einklappbar auf die Kopfzeile */
    @media (max-width: 640px) {
      .leiste { top: auto; bottom: 0; width: 100vw; height: 58vh; height: 58dvh; border-left: 0; border-top: 1px solid #ddd;
        border-radius: 14px 14px 0 0; box-shadow: 0 -4px 18px rgba(0,0,0,.2); font-size: 14.5px; }
      .leiste.eingeklappt { height: auto; }
      .leiste.eingeklappt .inhalt { display: none; }
      header { border-radius: 14px 14px 0 0; padding: 8px 8px 8px 12px; gap: 4px; }
      header h1 { cursor: pointer; font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      button { font-size: 14px; padding: 6px 8px; }
      label.schalter span { display: none; }
      #klapp { display: inline-block; }
      label.schalter { font-size: 13px; }
      .klein { font-size: 13px; }
      .tip { font-size: 14px; }
    }
  `;
  const knopf = (id, titel, text, extra = {}) => {
    const b = document.createElement("button");
    b.id = id; b.title = titel; b.textContent = text;
    if (extra.disabled) b.disabled = true;
    return b;
  };
  const kopf = document.createElement("header");
  const kopfTitel = document.createElement("h1");
  kopfTitel.id = "titel"; kopfTitel.textContent = "Wertungsanalyse";
  const schalter = document.createElement("label");
  schalter.className = "schalter"; schalter.title = "Markierungen im Artikel ein- oder ausblenden";
  const anKasten = document.createElement("input");
  anKasten.type = "checkbox"; anKasten.id = "an"; anKasten.checked = true;
  const anText = document.createElement("span");
  anText.textContent = " Markierungen";
  schalter.append(anKasten, anText);
  kopf.append(kopfTitel, schalter,
    knopf("pdf", "Bericht als PDF (öffnet die Druckansicht in einem neuen Tab)", "PDF", { disabled: true }),
    knopf("neu", "Neu analysieren (kostet einen API-Aufruf)", "↻"),
    knopf("einst", "Einstellungen", "⚙"),
    knopf("klapp", "Leiste ein- oder ausklappen", "▾"),
    knopf("zu", "Leiste schließen (Klick aufs Symbol öffnet sie wieder)", "✕"));
  const leisteEl = document.createElement("div");
  leisteEl.className = "leiste";
  const inhaltEl = document.createElement("div");
  inhaltEl.className = "inhalt"; inhaltEl.id = "inhalt";
  leisteEl.append(kopf, inhaltEl);
  const tipEl = document.createElement("div");
  tipEl.className = "tip"; tipEl.id = "tip"; tipEl.hidden = true;
  schatten.append(stil, leisteEl, tipEl);
  document.documentElement.appendChild(host);

  const $ = (id) => schatten.getElementById(id);
  const leiste = schatten.querySelector(".leiste");
  let zustand = { ergebnis: null, karte: null, laeuft: false, port: null, text: "", spiegel: null, spiegelLaeuft: false,
    videos: [], video: null, yt: false, url: location.href, seite: location.href };

  const inhaltSetzen = (...kinder) => $("inhalt").replaceChildren(...kinder);

  $("zu").addEventListener("click", () => { leiste.hidden = true; });
  $("einst").addEventListener("click", () => chrome.runtime.sendMessage({ art: "einstellungen_oeffnen" }));
  $("neu").addEventListener("click", () => starten({ neu: true, video: zustand.video, yt: zustand.yt }));
  $("pdf").addEventListener("click", berichtOeffnen);
  $("an").addEventListener("change", (e) => {
    document.documentElement.classList.toggle("wa-aus", !e.target.checked);
    if (!e.target.checked) $("tip").hidden = true;
  });

  WA.klick = () => {
    if (location.href !== zustand.seite && !zustand.laeuft) {
      zustand.seite = location.href;
      zustand.ergebnis = null; zustand.spiegel = null; zustand.text = "";
      leiste.hidden = false;
      beginnen();
      return;
    }
    leiste.hidden = !leiste.hidden;
  };

  // Handy: Leiste auf die Kopfzeile einklappen, damit der Artikel mit Markierungen lesbar bleibt
  const schmal = () => window.matchMedia("(max-width: 640px)").matches;
  const einklappen = (zu) => {
    leiste.classList.toggle("eingeklappt", zu);
    $("klapp").textContent = zu ? "▴" : "▾";
  };
  $("klapp").addEventListener("click", () => einklappen(!leiste.classList.contains("eingeklappt")));
  $("titel").addEventListener("click", () => { if (schmal()) einklappen(!leiste.classList.contains("eingeklappt")); });

  // Stelle in den sichtbaren Bereich holen; auf dem Handy ins obere Drittel, über der Leiste
  function hinscrollen(quelle, element) {
    if (schmal()) {
      const r = quelle.getBoundingClientRect();
      window.scrollBy({ top: r.top - window.innerHeight * 0.15, behavior: "smooth" });
    } else {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // Firefox beendet seine Hintergrundseite nach Leerlauf; eine Nachricht alle 15 s hält sie während der Analyse wach
  function wachHalten(port) {
    const t = setInterval(() => { try { port.postMessage({ art: "ping" }); } catch { clearInterval(t); } }, 15000);
    port.onDisconnect.addListener(() => clearInterval(t));
    return () => clearInterval(t);
  }

  // ------------------------------------------------------------ Ablauf

  // Seiten mit ARD-Player und Untertiteln (tagesschau.de): zuerst die Auswahl zeigen, sonst gleich den Artikel analysieren
  // YouTube-Watch-Seite: am Hostnamen oder an der Seitenkennung (auch Varianten wie m.youtube.com)
  const istYoutube = () => location.pathname === "/watch" && (/(^|\.)youtube\.com$/.test(location.hostname)
    || (document.querySelector('meta[property="og:site_name"]') || {}).content === "YouTube");

  function beginnen() {
    if (istYoutube()) { youtubeZeigen(); return; }
    zustand.videos = tagesschauVideos(document);
    if (zustand.videos.length) auswahlZeigen(); else starten();
  }

  function auswahlZeigen() {
    if (zustand.laeuft) return;
    leiste.hidden = false;
    $("pdf").disabled = true;
    markierungenEntfernen();
    const dauer = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min` : "");
    inhaltSetzen(
      el("section", {}, el("h2", {}, "Fernsehbeiträge auf dieser Seite"),
        el("div", { class: "klein" }, "Analysiert wird der Text der Untertitel, je Sprecherwechsel ein Absatz, mit gemessener Redezeit "
          + "der O-Töne. Eine ganze Sendung wird in ihre Beiträge geteilt, mit Sendezeit und Werten je Beitrag. "
          + "Bilder, Einblendungen und Tonfall fehlen."),
        el("ul", {}, zustand.videos.map((v) => v.untertitel
          ? el("li", { class: "fund", onclick: () => starten({ video: v }) },
            el("span", {}, el("b", {}, v.titel), " ›",
              el("div", { class: "klein" }, [dauer(v.dauer_s), v.datum, v.themen.length > 1 ? `${v.themen.length} Themen` : ""]
                .filter(Boolean).join(" · ") || "Video mit Untertiteln")))
          : el("li", { class: "fund fehlt ohne-ut" },
            el("span", {}, v.titel, el("div", { class: "klein" },
              [dauer(v.dauer_s), v.datum ? `gesendet ${v.datum}` : "", "keine Untertitel"].filter(Boolean).join(" · ")))))),
        zustand.videos.some((v) => !v.untertitel) && el("div", { class: "warn" },
          (zustand.videos.every((v) => !v.untertitel) ? "Für die Videos dieser Seite" : "Für einige Videos")
          + " stellt tagesschau.de keine Untertitel bereit; ohne Text lässt sich nichts analysieren. "
          + "Ihr Text steckt meist in der ganzen Sendung desselben Tages, die das Addon in Beiträge teilt: ",
          el("a", { href: "https://www.tagesschau.de/multimedia/sendung/tagesschau_20_uhr", target: "_blank", rel: "noopener" }, "tagesschau 20 Uhr"),
          " · ",
          el("a", { href: "https://www.tagesschau.de/multimedia/sendung/tagesthemen", target: "_blank", rel: "noopener" }, "tagesthemen"), ".")),
      el("section", {}, el("h2", {}, "Artikeltext"),
        el("div", { class: "klein" }, "Statt eines Videos den Text dieser Seite analysieren, wie auf anderen Nachrichtenseiten."),
        el("button", { style: "margin-top:6px", onclick: () => starten() }, "Text der Seite analysieren")));
  }

  // Trägt ein anderes Video der Seite den Hinweis „live untertitelt“, gilt er auch für die daraus geschnittenen
  // Einzelbeiträge (wie in tagesschau.py). Höchstens zwei weitere Dateien, Fehler zählen als „nicht live“.
  async function seiteLiveUntertitelt(video) {
    for (const v of zustand.videos.filter((x) => x !== video && x.untertitel).slice(0, 2)) {
      try {
        const a = await fetch(v.untertitel, { credentials: "omit" });
        if (a.ok && untertitelLesen(await a.text()).live) return true;
      } catch { /* weiter */ }
    }
    return false;
  }

  // ------------------------------------------------------------ YouTube

  const ytTitel = () => ((document.querySelector("ytd-watch-metadata h1, h1.ytd-watch-metadata, #title h1") || {}).textContent || "")
    .trim() || document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();
  const ytKanal = () => ((document.querySelector("ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a, ytd-channel-name a") || {})
    .textContent || "").trim();

  function youtubeZeigen(meldung) {
    if (zustand.laeuft) return;
    leiste.hidden = false;
    $("pdf").disabled = true;
    markierungenEntfernen();
    inhaltSetzen(el("section", {}, el("h2", {}, "YouTube-Video"),
      el("div", { class: "gross" }, ytTitel()),
      ytKanal() && el("div", { class: "klein" }, `Kanal: ${ytKanal()}`),
      meldung && el("div", { class: "warn" }, meldung),
      el("div", { class: "klein", style: "margin-top:6px" }, "Analysiert wird das YouTube-Transkript. Es ist meist automatisch erzeugt: "
        + "Hörfehler bei Namen sind möglich, Sprecherwechsel fehlen, deshalb gibt es keine Redezeit je Stimme. "
        + "Eine ganze Sendung wird trotzdem in Beiträge geteilt."),
      el("button", { style: "margin-top:8px", onclick: () => starten({ yt: true }) }, "Transkript einlesen und analysieren")));
  }

  // Öffnet „Transkript anzeigen“ (dazu, falls nötig, die Beschreibung) und wartet, bis Abschnitte da sind
  async function youtubeTranskriptOeffnen() {
    const warten = async (ms) => {
      for (let t = 0; t < ms; t += 250) {
        if (youtubeAbschnitte(document).length) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return youtubeAbschnitte(document).length > 0;
    };
    if (youtubeAbschnitte(document).length) return true;
    // YouTube hält mehrere Fassungen der Beschreibung im Dokument; nur die sichtbare reagiert
    const sichtbar = (e) => e.getBoundingClientRect().width > 0;
    // Nur echte <button>: die umhüllende Komponente ytd-button-renderer trägt denselben Text, reagiert aber nicht auf click()
    const knoepfe = () => [...document.querySelectorAll("button")]
      .filter((b) => /^(Transkript anzeigen|Show transcript)$/i.test((b.getAttribute("aria-label") || b.textContent || "").trim()));
    // Nach dem Aufklappen zeichnet YouTube die Schaltfläche verzögert: auf die sichtbare warten
    const sichtbarerKnopf = async (ms) => {
      for (let t = 0; t < ms; t += 200) {
        const k = knoepfe().find(sichtbar);
        if (k) return k;
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    };
    let k = knoepfe().find(sichtbar);
    if (!k) {
      const mehr = [...document.querySelectorAll("#description-inline-expander #expand, ytd-text-inline-expander #expand, tp-yt-paper-button#expand")]
        .find(sichtbar);
      if (mehr) mehr.click();
      k = await sichtbarerKnopf(3000);
    }
    (k || knoepfe()[0])?.click();
    if (await warten(5000)) return true;
    const nochmal = knoepfe().find(sichtbar);
    if (nochmal) { nochmal.click(); return warten(6000); }
    return false;
  }

  async function youtubeTranskript() {
    if (!(await youtubeTranskriptOeffnen())) return null;
    const dauer = (document.querySelector("video") || {}).duration;
    const { teile, zeilen } = youtubeAbsaetze(youtubeAbschnitte(document), Number.isFinite(dauer) ? dauer : null);
    if (!teile.length) return null;
    const v = new URLSearchParams(location.search).get("v");
    const url = v ? `https://www.youtube.com/watch?v=${v}` : location.href;
    const video = { titel: ytTitel(), kanal: ytKanal() };
    return { url, text: youtubeText(url, video, teile),
      tv: { quelle: "youtube", titel: video.titel, kanal: video.kanal, sprecher: false, live: false, themen: [],
        absaetze: teile.map(({ nr, beginn, ende, sekunden }) => ({ nr, farbe: null, beginn, ende, sekunden })), zeilen } };
  }

  // Eigene Adresse je Video für den Zwischenspeicher (Seite + Name der Untertiteldatei)
  function videoAdresse(video) {
    const u = new URL(location.href);
    u.hash = "";
    u.searchParams.set("wa_video", video.untertitel.split("/").pop());
    return u.toString();
  }

  async function starten({ neu = false, ganzeSeite = false, video = null, yt = false } = {}) {
    if (zustand.laeuft) return;
    leiste.hidden = false;
    $("pdf").disabled = true;
    zustand.video = video;
    zustand.yt = yt;
    let text, tv = null, url = location.href;
    if (yt) {
      zustand.laeuft = true;
      ladenZeigen({ phase: "Transkript wird gelesen", sekunden: 0 });
      const r = await youtubeTranskript();
      zustand.laeuft = false;
      if (!r) {
        youtubeZeigen("Kein Transkript gefunden. Bitte unter dem Video die Beschreibung aufklappen („…mehr“), "
          + "„Transkript anzeigen“ wählen und dann erneut auf den Knopf klicken. Manche Videos haben kein Transkript.");
        return;
      }
      ({ text, tv, url } = r);
    } else if (video) {
      zustand.laeuft = true;
      ladenZeigen({ phase: "Untertitel werden geladen", sekunden: 0 });
      try {
        const antwort = await fetch(video.untertitel, { credentials: "omit" });
        if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
        const { teile, live: eigenLive, zeilen: utZeilen } = untertitelLesen(await antwort.text());
        if (!teile.length) throw new Error("keine Untertitelzeilen");
        const live = eigenLive || await seiteLiveUntertitelt(video);
        text = transkriptText(location.href, video, teile, live);
        tv = { titel: video.titel, untertitel: video.untertitel, datum: video.datum, live, themen: video.themen || [],
          absaetze: teile.map(({ nr, farbe, beginn, ende, sekunden }) => ({ nr, farbe, beginn, ende, sekunden })),
          zeilen: utZeilen };
        url = videoAdresse(video);
      } catch (e) {
        zustand.laeuft = false;
        fehlerZeigen("untertitel", `Die Untertitel ließen sich nicht laden (${e.message}).`);
        return;
      }
    } else {
      text = ganzeSeite ? ganzeSeiteText() : artikelText();
      if (!text) {
        fehlerZeigen("kein_artikel", "Auf dieser Seite wurde kein Artikel erkannt (zu wenig zusammenhängender Text).");
        return;
      }
    }
    zustand.laeuft = true;
    zustand.text = text;
    zustand.url = url;
    ladenZeigen({ phase: "wird vorbereitet", sekunden: 0 });
    const port = chrome.runtime.connect({ name: "analyse" });
    zustand.port = port;
    const halt = wachHalten(port);
    let erledigt = false;
    port.onMessage.addListener((n) => {
      if (n.art === "stand") ladenZeigen(n);
      else if (n.art === "fertig") { erledigt = true; halt(); zustand.laeuft = false; port.disconnect(); zustand.spiegel = n.spiegel || null; ergebnisZeigen(n.ergebnis, n.ausSpeicher); }
      else if (n.art === "fehler") { erledigt = true; halt(); zustand.laeuft = false; port.disconnect(); fehlerZeigen(n.code, n.text); }
    });
    port.onDisconnect.addListener(() => {
      if (erledigt) return;
      zustand.laeuft = false;
      fehlerZeigen("verbindung", "Die Verbindung zum Hintergrundskript ist abgebrochen. Bitte noch einmal versuchen.");
    });
    port.postMessage({ art: "start", url, text, neu, tv });
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
      abgelehnt: "Analyse abgelehnt", zu_lang: "Artikel zu lang", untertitel: "Untertitel nicht verfügbar",
    }[code] || "Fehler";
    const knoepfe = [];
    if (["schluessel", "modell", "guthaben"].includes(code)) {
      knoepfe.push(el("button", { onclick: () => chrome.runtime.sendMessage({ art: "einstellungen_oeffnen" }) }, "Einstellungen öffnen"));
    }
    if (code === "kein_artikel") {
      knoepfe.push(el("button", { onclick: () => starten({ ganzeSeite: true }) }, "Ganze Seite analysieren"));
    } else {
      knoepfe.push(el("button", { onclick: () => starten({ video: zustand.video, yt: zustand.yt }) }, "Noch einmal"));
    }
    if (zustand.videos.length) knoepfe.push(el("button", { onclick: auswahlZeigen }, "Zur Videoauswahl"));
    inhaltSetzen(el("div", { class: "fehler" }, el("b", {}, titel), el("div", {}, text),
      el("div", { style: "margin-top:8px; display:flex; gap:6px;" }, knoepfe),
      el("div", { class: "klein", style: "margin-top:8px" }, `Addon-Version ${chrome.runtime.getManifest().version}`)));
  }

  function ergebnisZeigen(ergebnis, ausSpeicher) {
    zustand.ergebnis = ergebnis;
    const a = ergebnis.analyse;
    const tv = ergebnis.tv || null;
    let karte;
    if (tv) { markierungenEntfernen(); karte = { zuordnung: a.markierungen.map(() => -1), bereiche: [] }; }
    else karte = markieren(a.markierungen);
    zustand.karte = karte;
    document.documentElement.classList.toggle("wa-aus", !$("an").checked);

    const abschnitte = [];
    // Gattung
    const textlage = TEXTLAGE[a.textlage];
    abschnitte.push(el("section", {}, el("h2", {}, "Gattung"),
      el("div", { class: "gross" }, a.gattung.art),
      el("div", { class: "klein" }, a.gattung.begruendung),
      GATTUNG_KOMMENTAR.has(a.gattung.art) && el("div", { class: "klein", style: "margin-top:4px" }, "Bei Meinungstexten ist Wertung Teil der Gattung, kein Fehler."),
      a.kennzeichnungsproblem.vorhanden && el("div", { class: "warn" }, el("b", {}, "Kennzeichnungsproblem: "), a.kennzeichnungsproblem.begruendung),
      textlage && el("div", { class: "warn" }, textlage),
      tv && tv.quelle === "youtube" && el("div", { class: "tv" }, el("b", {}, `YouTube-Video „${tv.titel}“`),
        tv.kanal ? ` (${tv.kanal}): ` : ": ",
        "Text aus dem YouTube-Transkript, meist automatisch erzeugt. Hörfehler sind möglich, Sprecherwechsel fehlen; "
        + "die Absätze sind Zeitabschnitte, deshalb gibt es keine Redezeit je Stimme. Bilder und Tonfall sind nicht berücksichtigt."),
      tv && tv.quelle !== "youtube" && el("div", { class: "tv" }, el("b", {}, `Fernsehbeitrag „${tv.titel}“: `),
        `Text aus den ${tv.live ? "Live-Untertiteln" : "Untertiteln"}, je Sprecherwechsel ein Absatz. `
        + "Bilder, Einblendungen und Tonfall sind nicht berücksichtigt; Namen erschließt die Analyse aus dem Text.",
        zustand.videos.length > 1 && el("div", { style: "margin-top:6px" },
          el("button", { onclick: auswahlZeigen }, "Anderes Video dieser Seite")))));

    if (tv) abschnitte.push(beitraegeAbschnitt(a, tv));

    // Kennzahl
    const k = kennzahlText(a.kennzahl);
    abschnitte.push(el("section", {}, el("h2", {}, "Kennzahl"),
      el("div", { class: "gross" }, k.gross),
      el("div", { class: "klein" }, k.klein)));

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
      el("div", { class: "klein" }, STUFEN + ". Gestrichelt markiert = strittig, gepunktet = nur strukturell.")));

    // Richtung
    const r = a.richtung;
    abschnitte.push(el("section", {}, el("h2", {}, "Richtung der Wertung"),
      el("div", { class: "gross" }, RICHTUNG[r.einordnung]),
      r.zugunsten.length > 0 && el("div", {}, "zugunsten: ", el("b", {}, r.zugunsten.join(", "))),
      r.zulasten.length > 0 && el("div", {}, "zulasten: ", el("b", {}, r.zulasten.join(", "))),
      el("div", { class: "klein" }, r.begruendung)));

    // Strategische Muster
    const sm = a.strategische_muster;
    if (!sm) {
      abschnitte.push(el("section", {}, el("h2", {}, "Strategische Muster"),
        el("div", { class: "klein" }, "Dieses Ergebnis stammt aus einer älteren Version ohne Musterprüfung. ↻ analysiert neu (kostet).")));
    } else {
      const index = sm.muster.length && !tv ? seitenIndex() : null;
      abschnitte.push(el("section", {}, el("h2", {}, `Strategische Muster (${sm.muster.length})`),
        sm.muster.length === 0 && el("div", {}, "Keine Muster gezielter Rahmung erkannt."),
        sm.muster.map((mu) => el("div", { class: "muster" },
          el("div", {}, el("b", {}, MUSTER[mu.art] || mu.art), mu.strittig && el("span", { class: "marke" }, "strittig")),
          el("div", { class: "klein" }, mu.begruendung),
          el("ul", {}, mu.belege.map((b) => {
            const da = vorhanden(index, b);
            return el("li", { class: "fund" + (da ? "" : " fehlt"), onclick: () => da && stelleAnzeigen(b) },
              el("span", {}, da ? "" : "⚠ ", `„${b}“`));
          })))),
        sm.leitbegriffe.length > 0 && el("div", { class: "klein", style: "margin-top:6px" }, "Leitbegriffe: ", sm.leitbegriffe.join(" · ")),
        el("div", { class: "klein", style: "margin-top:6px" },
          "Muster beschreiben, wie der Text gebaut ist, nicht was jemand beabsichtigt hat. Sie zählen nicht in Teilwerten und Kennzahl.")));
    }

    // Wer kommt zu Wort
    abschnitte.push(stimmenAbschnitt(a.stimmen, tv));

    // Wertung über Zitate („opportune Zeugen“)
    if (a.zitatwertungen) {
      const index = !tv && a.zitatwertungen.liste.length ? seitenIndex() : null;
      abschnitte.push(el("section", {}, el("h2", {}, `Wertung über Zitate (${a.zitatwertungen.liste.length})`),
        zitatwertungenDarstellen(a.zitatwertungen, { marke: "marke", da: (z) => vorhanden(index, z), zeigen: stelleAnzeigen })));
    } else if (a.stimmen) {
      abschnitte.push(el("section", {}, el("h2", {}, "Wertung über Zitate"),
        el("div", { class: "klein" }, "Dieses Ergebnis stammt aus einer älteren Version ohne diese Prüfung. ↻ analysiert neu (kostet).")));
    }

    // Spiegelprobe (auf Knopfdruck, eigener API-Aufruf)
    abschnitte.push(el("section", { id: "spiegel" }, spiegelInhalt()));

    // Neutrale Fassung
    abschnitte.push(el("section", {}, el("h2", {}, "Neutrale Fassung"), el("div", {}, a.neutrale_fassung)));

    // Fundstellen: im Fernsehmodus steht der Text nicht auf der Seite, sondern als Transkript in der Leiste
    if (tv) abschnitte.push(...transkriptAbschnitte(a, tv));
    const fehlend = karte.zuordnung.filter((z) => z < 0).length;
    if (!tv) abschnitte.push(el("section", {}, el("h2", {}, `Fundstellen (${a.markierungen.length})`),
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
    abschnitte.push(el("div", { class: "fuss" },
      metaText(ergebnis.meta) + (ausSpeicher ? " Aus dem Zwischenspeicher, ohne neuen API-Aufruf." : "")));

    inhaltSetzen(...abschnitte);
    $("pdf").disabled = false;
  }

  // ------------------------------------------------------------ Bericht als PDF

  // Übergibt Ergebnis, Spiegelprobe und Artikeltext ans Hintergrundskript; das öffnet die Druckansicht bericht.html.
  // Rückmeldung per Callback statt Promise: funktioniert gleich in Chrome und Firefox.
  function berichtOeffnen() {
    if (!zustand.ergebnis) return;
    $("pdf").disabled = true;
    $("pdf-fehler")?.remove();
    const fertig = (fehler) => {
      $("pdf").disabled = false;
      if (!fehler) return;
      $("inhalt").prepend(el("div", { class: "warn", id: "pdf-fehler" },
        el("b", {}, "PDF-Bericht ließ sich nicht öffnen: "), fehler,
        el("div", { class: "klein" }, `Addon-Version ${chrome.runtime.getManifest().version}`)));
      $("inhalt").scrollTop = 0;
    };
    try {
      chrome.runtime.sendMessage({ art: "bericht_oeffnen", daten: {
        ergebnis: zustand.ergebnis, spiegel: zustand.spiegel, text: zustand.text,
        url: location.href, titel: document.title, erstellt: new Date().toISOString(),
        version: chrome.runtime.getManifest().version,
      } }, (antwort) => {
        const le = chrome.runtime.lastError;
        fertig(le ? le.message : antwort && antwort.ok ? null : (antwort && antwort.text) || "keine Antwort vom Hintergrundskript");
      });
    } catch (e) {
      fertig(e.message);
    }
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
    const halt = wachHalten(port);
    let erledigt = false;
    const ende = () => { erledigt = true; halt(); zustand.spiegelLaeuft = false; port.disconnect(); };
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
    port.postMessage({ art: "spiegel", url: zustand.url, text: zustand.text });
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
    const { abweichend, teilwerte, mo, ms, so, ss, musterGleich, namen, richtung } = spiegelVergleich(a, s);
    const zeilen = teilwerte.map((t) => el("tr", {},
      el("td", {}, el("span", { class: "punkt", style: `background:${t.farbe}` }), " ", t.name),
      el("td", { class: "zahl" }, String(t.original)), el("td", { class: "zahl" }, String(t.gegen)),
      el("td", {}, t.abweichend ? el("span", { class: "marke" }, "abweichend") : "")));
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
        el("div", { class: "warn" }, "Konstruierter Prüftext mit vertauschten Seiten, kein echter Artikel."),
        g.tausch.length > 0 && el("ul", {}, g.tausch.map((t) => el("li", { class: "klein" }, `„${t.original}“ → „${t.spiegel}“`))),
        el("div", { class: "gegentext" }, g.text)),
      el("div", { class: "klein" }, "Ein einzelner Lauf schwankt; erst wiederholte Abweichungen sind aussagekräftig."),
      neu];
  }

  // Verzeichnis der Stimmen: Aussagen je Position (Balken), je Typ, die Stimmen selbst, Akteure ohne Stimme
  function stimmenAbschnitt(st, tv = null) {
    const titel = "Wer kommt zu Wort";
    if (!st) {
      return el("section", {}, el("h2", {}, titel),
        el("div", { class: "klein" }, "Dieses Ergebnis stammt aus einer älteren Version ohne Stimmenverzeichnis. ↻ analysiert neu (kostet)."));
    }
    const liste = st.liste;
    const { summe, positionen, mitHaltung, herkunft } = stimmenZaehlen(liste);
    const index = liste.length && !tv ? seitenIndex() : null;
    const rz = redezeit(st, tv);
    const sekunden = new Map(rz ? rz.jeStimme.map((s) => [s.sprecher, s.sekunden]) : []);
    const maxSek = rz ? Math.max(1, ...rz.positionen.map((p) => p.sekunden)) : 1;

    return el("section", {}, el("h2", {}, titel),
      liste.length === 0
        ? el("div", {}, "Der Text schreibt niemandem eine Aussage zu.")
        : el("div", { class: "gross" }, `${liste.length} ${liste.length === 1 ? "Stimme" : "Stimmen"}, ${summe} ${summe === 1 ? "Aussage" : "Aussagen"}`),
      mitHaltung && el("h3", {}, "Aussagen nach Position"),
      mitHaltung && positionen.map((p) => el("div", { class: "pos" },
        el("div", { class: "pos-kopf" }, el("span", {}, p.name),
          el("span", { class: "klein" }, `${p.aussagen} (${p.stimmen} ${p.stimmen === 1 ? "Stimme" : "Stimmen"})`)),
        el("div", { class: "pos-balken", style: `width:${summe ? Math.max(2, Math.round(100 * p.aussagen / summe)) : 0}%` }))),
      rz && rz.gesamt > 0 && el("h3", {}, "Redezeit im O-Ton nach Position"),
      rz && rz.gesamt > 0 && rz.positionen.map((p) => el("div", { class: "pos" },
        el("div", { class: "pos-kopf" }, el("span", {}, p.name), el("span", { class: "klein" }, `${p.sekunden} s`)),
        el("div", { class: "pos-balken", style: `width:${Math.max(2, Math.round(100 * p.sekunden / maxSek))}%` }))),
      rz && rz.gesamt > 0 && el("div", { class: "klein" }, `O-Töne ${rz.oton} s, Sprechertext und Moderation ${rz.sprechertext} s `
        + `von ${rz.gesamt} s. Gemessen an den Untertitelzeiten; die Zuordnung der Absätze stammt aus der Analyse.`),
      liste.length > 0 && el("h3", {}, "Aussagen nach Herkunft"),
      liste.length > 0 && el("div", { class: "klein" }, herkunft),
      liste.length > 0 && el("h3", {}, "Stimmen"),
      liste.length > 0 && el("ul", {}, liste.map((s) => {
        const da = vorhanden(index, s.erstes_vorkommen);
        return el("li", { class: "fund" + (da ? "" : " fehlt"), title: `„${s.erstes_vorkommen}“`,
          onclick: () => da && stelleAnzeigen(s.erstes_vorkommen) },
          el("span", {}, da ? "" : "⚠ ", el("b", {}, s.sprecher), ` · ${s.aussagen}×`,
            sekunden.get(s.sprecher) ? ` · ${sekunden.get(s.sprecher)} s O-Ton` : "",
            s.anonym && el("span", { class: "marke" }, "anonym"),
            el("div", { class: "klein" }, STIMMEN_TYP[s.typ] || s.typ, mitHaltung ? ` · ${s.position}` : "")));
      })),
      st.ohne_stimme.length > 0 && el("h3", {}, "Genannt, aber ohne eigene Aussage"),
      st.ohne_stimme.length > 0 && el("ul", {}, st.ohne_stimme.map((o) => el("li", {},
        el("b", {}, o.akteur), `: ${o.rolle}`, VERMERK[o.vermerk] && el("span", { class: "marke" }, VERMERK[o.vermerk])))),
      el("div", { class: "klein", style: "margin-top:6px" },
        "Bestandsaufnahme aus dem Text, zählt nicht in Teilwerten und Kennzahl. Wer im Text gar nicht vorkommt, wird nicht als fehlend gewertet."));
  }

  // ------------------------------------------------------------ Fernsehmodus: Transkript in der Leiste

  // Zitat im Seitentext (Artikel) oder im Transkript der Leiste (Fernsehbeitrag)
  const vorhanden = (index, zitat) => (zustand.ergebnis && zustand.ergebnis.tv ? true : !!stelleFinden(index, zitat));
  const stelleAnzeigen = (zitat) => (zustand.ergebnis && zustand.ergebnis.tv ? transkriptZeigen(zitat) : stelleZeigen(zitat));

  // Beiträge einer ganzen Sendung: Thema, Art, Sendezeit, Werte und O-Ton je Beitrag; Klick springt zum Trennkopf
  function beitraegeAbschnitt(a, tv) {
    const bt = beitraegeBerechnen(zeilenLesen(zustand.text), a, tv);
    if (!bt) return null;
    return el("section", {}, el("h2", {}, `Beiträge der Sendung (${bt.liste.length})`),
      el("div", { class: "klein" }, "Sendezeit aus den Untertitelzeiten, Werte je Beitrag aus der Analyse "
        + "(W Wortwahl, E Rahmung, Q Quellen, A Auswahl, Ü Überschrift/Anmoderation, 0–4)."),
      beitraegeDarstellen(bt.liste, (b) => beitragZeigen(b.nr)));
  }

  function beitragZeigen(nr) {
    const ziel = schatten.querySelector(`#transkript .beitrag-kopf[data-beitrag="${nr}"]`);
    if (!ziel) return;
    if (leiste.classList.contains("eingeklappt")) einklappen(false);
    ziel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function transkriptAbschnitte(a, tv) {
    const basis = zeilenLesen(zustand.text);
    const bt = beitraegeBerechnen(basis, a, tv);
    const zeilen = bt ? bt.zeilen : basis;
    const index = textIndex(zeilen);
    const tk = bereicheFinden(index, a.markierungen);
    const rz = redezeit(a.stimmen, tv);
    const etikett = (z) => absatzEtikett(z, rz, tv);
    const fehlend = tk.gefunden.filter((x) => !x).length;
    return [
      el("section", { id: "transkript" }, el("h2", {}, "Transkript mit Markierungen"),
        el("div", { class: "klein" }, "Farben wie im Artikel; gestrichelt = strittig, gepunktet = nur strukturell. "
          + "Ziffern verweisen auf die Fundstellen darunter."),
        el("div", { class: "artikel" }, artikelDarstellen(zeilen, index, tk, a.markierungen, etikett))),
      el("section", {}, el("h2", {}, `Fundstellen (${a.markierungen.length})`),
        fehlend > 0 && el("div", { class: "warn" }, `${fehlend} Fundstellen stehen nicht wörtlich im Transkript (mit ⚠).`),
        a.markierungen.length === 0 && el("div", { class: "klein" }, "Keine wertenden Stellen markiert."),
        el("div", { class: "fundliste" }, tk.reihe.map((i) => fundDarstellen(a.markierungen[i], tk.nummer[i], tk.gefunden[i],
          { onclick: () => transkriptZeigen(a.markierungen[i].zitat), style: "cursor:pointer" })))),
    ];
  }

  // Springt im Transkript der Leiste zu dem Absatz, der das Zitat enthält, und hebt ihn kurz hervor
  function transkriptZeigen(zitat) {
    const z = normalisieren(zitat);
    const ziel = [...schatten.querySelectorAll("#transkript .artikel > *")].find((e) => {
      const kopie = e.cloneNode(true);
      kopie.querySelectorAll(".markenname, sup").forEach((x) => x.remove());
      return normalisieren(kopie.textContent).includes(z);
    });
    if (!ziel) return;
    if (leiste.classList.contains("eingeklappt")) einklappen(false);
    ziel.scrollIntoView({ behavior: "smooth", block: "center" });
    ziel.classList.add("blinken");
    setTimeout(() => ziel.classList.remove("blinken"), 1600);
  }

  function hinspringen(bi) {
    const marks = zustand.karte.bereiche[bi].marks;
    if (!marks.length) return;
    hinscrollen(marks[0], marks[0]);
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

  // Zeigt Begründung, Wirkung, Wortleiter und Alternative zu einer Markierung; gibt false zurück, wenn es nichts zu zeigen gibt
  function hinweisZeigen(mark) {
    const tip = $("tip");
    const bereich = zustand.karte && zustand.karte.bereiche[Number(mark.dataset.wa)];
    if (!bereich) return false;
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
    tip.dataset.wa = mark.dataset.wa;
    const r = mark.getBoundingClientRect();
    const breite = Math.min(360, window.innerWidth - 20);
    tip.style.left = Math.max(10, Math.min(r.left, window.innerWidth - breite - 10)) + "px";
    const hoehe = tip.offsetHeight;
    tip.style.top = (r.bottom + 8 + hoehe < window.innerHeight ? r.bottom + 8 : Math.max(10, r.top - hoehe - 8)) + "px";
    return true;
  }

  const markeUnter = (e) => (e.target instanceof Element ? e.target.closest("wa-mark") : null);
  const markierungenAn = () => !!zustand.karte && !document.documentElement.classList.contains("wa-aus");
  // Geräte ohne Maus melden beim Tippen ebenfalls "mouseover"; dort entscheidet allein der Tipp
  const beruehrung = window.matchMedia("(hover: none)").matches;

  document.addEventListener("mouseover", (e) => {
    if (beruehrung) return;
    const mark = markeUnter(e);
    if (!mark || !markierungenAn() || !hinweisZeigen(mark)) $("tip").hidden = true;
  });

  // Antippen: erster Tipp auf eine Markierung zeigt den Hinweis (und folgt keinem Link), ein zweiter Tipp
  // auf dieselbe Stelle schließt ihn und verhält sich wieder normal; Tippen daneben schließt ihn.
  document.addEventListener("click", (e) => {
    if (!beruehrung || e.target === host) return;
    const tip = $("tip");
    const mark = markeUnter(e);
    if (!mark || !markierungenAn()) { tip.hidden = true; return; }
    if (!tip.hidden && tip.dataset.wa === mark.dataset.wa) { tip.hidden = true; return; }
    if (hinweisZeigen(mark)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.addEventListener("scroll", () => { if (beruehrung) $("tip").hidden = true; }, { passive: true });

  beginnen();
})();
