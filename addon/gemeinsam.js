// Gemeinsame Bezeichnungen und Hilfen für die Seitenleiste (inhalt.js) und den Bericht (bericht.js).
// Zuweisung an globalThis statt const: Das Inhaltsskript wird bei jedem Klick erneut eingefügt.
globalThis.WA_GEMEINSAM = (() => {
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
  const RICHTUNG = { parteinahme: "Parteinahme", zuspitzung_ohne_parteinahme: "Zuspitzung ohne Parteinahme",
    keine_erkennbare_richtung: "Keine erkennbare Richtung" };
  const RICHTUNG_KURZ = { parteinahme: "Parteinahme", zuspitzung_ohne_parteinahme: "Zuspitzung", keine_erkennbare_richtung: "keine Richtung" };
  const TEXTLAGE = { unvollstaendig: "Der Text ist unvollständig (z. B. Bezahlschranke).",
    nur_zusammenfassung: "Es lag nur eine Zusammenfassung vor, kein Wortlaut.", kein_artikel: "Das Modell hat hier keinen Artikel erkannt." };
  const GATTUNG_KOMMENTAR = new Set(["Kommentar/Meinung", "Glosse"]);
  const MIN_SAETZE_FUER_ANTEIL = 15;
  const STUFEN = "0 keine · 1 vereinzelt · 2 wiederkehrend · 3 häufig · 4 durchgehend";

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

  // ------------------------------------------------------------ Kennzahl und Spiegelvergleich

  function kennzahlText(k) {
    const kurz = k.gesamt < MIN_SAETZE_FUER_ANTEIL;
    return {
      gross: `${k.markiert} von ${k.gesamt} Sätzen wertend` + (!kurz && k.gesamt ? ` (${Math.round(100 * k.markiert / k.gesamt)} %)` : ""),
      klein: (k.strittig ? `plus ${k.strittig} strittige. ` : "")
        + (kurz ? `Kurzer Text (unter ${MIN_SAETZE_FUER_ANTEIL} Sätzen): nur absolute Zahlen.` : "Gezählt: Überschrift, Vorspann, Zwischenüberschriften, Fließtext."),
    };
  }

  // Original (a) gegen Analyse der Gegenfassung (s). Nur nicht strittige Muster entscheiden;
  // Muster, die nur strittig vorkommen, werden bloß genannt (wie wertung.py).
  function spiegelVergleich(a, s) {
    const abweichend = [];
    const teilwerte = Object.entries(DIM).map(([schl, d]) => {
      const original = a.teilwerte[schl].wert, gegen = s.teilwerte[schl].wert;
      const ab = Math.abs(original - gegen) > 1;
      if (ab) abweichend.push(d.name);
      return { schl, ...d, original, gegen, abweichend: ab };
    });
    const arten = (x, strittig) => new Set(((x.strategische_muster || {}).muster || [])
      .filter((m) => !!m.strittig === strittig).map((m) => m.art));
    const mo = arten(a, false), ms = arten(s, false);
    const so = [...arten(a, true)].filter((x) => !mo.has(x)), ss = [...arten(s, true)].filter((x) => !ms.has(x));
    const musterGleich = mo.size === ms.size && [...mo].every((x) => ms.has(x));
    if (!musterGleich) abweichend.push("Muster");
    if (a.kennzeichnungsproblem.vorhanden !== s.kennzeichnungsproblem.vorhanden) abweichend.push("Kennzeichnung");
    if (a.richtung.einordnung !== s.richtung.einordnung) abweichend.push("Richtung");
    const namen = (menge) => [...menge].map((x) => MUSTER[x] || x).join(", ") || "keine";
    const richtung = (r) => RICHTUNG_KURZ[r.einordnung] + (r.zugunsten.length ? ` zugunsten ${r.zugunsten.join(", ")}` : "");
    return { abweichend, teilwerte, mo, ms, so, ss, musterGleich, namen, richtung };
  }

  // Positionen in der Reihenfolge ihres ersten Auftretens, gleicher Wortlaut = gleiche Position
  function stimmenZaehlen(liste) {
    const summe = liste.reduce((n, s) => n + s.aussagen, 0);
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
    const herkunft = [...typen.entries()].sort((x, y) => y[1] - x[1]).map(([t, n]) => `${STIMMEN_TYP[t] || t} ${n}`).join(" · ");
    return { summe, positionen: [...positionen.values()], mitHaltung, herkunft };
  }

  function metaText(m) {
    const datum = new Date(m.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
    return `${m.modell || m.modell_angefragt}, effort ${m.effort}, ${m.dauer_s} s`
      + (m.kosten_usd_ca != null ? `, ca. ${m.kosten_usd_ca.toFixed(2).replace(".", ",")} $` : "")
      + (m.modell && m.modell !== m.modell_angefragt ? ` (Ersatzmodell statt ${m.modell_angefragt})` : "")
      + `. Analysiert am ${datum}.`;
  }

  // Kleiner Baukasten für DOM-Elemente (Text wird nie als HTML gelesen)
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

  // ------------------------------------------------------------ Analysierten Text darstellen (Bericht, Transkript in der Leiste)

  const MARKE = /^\[(Bildunterschrift|Kasten|Teaser|Unterzeile|Vorspann|Zwischenüberschrift|Autor|Ressort|Absatz \d+)\]\s*/;
  const NEBENTEXT = new Set(["Bildunterschrift", "Kasten", "Teaser", "Autor", "Ressort"]);

  // Zeilen des an die Analyse geschickten Texts: Herkunftszeilen (URL:, Quelle:) weg, erste Zeile ohne Marke = Überschrift,
  // [Absatz N] (Fernsehtranskript) mit Nummer
  function zeilenLesen(text) {
    const roh = (text || "").normalize("NFC").split("\n").map((z) => z.trim()).filter(Boolean);
    while (roh.length && /^(URL|Quelle):/.test(roh[0])) roh.shift();
    let ueberschrift = false;
    return roh.map((z) => {
      const m = z.match(MARKE);
      if (m && m[1].startsWith("Absatz ")) return { art: "Absatz", nr: Number(m[1].slice(7)), text: z.slice(m[0].length) };
      if (m) return { art: m[1], text: z.slice(m[0].length) };
      if (ueberschrift) return { art: "", text: z };
      ueberschrift = true;
      return { art: "Überschrift", text: z };
    });
  }

  // Vergleichsform aller Zeilen mit Zuordnung jedes Zeichens zu Zeile und Stelle (wie seitenIndex in inhalt.js)
  function textIndex(zeilen) {
    let text = "";
    const zeile = [], off = [];
    zeilen.forEach((z, zi) => {
      if (text && !text.endsWith(" ")) { text += " "; zeile.push(-1); off.push(-1); }
      for (let i = 0; i < z.text.length; i++) {
        const c = zeichen(z.text[i]);
        if (c === "") continue;
        if (c === " " && (text === "" || text.endsWith(" "))) continue;
        text += c; zeile.push(zi); off.push(i);
      }
    });
    return { text, zeile, off };
  }

  // Bereiche im Text: überlappende Fundstellen werden zu einem Bereich mit mehreren Befunden
  function bereicheFinden(index, markierungen) {
    const bereiche = [];
    const start = markierungen.map((m, i) => {
      const z = normalisieren(m.zitat).trim();
      const pos = z ? index.text.indexOf(z) : -1;
      if (pos < 0) return -1;
      const ende = pos + z.length - 1;
      const b = bereiche.find((x) => pos <= x.ende && x.start <= ende);
      if (b) { b.start = Math.min(b.start, pos); b.ende = Math.max(b.ende, ende); b.befunde.push(i); }
      else bereiche.push({ start: pos, ende, befunde: [i] });
      return pos;
    });
    // Nummern in Lesereihenfolge; nicht gefundene Stellen ans Ende
    const reihe = markierungen.map((m, i) => i)
      .sort((x, y) => (start[x] < 0) - (start[y] < 0) || start[x] - start[y] || x - y);
    const nummer = [];
    reihe.forEach((i, n) => { nummer[i] = n + 1; });
    for (const b of bereiche) b.befunde.sort((x, y) => nummer[x] - nummer[y]);
    return { bereiche, nummer, reihe, gefunden: start.map((s) => s >= 0) };
  }

  // Text mit farbigen, nummerierten Markierungen; etikett(z) beschriftet Absätze eines Transkripts
  function artikelDarstellen(zeilen, index, karte, markierungen, etikett = (z) => `Absatz ${z.nr}`) {
    // Stücke je Zeile: [von, bis) in der Zeile, zu welchem Bereich, ob letztes Stück des Bereichs
    const stuecke = zeilen.map(() => []);
    karte.bereiche.forEach((b, bi) => {
      const teile = [];
      for (let p = b.start; p <= b.ende; p++) {
        const zi = index.zeile[p];
        if (zi < 0) continue;
        const letztes = teile[teile.length - 1];
        if (letztes && letztes.zi === zi) letztes.bis = index.off[p] + 1;
        else teile.push({ zi, von: index.off[p], bis: index.off[p] + 1, bi });
      }
      if (teile.length) teile[teile.length - 1].letztes = true;
      for (const t of teile) stuecke[t.zi].push(t);
    });

    return zeilen.map((z, zi) => {
      const kinder = [];
      let pos = 0;
      for (const s of stuecke[zi].sort((x, y) => x.von - y.von)) {
        if (s.von < pos) continue;
        kinder.push(z.text.slice(pos, s.von));
        const b = karte.bereiche[s.bi];
        const erste = markierungen[b.befunde[0]];
        const klasse = `wa d-${erste.dimension}` + (erste.strittig ? " strittig" : "") + (erste.nur_struktur ? " struktur" : "");
        kinder.push(el("span", { class: klasse, "data-bereich": String(s.bi) }, z.text.slice(s.von, s.bis)));
        if (s.letztes) kinder.push(el("sup", { class: `nr d-${erste.dimension}` }, b.befunde.map((i) => karte.nummer[i]).join(",")));
        pos = s.bis;
      }
      kinder.push(z.text.slice(pos));
      if (z.art === "Überschrift") return el("div", { class: "ueberschrift" }, kinder);
      if (z.art === "Zwischenüberschrift") return el("p", { class: "zwischen" }, kinder);
      if (z.art === "Absatz") {
        const e = etikett(z);
        return el("p", { class: "absatz" + (e.oton ? " oton" : "") }, el("span", { class: "markenname" }, e.text || e), kinder);
      }
      const klasse = z.art === "Vorspann" || z.art === "Unterzeile" ? "vorspann" : NEBENTEXT.has(z.art) ? "nebentext" : "";
      return el("p", { class: klasse }, z.art && el("span", { class: "markenname" }, z.art), kinder);
    });
  }

  // Wortleiter als Block (Bericht und Fundstellen der Leiste): gewähltes Wort gefüllt, neutrales grün umrandet
  function wortleiterBlock(wl) {
    const n = wl && Array.isArray(wl.stufen) ? wl.stufen.length : 0;
    if (n < 2 || !(wl.gewaehlt >= 0 && wl.gewaehlt < n)) return null;
    return el("div", { class: "leiter" },
      el("span", { class: "pol" }, "−"),
      wl.stufen.map((s, i) => el("span", {
        class: "stufe" + (i === wl.gewaehlt ? " gewaehlt" : "") + (i === wl.neutral ? " neutral" : ""),
      }, s)),
      el("span", { class: "pol" }, "+"));
  }

  // Eine Fundstelle mit Nummer, Dimension, Zitat, Begründung, Wirkung, Wortleiter und neutraler Alternative
  function fundDarstellen(m, nummer, gefunden, attribute = {}) {
    const d = DIM[m.dimension];
    return el("div", { class: `fund d-${m.dimension}`, ...attribute },
      el("div", { class: "nr-kreis" }, String(nummer)),
      el("div", {},
        el("div", { class: "dim" }, d.name,
          m.strittig && el("span", { class: "etikett" }, "strittig"),
          m.nur_struktur && el("span", { class: "etikett" }, "strukturell"),
          m.ausserhalb_zaehlbasis && el("span", { class: "etikett" }, "außerhalb Zählbasis")),
        el("div", { class: "zitat" }, gefunden ? "" : "⚠ ", `„${m.zitat}“`),
        el("div", { class: "begr" }, m.begruendung),
        m.wirkung && el("div", { class: "wirk" }, el("b", {}, "Wirkung: "), m.wirkung),
        wortleiterBlock(m.wortleiter),
        m.alternative && el("div", { class: "alt" }, el("b", {}, "Neutral: "), m.alternative)));
  }

  // ------------------------------------------------------------ Fernsehbeiträge (tagesschau.de, wie tagesschau.py)

  const FARBE = { textWhite: "weiß", textYellow: "gelb", textCyan: "cyan", textGreen: "grün", textMagenta: "magenta",
    textBlue: "blau", textRed: "rot", textBlack: "schwarz" };
  const GERAEUSCH = /\*[^*]{0,80}\*/g;
  const LIVE = /Diese Sendung wurde[^.()]*?live untertitelt/i;
  const VERMERK_UT = /^\s*(Copyright|©)\s*Untertitel/i;

  // Videos der Seite mit deutschen Untertiteln (EBU-TT) aus den Player-Daten (Attribut data-v)
  function tagesschauVideos(doc) {
    const gefunden = [], gesehen = new Set();
    for (const e of doc.querySelectorAll("[data-v]")) {
      let daten;
      try { daten = JSON.parse(e.getAttribute("data-v")); } catch { continue; }
      const mc = (daten && daten.mc) || {};
      const quelle = (mc.subtitles || []).filter((u) => u.languageCode === "de")
        .flatMap((u) => u.sources || []).find((q) => q.kind === "ebutt" && q.url);
      if (!quelle || gesehen.has(quelle.url)) continue;
      gesehen.add(quelle.url);
      const clip = ((((mc.pluginData || {})["trackingAgf@all"] || {}).clipData) || {}).title || "";
      const datum = clip.match(/(\d{4})\.(\d{2})\.(\d{2})/);
      gefunden.push({ titel: (mc.meta && mc.meta.title) || "ohne Titel", dauer_s: (mc.meta && mc.meta.durationSeconds) || null,
        untertitel: quelle.url, datum: datum ? `${datum[3]}.${datum[2]}.${datum[1]}` : null });
    }
    return gefunden;
  }

  // "00:15:31.920" oder "00:15:31:12" (Bilder bei 25/s) in Sekunden
  function sekunden(zeit) {
    const t = String(zeit || "0:0:0").trim().split(":");
    return Number(t[0]) * 3600 + Number(t[1]) * 60 + Number(t[2]) + (t.length > 3 ? Number(t[3]) / 25 : 0);
  }

  // Untertitel → Absätze (neuer Absatz bei Farbwechsel); Live-Hinweis und Copyright-Vermerk fallen weg
  function untertitelLesen(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const zeilen = [];
    let live = false;
    for (const p of doc.getElementsByTagNameNS("*", "p")) {
      if (!p.getAttribute("begin")) continue;
      let stuecke = [...p.getElementsByTagNameNS("*", "span")]
        .map((sp) => [sp.getAttribute("style") || p.getAttribute("style") || "", sp.textContent.replace(/\s+/g, " ").trim()])
        .filter(([, t]) => t);
      if (!stuecke.length) {
        const t = p.textContent.replace(/\s+/g, " ").trim();
        stuecke = t ? [[p.getAttribute("style") || "", t]] : [];
      }
      const ganz = stuecke.map(([, t]) => t).join(" ");
      if (LIVE.test(ganz)) { live = true; continue; }
      if (VERMERK_UT.test(ganz)) continue;
      for (const [stil, t] of stuecke) zeilen.push({ stil, t, beginn: sekunden(p.getAttribute("begin")), ende: sekunden(p.getAttribute("end")) });
    }
    const teile = [];
    for (const z of zeilen) {
      const text = z.t.replace(GERAEUSCH, " ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const farbe = FARBE[z.stil] || z.stil || "ohne";
      const letzter = teile[teile.length - 1];
      if (letzter && letzter.farbe === farbe) { letzter.text += " " + text; letzter.ende = z.ende; }
      else teile.push({ farbe, beginn: z.beginn, ende: z.ende, text });
    }
    teile.forEach((t, i) => { t.nr = i + 1; t.sekunden = Math.round((t.ende - t.beginn) * 10) / 10; });
    return { teile, live };
  }

  // Text für die Analyse: Herkunft, Titel, je Sprecherwechsel ein Absatz mit Marke [Absatz N]
  function transkriptText(seite, video, teile, live) {
    const quelle = `Quelle: tagesschau.de, Video „${video.titel}“` + (video.datum ? ` vom ${video.datum}` : "") + ". Text aus den "
      + (live ? "Live-Untertiteln (können gekürzt oder umformuliert sein)" : "Untertiteln")
      + ". Fernsehbeitrag: Jeder Absatz [Absatz N] ist ein Sprecherwechsel (an der Untertitelfarbe erkannt); "
      + "Bilder, Grafiken und Namenseinblendungen fehlen.";
    return [`URL: ${seite}`, quelle, video.titel, ...teile.map((t) => `[Absatz ${t.nr}] ${t.text}`)].join("\n");
  }

  // Redezeit aus den O-Ton-Absätzen je Stimme (Feld absaetze) und den Zeiten der Untertitel
  function redezeit(stimmen, tv) {
    if (!tv || !Array.isArray(tv.absaetze) || !stimmen) return null;
    const dauer = new Map(tv.absaetze.map((a) => [a.nr, a.sekunden || 0]));
    const vergeben = new Set();
    const jeStimme = stimmen.liste.map((s) => {
      const nrn = (s.absaetze || []).filter((n) => dauer.has(n) && !vergeben.has(n));
      nrn.forEach((n) => vergeben.add(n));
      return { sprecher: s.sprecher, position: s.position.trim(), absaetze: nrn,
        sekunden: Math.round(nrn.reduce((x, n) => x + dauer.get(n), 0)) };
    });
    const positionen = new Map();
    for (const s of jeStimme) {
      if (!s.sekunden) continue;
      const k = s.position.toLowerCase();
      const p = positionen.get(k) || { name: s.position, sekunden: 0, stimmen: 0 };
      p.sekunden += s.sekunden; p.stimmen += 1;
      positionen.set(k, p);
    }
    const gesamt = Math.round(tv.absaetze.reduce((x, a) => x + (a.sekunden || 0), 0));
    const oton = jeStimme.reduce((x, s) => x + s.sekunden, 0);
    return { jeStimme, positionen: [...positionen.values()].sort((a, b) => b.sekunden - a.sekunden),
      oton, sprechertext: Math.max(0, gesamt - oton), gesamt,
      absatzStimme: new Map(jeStimme.flatMap((s) => s.absaetze.map((n) => [n, s.sprecher]))) };
  }

  return { DIM, MUSTER, STIMMEN_TYP, VERMERK, RICHTUNG, RICHTUNG_KURZ, TEXTLAGE, GATTUNG_KOMMENTAR, MIN_SAETZE_FUER_ANTEIL,
    STUFEN, zeichen, normalisieren, kennzahlText, spiegelVergleich, stimmenZaehlen, metaText, el,
    zeilenLesen, textIndex, bereicheFinden, artikelDarstellen, wortleiterBlock, fundDarstellen,
    tagesschauVideos, untertitelLesen, transkriptText, redezeit };
})();
