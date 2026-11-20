// Druckansicht: zeigt ein gespeichertes Ergebnis als Bericht zum Speichern als PDF (Chrome-Druck).
// Die Daten legt hintergrund.js unter "bericht:<id>" ab; die id steht in der Adresse.
(() => {
  const { DIM, MUSTER, STIMMEN_TYP, VERMERK, RICHTUNG, TEXTLAGE, GATTUNG_KOMMENTAR, STUFEN,
    kennzahlText, spiegelVergleich, stimmenZaehlen, metaText, el, zeilenLesen, textIndex, bereicheFinden,
    artikelDarstellen, fundDarstellen, redezeit } = globalThis.WA_GEMEINSAM;
  const $ = (id) => document.getElementById(id);

  $("drucken").addEventListener("click", () => window.print());
  $("mitArtikel").addEventListener("change", (e) => $("teilArtikel")?.classList.toggle("ausgeblendet", !e.target.checked));
  $("mitGegen").addEventListener("change", (e) => $("teilGegen")?.classList.toggle("ausgeblendet", !e.target.checked));
  $("mitNeutral").addEventListener("change", (e) => $("teilNeutral")?.classList.toggle("ausgeblendet", !e.target.checked));

  const id = new URLSearchParams(location.search).get("id");
  chrome.storage.local.get("bericht:" + id).then((alles) => {
    const daten = alles["bericht:" + id];
    if (!daten) {
      $("bericht").replaceChildren(el("div", { class: "warn" },
        "Dieser Bericht ist nicht mehr gespeichert (Zwischenspeicher geleert oder älter als die letzten fünf). "
        + "In der Seitenleiste des Artikels erneut auf „PDF“ klicken."));
      return;
    }
    berichtZeigen(daten);
  });

  // ------------------------------------------------------------ Bausteine

  const balken = (wert, farbe) => el("span", { class: "balken" },
    [1, 2, 3, 4].map((s) => el("i", { style: s <= wert ? `background:${farbe}` : "" })));

  // ------------------------------------------------------------ Bericht

  function berichtZeigen(daten) {
    const a = daten.ergebnis.analyse;
    const zeilen = zeilenLesen(daten.text);
    const titel = zeilen.find((z) => z.art === "Überschrift")?.text || daten.titel || "Artikel";
    document.title = `Wertungsanalyse – ${titel}`;
    const index = textIndex(zeilen);
    const karte = bereicheFinden(index, a.markierungen);
    const tv = daten.ergebnis.tv || null;
    const rz = redezeit(a.stimmen, tv);
    const teile = [];

    // Kopf
    teile.push(el("header", { class: "kopf" },
      el("div", { class: "marke-oben" }, "Wertungsanalyse"),
      el("h1", {}, titel),
      el("div", { class: "url" }, daten.url),
      tv && el("div", { class: "meta" }, `Fernsehbeitrag, ${minuten(tv.absaetze.length ? tv.absaetze[tv.absaetze.length - 1].ende : 0)} min. Text aus den `
        + (tv.live ? "Live-Untertiteln" : "Untertiteln") + "; Bilder, Einblendungen und Tonfall sind nicht berücksichtigt."),
      el("div", { class: "meta" }, metaText(daten.ergebnis.meta))));

    // Überblick
    const k = kennzahlText(a.kennzahl);
    const r = a.richtung;
    teile.push(el("div", { class: "karten" },
      el("div", { class: "karte" }, el("div", { class: "titel" }, "Gattung"),
        el("div", { class: "gross" }, a.gattung.art), el("div", { class: "klein" }, a.gattung.begruendung),
        GATTUNG_KOMMENTAR.has(a.gattung.art) && el("div", { class: "klein", style: "margin-top:3px" },
          "Bei Meinungstexten ist Wertung Teil der Gattung, kein Fehler.")),
      el("div", { class: "karte" }, el("div", { class: "titel" }, "Kennzahl"),
        el("div", { class: "gross" }, k.gross), el("div", { class: "klein" }, k.klein)),
      el("div", { class: "karte" }, el("div", { class: "titel" }, "Richtung der Wertung"),
        el("div", { class: "gross" }, RICHTUNG[r.einordnung]),
        r.zugunsten.length > 0 && el("div", { class: "klein" }, "zugunsten: ", el("b", {}, r.zugunsten.join(", "))),
        r.zulasten.length > 0 && el("div", { class: "klein" }, "zulasten: ", el("b", {}, r.zulasten.join(", "))),
        el("div", { class: "klein" }, r.begruendung))));
    if (a.kennzeichnungsproblem.vorhanden) {
      teile.push(el("div", { class: "warn" }, el("b", {}, "Kennzeichnungsproblem: "), a.kennzeichnungsproblem.begruendung));
    }
    if (TEXTLAGE[a.textlage]) teile.push(el("div", { class: "warn" }, TEXTLAGE[a.textlage]));

    // Teilwerte
    teile.push(el("h2", {}, "Teilwerte (0–4)"),
      el("table", { class: "teilwerte" }, Object.entries(DIM).map(([schl, d]) => {
        const tw = a.teilwerte[schl];
        return el("tr", {},
          el("td", { class: "name" }, el("span", { class: "punkt", style: `background:${d.farbe}` }), d.name),
          el("td", { class: "wert" }, balken(tw.wert, d.farbe), el("b", {}, String(tw.wert))),
          el("td", { class: "klein" }, tw.begruendung));
      })),
      el("div", { class: "klein", style: "margin-top:3px" }, STUFEN + "."));

    // Strategische Muster
    const sm = a.strategische_muster;
    if (sm) {
      teile.push(el("h2", {}, `Strategische Muster (${sm.muster.length})`),
        sm.muster.length === 0 && el("p", {}, "Keine Muster gezielter Rahmung erkannt."),
        sm.muster.map((mu) => el("div", { class: "muster" },
          el("div", {}, el("b", {}, MUSTER[mu.art] || mu.art), mu.strittig && el("span", { class: "etikett" }, "strittig")),
          el("div", { class: "klein" }, mu.begruendung),
          el("ul", { class: "belege" }, mu.belege.map((b) => el("li", {}, `„${b}“`))))),
        sm.leitbegriffe.length > 0 && el("p", { class: "klein" }, el("b", {}, "Leitbegriffe: "), sm.leitbegriffe.join(" · ")),
        el("p", { class: "klein" }, "Muster beschreiben, wie der Text gebaut ist, nicht was jemand beabsichtigt hat. "
          + "Sie zählen nicht in Teilwerten und Kennzahl."));
    }

    // Wer kommt zu Wort
    if (a.stimmen) teile.push(...stimmenTeil(a.stimmen, rz));

    // Spiegelprobe mit Gegenfassung (abwählbar)
    if (daten.spiegel) teile.push(...spiegelTeil(a, daten.spiegel));

    // Artikel mit Markierungen
    const fehlend = karte.gefunden.filter((x) => !x).length;
    teile.push(el("section", { id: "teilArtikel" },
      el("div", { class: "gruppe" },
        el("h2", {}, tv ? "Transkript mit Markierungen" : "Artikel mit Markierungen"),
        el("div", { class: "legende" }, Object.entries(DIM).map(([schl, d]) =>
          el("span", {}, el("span", { class: `wa d-${schl}` }, d.name))),
          el("span", {}, "gestrichelt = strittig · gepunktet = nur strukturell · Ziffer = Nummer der Fundstelle"))),
      el("div", { class: "artikel" }, artikelDarstellen(zeilen, index, karte, a.markierungen, (z) => absatzEtikett(z, rz)))));

    // Fundstellen
    teile.push(el("section", {}, el("h2", {}, `Fundstellen (${a.markierungen.length})`),
      a.markierungen.some((m) => m.wortleiter?.stufen?.length > 1) && el("p", { class: "klein" },
        "Wortleiter: gleichbedeutende Ausdrücke von abwertend (−) bis aufwertend (+); schwarz = im Artikel, grün umrandet = neutral."),
      fehlend > 0 && el("div", { class: "warn" }, `${fehlend} von ${a.markierungen.length} Fundstellen stehen nicht wörtlich im `
        + "analysierten Text und sind oben nicht markiert (mit ⚠)."),
      a.markierungen.length === 0 && el("p", {}, "Keine wertenden Stellen markiert."),
      karte.reihe.map((i) => fundDarstellen(a.markierungen[i], karte.nummer[i], karte.gefunden[i]))));

    // Neutrale Fassung
    teile.push(el("section", { id: "teilNeutral" }, el("h2", {}, "Neutrale Fassung"),
      el("div", { class: "neutral-text" }, a.neutrale_fassung)));

    // Hinweise
    if (a.hinweise.length) teile.push(el("h2", {}, "Hinweise der Analyse"), el("ul", { class: "liste" }, a.hinweise.map((h) => el("li", {}, h))));

    // Fuß
    const erstellt = new Date(daten.erstellt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
    teile.push(el("div", { class: "fuss" },
      el("p", {}, "Automatische Analyse durch ein Sprachmodell. Teilwerte, Wirkung und Muster sind Einschätzungen, keine "
        + "Tatsachenfeststellungen; ein einzelner Lauf kann schwanken. Wirkung, Wortleiter, Muster und Stimmen gehen nicht in Teilwerte und Kennzahl ein."),
      el("p", {}, `Bericht erstellt am ${erstellt} · Addon-Version ${daten.version || "?"}`)));

    $("bericht").replaceChildren(...teile.flat().filter(Boolean));
  }

  const minuten = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

  // Absatz eines Transkripts: O-Ton mit Sprecher (aus der Analyse) oder Sprechertext
  function absatzEtikett(z, rz) {
    const sprecher = rz && rz.absatzStimme.get(z.nr);
    if (!sprecher) return { text: `${z.nr} · Sprechertext`, oton: false };
    return { text: `${z.nr} · ${/O-Ton/i.test(sprecher) ? sprecher : "O-Ton " + sprecher}`, oton: true };
  }

  // Redezeit im O-Ton nach Position und Anteil des Sprechertexts (nur Fernsehbeiträge)
  function redezeitTeil(rz) {
    if (!rz || !rz.gesamt) return [];
    const max = Math.max(1, ...rz.positionen.map((p) => p.sekunden));
    return [el("h3", {}, "Redezeit im O-Ton nach Position"),
      rz.positionen.length === 0 && el("p", { class: "klein" }, "Die Analyse hat keinem Absatz einen O-Ton zugeordnet."),
      ...rz.positionen.map((p) => el("div", { class: "pos" },
        el("div", { class: "pos-kopf" }, el("span", {}, p.name),
          el("span", { class: "klein" }, `${p.sekunden} s (${p.stimmen} ${p.stimmen === 1 ? "Stimme" : "Stimmen"})`)),
        el("div", { class: "pos-balken", style: `width:${Math.max(2, Math.round(100 * p.sekunden / max))}%` }))),
      el("p", { class: "klein" }, `O-Töne zusammen ${rz.oton} s, Sprechertext und Moderation ${rz.sprechertext} s, `
        + `Beitrag ${rz.gesamt} s. Gemessen an den Zeiten der Untertitel; welcher Absatz welcher Stimme gehört, hat die Analyse bestimmt.`)];
  }

  function stimmenTeil(st, rz) {
    const liste = st.liste;
    const { summe, positionen, mitHaltung, herkunft } = stimmenZaehlen(liste);
    const sekunden = new Map(rz ? rz.jeStimme.map((s) => [s.sprecher, s.sekunden]) : []);
    return [el("h2", {}, "Wer kommt zu Wort"),
      el("p", { class: "gross" }, liste.length === 0 ? "Der Text schreibt niemandem eine Aussage zu."
        : `${liste.length} ${liste.length === 1 ? "Stimme" : "Stimmen"}, ${summe} ${summe === 1 ? "Aussage" : "Aussagen"}`),
      mitHaltung && el("h3", {}, "Aussagen nach Position"),
      mitHaltung && positionen.map((p) => el("div", { class: "pos" },
        el("div", { class: "pos-kopf" }, el("span", {}, p.name),
          el("span", { class: "klein" }, `${p.aussagen} (${p.stimmen} ${p.stimmen === 1 ? "Stimme" : "Stimmen"})`)),
        el("div", { class: "pos-balken", style: `width:${summe ? Math.max(2, Math.round(100 * p.aussagen / summe)) : 0}%` }))),
      ...redezeitTeil(rz),
      liste.length > 0 && el("h3", {}, "Aussagen nach Herkunft"),
      liste.length > 0 && el("p", { class: "klein" }, herkunft),
      liste.length > 0 && el("h3", {}, "Stimmen"),
      liste.length > 0 && el("ul", { class: "liste spalten" }, liste.map((s) => el("li", {},
        el("b", {}, s.sprecher), ` · ${s.aussagen}×`, sekunden.get(s.sprecher) ? ` · ${sekunden.get(s.sprecher)} s O-Ton` : "",
        s.anonym && el("span", { class: "etikett" }, "anonym"),
        el("div", { class: "klein" }, STIMMEN_TYP[s.typ] || s.typ, mitHaltung ? ` · ${s.position}` : "")))),
      st.ohne_stimme.length > 0 && el("h3", {}, "Genannt, aber ohne eigene Aussage"),
      st.ohne_stimme.length > 0 && el("ul", { class: "liste" }, st.ohne_stimme.map((o) => el("li", {},
        el("b", {}, o.akteur), `: ${o.rolle}`, VERMERK[o.vermerk] && el("span", { class: "etikett" }, VERMERK[o.vermerk])))),
      el("p", { class: "klein" }, "Bestandsaufnahme aus dem Text, zählt nicht in Teilwerten und Kennzahl. "
        + "Wer im Text gar nicht vorkommt, wird nicht als fehlend gewertet.")];
  }

  function spiegelTeil(a, sp) {
    const titel = el("h2", {}, "Spiegelprobe");
    const g = sp.gegenfassung;
    if (!g.spiegelbar || !sp.analyse) return [titel, el("p", {}, "Nicht spiegelbar: ", g.streitfrage)];
    const v = spiegelVergleich(a, sp.analyse);
    const seite = { seite_a: g.seite_a, seite_b: g.seite_b }[g.original_beguenstigt];
    return [titel,
      el("p", { class: "klein" }, el("b", {}, "Streitfrage: "), g.streitfrage),
      seite && el("p", { class: "klein" }, el("b", {}, "Das Original begünstigt: "), seite),
      el("div", { class: v.abweichend.length ? "warn" : "ok" }, v.abweichend.length
        ? [el("b", {}, "Ungleich bewertet: "), v.abweichend.join(", "),
          ". Entweder misst die Analyse die Seiten unterschiedlich, oder die Gegenfassung ist nicht gleich stark geraten."]
        : [el("b", {}, "Symmetrisch: "), "Die Gegenfassung mit vertauschten Seiten wird gleich bewertet."]),
      el("table", { class: "vergleich" },
        el("tr", {}, el("th", {}, ""), el("th", {}, "Original"), el("th", {}, "Gegenfassung"), el("th", {}, "")),
        v.teilwerte.map((t) => el("tr", {},
          el("td", {}, el("span", { class: "punkt", style: `background:${t.farbe}` }), t.name),
          el("td", { class: "zahl" }, String(t.original)), el("td", { class: "zahl" }, String(t.gegen)),
          el("td", {}, t.abweichend ? el("span", { class: "etikett" }, "abweichend") : "")))),
      el("p", { class: "klein" }, el("b", {}, "Muster: "), v.namen(v.mo), v.musterGleich ? "" : ` · Gegenfassung: ${v.namen(v.ms)}`,
        (v.so.length || v.ss.length) ? ` (strittig: ${v.namen(v.so)} · Gegenfassung: ${v.namen(v.ss)}; zählt nicht)` : ""),
      el("p", { class: "klein" }, el("b", {}, "Richtung: "), v.richtung(a.richtung), " · Gegenfassung: ", v.richtung(sp.analyse.richtung)),
      g.nicht_gespiegelt.length > 0 && el("p", { class: "klein" }, el("b", {}, `Nicht gespiegelt (${g.nicht_gespiegelt.length}): `),
        g.nicht_gespiegelt.join(" · ")),
      el("p", { class: "klein" }, "Ein einzelner Lauf schwankt; erst wiederholte Abweichungen sind aussagekräftig."),
      gegenfassungTeil(g)];
  }

  function gegenfassungTeil(g) {
    $("wahlGegen").hidden = false;
    return el("section", { id: "teilGegen" },
      el("h3", {}, "Gegenfassung"),
      el("div", { class: "warn" }, "Konstruierter Prüftext mit vertauschten Seiten, kein echter Artikel. "
        + "Fakten, Zahlen, Namen und wörtliche Zitate sind die des Originals; Wertung und Machart wechseln die Seite."),
      g.tausch.length > 0 && el("h3", {}, "Wichtigste Ersetzungen"),
      g.tausch.length > 0 && el("ul", { class: "liste klein" }, g.tausch.map((t) => el("li", {}, `„${t.original}“ → „${t.spiegel}“`))),
      el("h3", {}, "Text"),
      el("div", { class: "artikel" }, gegenText(g.text)));
  }

  // Gegenfassung gesetzt wie der Artikel (Überschrift, Marken als Etikett), ohne Markierungen
  function gegenText(text) {
    const zeilen = zeilenLesen(text);
    return artikelDarstellen(zeilen, textIndex(zeilen), { bereiche: [], nummer: [] }, []);
  }
})();
