# Literatur zur Verfeinerung der Wertungsanalyse

Fachliteratur aus Kommunikationswissenschaft, Linguistik und Bias-Forschung, geordnet nach den Stellen in
`addon/analyse/prompt.md`, die sie schärfen kann. Angaben ohne Link aus dem Gedächtnis: Auflage und Jahr vor dem
Zitieren im Katalog prüfen.

**Frei verfügbar:** DOCA-Handbuch, Recasens 2013, Spinde 2024, Hamborg 2019, Bachl/Vögele 2012, Pressekodex.

## Methode (Codieranweisung, Zählbasis, Vergleich der Läufe → `wertung.py`)

- Oehmer-Pedrazzi, F., Kessler, S. H., Humprecht, E., Sommer, K., Castro, L. (Hrsg.) (2023): *Standardisierte
  Inhaltsanalyse in der Kommunikationswissenschaft – Standardized Content Analysis in Communication Research.*
  Springer VS. Open Access, CC BY 4.0, DOI [10.1007/978-3-658-36179-2](https://doi.org/10.1007/978-3-658-36179-2),
  PDF bei [OAPEN](https://library.oapen.org/handle/20.500.12657/61243).
  Zugehörige Datenbank DOCA (Database of Variables for Content Analysis) mit ausgearbeiteten Variablen.
  → Anker 0–4 und Abgrenzungsregeln gegen fertige Variablen zu Bewertung/Tonalität, Negativität,
  Sensationalismus, Meinungsbetontheit, Framing halten.
- Früh, W.: *Inhaltsanalyse. Theorie und Praxis.* UVK/utb.
- Rössler, P.: *Inhaltsanalyse.* UVK/utb.
  → Kategorienbildung, Codieranweisung, Analyseeinheit (Zählbasis).
- Krippendorff, K. (2018): *Content Analysis. An Introduction to Its Methodology.* 4. Aufl., Sage.
  → Intercoder-Reliabilität: Krippendorffs Alpha (ordinal für Teilwerte) als Ergänzung zu Jaccard beim
  Vergleich zweier Läufe.

## Schritt 2, `wortwahl` · Schritt 5, `umbenennung` und `leitbegriff_wiederholung`

- Martin, J. R., White, P. R. R. (2005): *The Language of Evaluation. Appraisal in English.* Palgrave Macmillan.
  → Attitude (was bewertet wird), Graduation (Intensivierer), Engagement (Umgang mit fremden Stimmen;
  passt auch auf `epistemisch` und `quellen`).
- Bednarek, M. (2006): *Evaluation in Media Discourse.* Continuum.
- Burger, H., Luginbühl, M. (2014): *Mediensprache.* 4. Aufl., de Gruyter.
  → Textsorten, Überschriften, Redewiedergabe.
- Girnth, H.: *Sprache und Sprachverwendung in der Politik.* De Gruyter.
- Niehr, T. (2014): *Einführung in die Politolinguistik.* Vandenhoeck & Ruprecht/utb.
- Klein, J. (1991): „Kann man ‚Begriffe besetzen‘?“ In: Liedtke/Wengeler/Böke (Hrsg.): *Begriffe besetzen.*
  → Schlag-, Fahnen- und Stigmawörter, Begriffsbesetzung; richtungsneutral anwendbar.

## Schritt 2, `epistemisch`

- Recasens, M., Danescu-Niculescu-Mizil, C., Jurafsky, D. (2013): „Linguistic Models for Analyzing and Detecting
  Biased Language.“ *Proceedings of ACL 2013*, 1650–1659. [aclanthology.org/P13-1162](https://aclanthology.org/P13-1162/)
  → *framing bias* (≈ `wortwahl`) vs. *epistemological bias* (≈ `epistemisch`); Wortlisten zu faktiven und
  implikativen Verben, Hedges, Assertiva als Quelle für Beispiele im Prompt.
- Hyland, K. (1998): *Hedging in Scientific Research Articles.* Benjamins.
  → Typologie von Hedges und Boostern.

## Schritt 2, `quellen` und `auswahl`

- Hagen, L. M. (1992): „Die opportunen Zeugen. Konstruktionsmechanismen von Bias in der Zeitungsberichterstattung
  über die Volkszählungsdiskussion.“ *Publizistik* 37, 444–460.
  → Wertung über die Auswahl korrekt zugeschriebener Stimmen; Grenze der Regel „zitierte Wertungen Dritter sind
  keine Wertung“.
- Bachl, M., Vögele, C. (2012/2013): „Guttenbergs Zeugen.“ Vortrag DGPuK 2012
  ([PDF](https://www.uni-hohenheim.de/fileadmin/einrichtungen/komm/PDFs/Komm/Publikationen/Bachl_Voegele_2012_Guttenbergs_Zeugen_DGPuK.pdf));
  Aufsatz in *Medien & Kommunikationswissenschaft* 61(3), 345–367.
  → Replikation mit nachvollziehbarer Operationalisierung.
- Kepplinger, H. M., Brosius, H.-B., Staab, J. F., Linke, G. (1989): „Instrumentelle Aktualisierung.“
  In: Kaase/Schulz (Hrsg.): *Massenkommunikation* (KZfSS Sonderheft 30).
  → Hochspielen von Fakten und Experten zugunsten einer Seite.
- Boykoff, M. T., Boykoff, J. M. (2004): „Balance as bias.“ *Global Environmental Change* 14(2), 125–136.
  → Formale Ausgewogenheit als eigene Verzerrung; mögliche Abgrenzungsregel.

## Schritt 1, Gattung und `kennzeichnungsproblem`

- Schönbach, K. (1977): *Trennung von Nachricht und Meinung. Empirische Untersuchung eines journalistischen
  Qualitätskriteriums.* Alber.
  → Grundlagenstudie; „Synchronisation“ von Bericht und Kommentarlinie.
- La Roche, W. von: *Einführung in den praktischen Journalismus.* Springer VS.
  → Definitionen der Darstellungsformen.
- Deutscher Presserat: *Pressekodex* (frei auf presserat.de).
  → Normgrundlage.
- Westerståhl, J. (1983): „Objective News Reporting.“ *Communication Research* 10(3), 403–424.
  → Objektivität als Faktizität und Unparteilichkeit; Rahmen für die fünf Dimensionen insgesamt.

## Schritt 4, Richtung · Schritt 5, strategische Muster

- Entman, R. M. (1993): „Framing: Toward Clarification of a Fractured Paradigm.“ *Journal of Communication*
  43(4), 51–58.
  → Vier Frame-Elemente: Problemdefinition, Ursache, moralische Bewertung, Handlungsempfehlung;
  `moralische_klammer` und `moralische_delegitimierung` als Sonderfälle der moralischen Bewertung.
- Matthes, J., Kohring, M. (2008): „The Content Analysis of Media Frames: Toward Improving Reliability and
  Validity.“ *Journal of Communication* 58(2), 258–279.
- Matthes, J. (2014): *Framing.* Nomos (Reihe Konzepte).
  → Frames in Einzelelementen codieren statt als Gesamturteil (wie „ein Befund = eine Dimension“).
- Semetko, H. A., Valkenburg, P. M. (2000): „Framing European Politics: A Content Analysis of Press and
  Television News.“ *Journal of Communication* 50(2), 93–109.
  → Fünf allgemeine Frames (Konflikt, Human Interest, wirtschaftliche Folgen, Moral, Verantwortung);
  Grundlage für `zuspitzung_ohne_parteinahme`.

## Schritt 2, `ueberschrift`

- Dor, D. (2003): „On Newspaper Headlines as Relevance Optimizers.“ *Journal of Pragmatics* 35(5), 695–721.
- Ecker, U. K. H., Lewandowsky, S., Chang, E. P., Pillai, R. (2014): „The Effects of Subtle Misinformation in News
  Headlines.“ *Journal of Experimental Psychology: Applied* 20(4), 323–335.
  → Wirkung von Überschriften, die vom Text abweichen.

## Abgleich mit automatischer Bias-Erkennung

- Spinde, T. u. a. (2024): „The Media Bias Taxonomy: A Systematic Literature Review on the Forms and Automated
  Detection of Media Bias.“ [arXiv:2312.16148](https://arxiv.org/abs/2312.16148). Datensätze auf GitHub
  (Media-Bias-Group).
  → Kategorien gegen aktuelle Typologie prüfen.
- Hamborg, F., Donnay, K., Gipp, B. (2019): „Automated Identification of Media Bias in News Articles: An
  Interdisciplinary Literature Review.“ *International Journal on Digital Libraries* 20, 391–415. Open Access.
- Fan, L. u. a. (2019): „In Plain Sight: Media Bias Through the Lens of Factual Reporting.“ *EMNLP 2019*
  (BASIL-Datensatz).
  → *lexical* vs. *informational bias* ≈ `wortwahl` vs. `auswahl`.

## Einstieg

1. DOCA-Handbuch: Kapitel zu Bewertung/Tonalität, Framing, Objektivität.
2. Recasens u. a. 2013.
3. Hagen 1992 bzw. Bachl/Vögele.
