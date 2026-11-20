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

  return { DIM, MUSTER, STIMMEN_TYP, VERMERK, RICHTUNG, RICHTUNG_KURZ, TEXTLAGE, GATTUNG_KOMMENTAR, MIN_SAETZE_FUER_ANTEIL,
    STUFEN, zeichen, normalisieren, kennzahlText, spiegelVergleich, stimmenZaehlen, metaText, el };
})();
