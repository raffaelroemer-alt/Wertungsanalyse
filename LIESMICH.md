# Wertungsanalyse

Privates Werkzeug: analysiert einen Nachrichtenartikel auf Wertung (Gattung, fünf Dimensionen,
Richtung, Kennzahl, neutrale Fassung) mit der Anthropic-API. Nicht zur Veröffentlichung.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `addon/analyse/prompt.md` | fester Analyse-Prompt (Kriterien aus dem Skill „artikel-wertungsanalyse“ plus Anker 0–4, Kurztexte ohne Anteil, ein Befund = eine Dimension) |
| `addon/analyse/schema.json` | JSON-Schema der Antwort (strukturierte Ausgabe über `output_config.format`) |
| `addon/analyse/spiegel_prompt.md` · `spiegel_schema.json` | Spiegelprobe: Gegenfassung mit vertauschten Seiten, gleicher Machart und Stärke, ohne neue Fakten oder Zitate |
| `wertung.py` | Kommandozeile: analysiert `testartikel/`, speichert `ergebnisse/<artikel>/laufN.json`, vergleicht zwei Läufe, schreibt `ergebnisse/uebersicht.md` |
| `addon/manifest.json` | Addon für Chrome und Firefox (auch Android), Manifest V3, Rechte: `activeTab`, `scripting`, `storage`, Zugriff nur auf `api.anthropic.com` |
| `addon/hintergrund.js` | Service Worker: Klick aufs Symbol → Skripte in den Tab; API-Aufruf (Streaming, strukturierte Ausgabe); Zwischenspeicher je Adresse |
| `addon/gemeinsam.js` | Bezeichnungen, Textvereinheitlichung und Spiegelvergleich, gemeinsam für Seitenleiste und Bericht |
| `addon/bericht.html` · `.js` · `.css` | Druckansicht des Ergebnisses zum Speichern als PDF |
| `addon/inhalt.js` · `addon/markierung.css` | Artikeltext mit Readability, Fundstellen im Seitentext suchen und markieren, Seitenleiste (Shadow DOM), Hinweis beim Überfahren |
| `addon/einstellungen.html` · `.js` | Schlüssel, Modell, effort, Zwischenspeicher leeren |
| `paket.py` | packt `addon/` als `dist/wertungsanalyse-<version>.zip` zum Signieren bei Mozilla |
| `addon/lib/` | Mozilla Readability 0.6.0 (Apache-2.0), Herkunft in `HERKUNFT.md` |

Prompt und Schema liegen im Addon-Ordner, weil Chrome nur Dateien innerhalb des Addons lesen kann.
Skript und Addon analysieren damit garantiert gleich.

`testartikel/` und `ergebnisse/` sind in `.gitignore`: Artikeltexte und Zitate gehören nicht ins Repository.
Ausnahme ist `spiegeltests/`: selbst geschriebene, frei erfundene Texte (siehe unten).

## Kommandozeile

Einmalig: `python -m venv .venv` und `.venv\Scripts\python -m pip install -r anforderungen.txt`.

```powershell
$env:ANTHROPIC_API_KEY = Read-Host -MaskInput "API-Schlüssel"
.venv\Scripts\python wertung.py
```

- Je Artikel zwei Läufe (`--laeufe N`). Vorhandene Läufe werden nicht neu bezahlt, `--neu` überschreibt.
- `--modell` (Vorgabe `claude-opus-5-5`, auch `WERTUNG_MODELL`), `--effort low|medium|high|xhigh|max` (Vorgabe `high`).
- `--vergleichen` wertet nur die gespeicherten Läufe aus, ohne API-Aufruf.
- `--spiegel` macht zusätzlich die Spiegelprobe (siehe unten): je Artikel zwei weitere Aufrufe, einmalig.
- Bei Opus 5.5/Sonnet 5.5 springt bei einer Ablehnung serverseitig ein Ersatzmodell ein (`fallbacks: "default"`,
  Beta); `--ohne-fallback` schaltet das ab.

### Format der Testartikel

PDFs (im Browser als PDF gedruckte Seiten) wandelt das Skript selbst in eine gleichnamige `.txt` um: ohne Seitenkopf und Fußzeile, Adresse als `URL: …`. Navigation, Werbung und fremde Teaser bleiben drin, der Prompt lässt sie aus. Eine vorhandene `.txt` wird nie überschrieben, sie darf also von Hand bereinigt werden.

Sonst eine `.txt` (UTF-8) je Artikel. Erste Zeile Überschrift, dann der Text. Teile, die nicht zur Zählbasis gehören,
mit einer Marke am Zeilenanfang kennzeichnen: `[Bildunterschrift]`, `[Kasten]`, `[Teaser]`; außerdem möglich
`[Unterzeile]`, `[Vorspann]`, `[Zwischenüberschrift]`, `[Autor]`, `[Ressort]`. Optional `URL: …` in der ersten Zeile.

### Was die Prüfung meldet

**Format der Antwort.** Erzwungene strukturierte Ausgabe (`output_config.format`) übersetzt das Schema in eine
Grammatik; für das Analyseschema ist sie zu groß („compiled grammar is too large“), auch ohne Auswahllisten. Die
Analyse läuft deshalb **ohne erzwungenes Format**: `schema.json` wird als Block `<schema>` an den Prompt gehängt,
der Abschnitt „Ausgabeformat“ in `prompt.md` verlangt reines JSON danach. Skript und Addon holen das JSON aus der
Antwort (auch mit Codeblock-Markierung), gleichen Groß/Kleinschreibung von Auswahlwerten an und prüfen gegen das
volle Schema (Pflichtfelder, Typen, erlaubte Werte); passt es nicht, gibt es eine Fehlermeldung statt eines
falschen Ergebnisses. Die kleine Gegenfassung der Spiegelprobe nutzt weiter das erzwungene Format (ohne `enum`).
`schema.json` bleibt die eine Quelle für alles.

Die Prüfung gegen das Schema deckt Felder, Typen und Werte ab, aber nicht die Zitatregeln. `pruefung` in jeder Ergebnisdatei nennt:
Zitate, die nicht wörtlich im Artikel stehen (verglichen nach Vereinheitlichung von Anführungszeichen, Strichen,
Leerraum und Groß/Klein – dieselbe Regel nutzt das Addon), Zitate über zehn Wörter, mehrdeutige Zitate,
Richtungsbelege ohne Markierung, Teilwerte ohne Markierung und umgekehrt. Für die strategischen Muster außerdem:
Belege, die nicht im Artikel stehen oder über zehn Wörter haben, Muster ohne Beleg, mehr als acht Leitbegriffe.
Für das Stimmenverzeichnis: erstes Vorkommen nicht im Artikel oder über zehn Wörter, Stimmen ohne Aussage,
mehr zugeschriebene Aussagen als Sätze, mehr als fünf Akteure ohne Stimme.
Für Wirkung und Wortleiter: leere Wirkung, Wortleitern mit weniger als drei oder mehr als sieben Stufen oder
Stellen außerhalb der Reihe, nicht strittige Markierungen, bei denen das gewählte Wort zugleich das neutrale ist,
und der Anteil der Markierungen mit Wortleiter.

### Wirkung und Wortleiter

Jede Markierung trägt zwei Felder, die Claudes Wissen über die Wirkung von Sprache sichtbar machen, ohne in Teilwerte
oder Kennzahl einzugehen. `wirkung` sagt in einem Satz, welchen Eindruck die Stelle beim Lesen erzeugen kann (als
Einschätzung, nicht als Aussage über Absicht oder gemessene Leserreaktion). `wortleiter` ordnet bei einzelnen Wörtern
und Wendungen drei bis sieben gleichbedeutende Ausdrücke von abwertend bis aufwertend
(„poltert – behauptet – sagt – erklärt – stellt klar“) und nennt die Stelle des gewählten und des neutralsten Ausdrucks.
Bei Struktur- und Überschriftbefunden bleibt die Leiter leer.

### Wer kommt zu Wort

Ebenfalls getrennt von Teilwerten und Kennzahl legt der Prompt ein Verzeichnis der Stimmen an (nach Hagens
„opportunen Zeugen“, siehe `LITERATUR.md`): jede Person oder Institution, der der Text eine Aussage zuschreibt, mit
Typ, Zahl der Aussagen, Position zur Streitfrage (gleicher Wortlaut für gleiche Haltung) und erstem Vorkommen.
Dazu bis zu fünf Akteure, die der Text als beschuldigt, betroffen oder entscheidend nennt, die aber nicht zu Wort
kommen, mit Vermerk, ob laut Text eine Stellungnahme angefragt oder abgelehnt wurde. Nur textintern: Wer im Text
nicht vorkommt, gilt nicht als fehlend. `uebersicht.md` zeigt das kurz als `7/21, 2 Pos., 1 ohne`
(Stimmen/Aussagen, Positionen außer „ohne Position“, Akteure ohne Stimme).

### Strategische Muster

Getrennt von Teilwerten und Kennzahl prüft der Prompt acht Bauformen gezielter Überzeugungskommunikation
(abgeleitet aus einem Framing-Leitfaden, umgekehrt als Erkennungsmerkmale): moralische Klammer (Kl),
moralische Delegitimierung (De), Dichotomie (Di), vereinnahmendes Wir (Wir), Umbenennung (Um),
Leitbegriff-Wiederholung (Wh), dazu aus den Taxonomien der Überzeugungstechniken (SemEval-2023 Task 3,
siehe `LITERATUR.md`) Angstappell (An) und Sündenbock (Sb). Ein Muster beschreibt den Bau des Textes, nicht eine Absicht. Dazu nennt das
Modell bis zu acht wertende Leitbegriffe in Grundform.

`uebersicht.md` zeigt die Muster je Artikel (`?` hinter dem Kürzel = strittig, `–` = keine, `?` allein = Analyse
aus der Zeit vor den Mustern) und listet Leitbegriffe, die in mindestens zwei Artikeln vorkommen, mit Anzahl je
Quelle (Domain aus der Zeile `URL: …`). Gehäufte Begriffe in einer Quelle sind ein Hinweis auf eine Sprachregelung,
kein Beleg: Agenturvorlagen und Begriffe aus der Debatte selbst führen zum selben Bild.

### Vergleich zweier Läufe

Teilwerte: Abweichung je Dimension, Mittel und Maximum. Markierungen: zwei Fundstellen gelten als dieselbe, wenn
eine in der anderen steckt oder sie mindestens die Hälfte der Wörter teilen; daraus Anzahl gemeinsam, Jaccard
(gemeinsam / alle verschiedenen) und wie viele der gemeinsamen dieselbe Dimension haben.

### Spiegeltests

`spiegeltests/` prüft, ob die Analyse beide Seiten gleich behandelt. Die Texte zur (erfundenen) Erhöhung des
Rundfunkbeitrags sind frei erfunden: Namen, Zahlen, Domains (`.example`).

| Datei | Bauart |
|---|---|
| `rundfunk_bericht_pro` / `_kontra` | als Bericht aufgemacht, aber durchgehend parteiisch; alle sechs Muster, „sogenannt“, wertende Redeverben, gespiegelt Satz für Satz |
| `rundfunk_kommentar_pro` / `_kontra` | gekennzeichneter Kommentar derselben Quelle, dieselben Leitbegriffe wie der Bericht |
| `rundfunk_neutral` | Kontrolle: dieselben Fakten, die Kampfbegriffe beider Seiten nur in zugeschriebenen Zitaten |
| `stadtwerke_bericht_pro` / `_kontra` | Verkauf von Anteilen der (erfundenen) Stadtwerke Lindenau, als Lokalbericht aufgemacht; nur Angstappell und Sündenbock, sonst keine Muster. Gespiegelt: Bedrohung durch Scheitern bzw. Gelingen des Verkaufs, Schuld bei „Gewerkschaftsfunktionären“ bzw. „Rathausbürokraten“. Der Text nennt selbst andere Ursachen des Verlusts (Gutachten), das macht die Schuldzuweisung zum Sündenbock |

```powershell
.venv\Scripts\python wertung.py --ordner spiegeltests --ergebnisse ergebnisse\spiegel
```

Sieben Artikel × zwei Läufe = 14 API-Aufrufe (vorhandene Läufe werden nicht neu bezahlt, `--nur stadtwerke`
analysiert nur das neue Paar). `uebersicht.md` hat dann drei zusätzliche Abschnitte:
- **Spiegelpaare:** `<stamm>_pro` gegen `<stamm>_kontra`. Die Teilwerte werden über alle Läufe gemittelt.
  Symmetrisch heißt: keine Dimension weicht um mehr als 1 ab, gleiche nicht strittige Muster (in mindestens der Hälfte der
  Läufe) und gleiches Kennzeichnungsproblem. Die Richtung muss man selbst ansehen: Sie soll gespiegelt sein.
- **Abgleich mit `erwartung.json`:** je Artikel, in wie vielen Läufen alles erfüllt ist und was abwich
  (Gattung, Kennzeichnungsproblem, Richtung, Muster, Stellen, die markiert oder gerade nicht markiert sein müssen,
  verbotene Leitbegriffe). Das funktioniert für jeden Ordner, in dem eine `erwartung.json` liegt.
- **Wiederkehrende Leitbegriffe:** `pro.example` und `kontra.example` sollten je zwei Artikel mit gemeinsamen
  Begriffen zeigen. `neutral.example` sollte dort nicht auftauchen.

### Spiegelprobe

Macht aus jedem echten Artikel einen Spiegeltest. Ein eigener Prompt schreibt eine **Gegenfassung**: derselbe Text,
als hätte ihn die andere Seite der Streitfrage geschrieben, mit derselben Machart und Stärke. Wertende Wörter,
Redeverben, Reihenfolge und Raum der Stimmen, Zuspitzung und Muster wechseln die Seite. Fakten, Zahlen, Namen, wer was
vertritt und wörtliche Zitate bleiben; was sich nur mit erfundenen Fakten oder Zitaten spiegeln ließe, bleibt
sachlich stehen und wird als „nicht gespiegelt“ genannt. Texte ohne zwei Seiten (Unfall, Wetter) sind nicht spiegelbar.

Die Gegenfassung wird mit dem normalen Prompt analysiert und mit dem Original verglichen. Symmetrisch heißt: keine
Dimension weicht um mehr als 1 ab, gleiche nicht strittige Muster, gleiches Kennzeichnungsproblem, gleiche Einordnung der Richtung
und bei Parteinahme die andere Seite begünstigt. Eine Abweichung hat zwei mögliche Ursachen: Die Analyse misst die
Seiten ungleich, oder die Gegenfassung ist nicht gleich stark geraten. Unterscheiden lässt sich das nur durch Lesen
der Gegenfassung.

```powershell
.venv\Scripts\python wertung.py --spiegel
```

Je Artikel entstehen `spiegel.json` (Gegenfassung mit Streitfrage, Seiten, wichtigsten Ersetzungen),
`spiegel_text.txt` (zum Lesen) und `spiegel_lauf1.json` (ihre Analyse); `uebersicht.md` bekommt den Abschnitt
„Spiegelprobe“. Die Gegenfassung ist ein konstruierter Prüftext über echte Personen und Medien und ist überall
als solcher gekennzeichnet. Sie liegt wie alle Ergebnisse in `ergebnisse/` und damit außerhalb des Repositorys.

## Addon

### Laden

1. In Chrome `chrome://extensions` öffnen, oben rechts **Entwicklermodus** einschalten.
2. **Entpackte Erweiterung laden** → Ordner `%USERPROFILE%\Wertungsanalyse\addon` wählen (je PC verschieden, z. B. `C:\Users\Neu\…`
   oder `C:\Users\raffa\…`).
3. Über das Puzzle-Symbol die „Wertungsanalyse“ an die Symbolleiste anheften.
4. Rechtsklick aufs Symbol → **Optionen**: API-Schlüssel eintragen und speichern. Modell und effort
   (Vorgabe Opus 5.5, `high`) lassen sich dort ändern.

Nach Änderungen am Code auf `chrome://extensions` beim Addon auf ↻ klicken und die Artikelseite neu laden.

### Handy (Firefox für Android)

Chrome auf Android lädt keine Erweiterungen, Firefox für Android schon (ab Version 142). Dasselbe Addon läuft dort:
Das Manifest nennt `service_worker` für Chrome und `scripts` für Firefox (jeder Browser nimmt seins), dazu unter
`browser_specific_settings.gecko` eine feste ID und die Angabe, welche Daten das Addon überträgt
(`websiteContent`, `browsingActivity`: Artikeltext und Adresse gehen an die Anthropic-API). Chrome meldet den
Schlüssel `browser_specific_settings` als unbekannt; das ist nur ein Hinweis.

Firefox für Android installiert nur von Mozilla signierte Erweiterungen. Einmal je Version:

1. `python paket.py` → `dist/wertungsanalyse-<version>.zip`.
2. Auf addons.mozilla.org mit einem Mozilla-Konto anmelden, **Neues Add-on einreichen**, als Vertriebsweg
   **„Auf eigene Faust“ (unlisted)** wählen und die ZIP hochladen. Das Add-on wird so nicht veröffentlicht, nur
   automatisch geprüft und signiert. Danach die signierte `.xpi` herunterladen.
3. Die `.xpi` aufs Handy bringen (Android 10 oder neuer). In Firefox unter **Einstellungen › Über Firefox** auf das
   Logo tippen, bis „Debug-Menü aktiviert“ erscheint (meist fünfmal). Dann gibt es unter Einstellungen (Abschnitt
   Erweitert) **Add-on aus Datei installieren**; dort die `.xpi` wählen. Ohne Signatur geht das nur in Firefox Nightly.
4. Im Firefox-Menü › Erweiterungen › Wertungsanalyse › Einstellungen den API-Schlüssel eintragen
   (er liegt nur in diesem Firefox, getrennt vom Chrome-Profil).

Für eine neue Version im Manifest `version` erhöhen und die Schritte 1–3 wiederholen (bei Mozilla „Neue Version
hochladen“ beim selben Add-on).

Auf dem Handy: Analyse über das Firefox-Menü › Erweiterungen › Wertungsanalyse starten. Die Leiste erscheint
unten; ▾ klappt sie auf die Kopfzeile zu, damit der Artikel lesbar bleibt (auch ein Tipp auf „Wertungsanalyse“).
Ein Tipp auf eine Markierung zeigt den Hinweis und folgt keinem Link; ein zweiter Tipp oder Scrollen schließt ihn.
Sprünge aus der Leiste holen die Stelle ins obere Drittel, über die Leiste. „PDF“ öffnet die Druckansicht in
Bildschirmbreite; gespeichert wird über den Druck von Firefox.

### Benutzen

- Klick aufs Symbol startet die Analyse des aktiven Tabs (nie automatisch). Ein zweiter Klick blendet die
  Leiste aus und ein. Gemerkte Ergebnisse kommen ohne API-Aufruf; ↻ in der Leiste analysiert neu (kostet).
- Farben: Wortwahl orange, epistemische Rahmung violett, Quellen blau, Auswahl grün, Überschrift rot.
  Gestrichelt = strittig, gepunktet = nur struktureller Befund. Überfahren zeigt Begründung, Wirkung (gelb),
  die Wortleiter (− abwertend bis + aufwertend, gewähltes Wort weiß gefüllt, neutrales grün umrandet) und die neutrale
  Alternative; ein Klick auf eine Fundstelle in der Leiste springt hin.
- Der Abschnitt „Strategische Muster“ nennt die Muster mit Begründung und Belegen. Ein Klick auf einen Beleg springt
  hin und hebt ihn kurz gelb hervor (die Belege werden nicht dauerhaft markiert). Gemerkte Ergebnisse aus der Zeit
  vor den Mustern zeigen dort einen Hinweis; ↻ analysiert neu.
- „Wer kommt zu Wort“ zeigt die Aussagen je Position als Balken, je Herkunft (Regierung, Wissenschaft …), die
  Stimmen selbst (Klick springt zum ersten Vorkommen) und Genannte ohne eigene Aussage.
- „Spiegelprobe“ startet nur auf Knopfdruck (zwei API-Aufrufe). Danach: Streitfrage, welche Seite das Original
  begünstigt, Teilwerte Original gegen Gegenfassung, Muster und Richtung beider Fassungen, Urteil „symmetrisch“ oder
  „ungleich bewertet“, nicht gespiegelte Stellen und aufklappbar die Gegenfassung mit den wichtigsten Ersetzungen.
  Das Ergebnis wird je Adresse gemerkt („Zwischenspeicher leeren“ löscht es mit).
- **PDF** in der Kopfzeile der Leiste öffnet neben dem Artikel eine Druckansicht: Überblick (Gattung, Kennzahl,
  Richtung, Kennzeichnung), Teilwerte, Muster, Stimmen, Spiegelprobe (falls gemacht), der Artikeltext mit farbigen,
  nummerierten Markierungen, alle Fundstellen mit Begründung, Wirkung, Wortleiter und neutraler Alternative, die
  neutrale Fassung und die Hinweise. „Als PDF speichern …“ öffnet den Chrome-Druck; dort Ziel „Als PDF speichern“
  wählen und Kopf- und Fußzeilen ausschalten (Seitenzahlen setzt der Bericht selbst). Artikeltext und neutrale
  Fassung lassen sich vorher abwählen, ebenso die Gegenfassung der Spiegelprobe (mit wichtigsten Ersetzungen,
  als konstruierter Prüftext gekennzeichnet). Die letzten fünf Berichte bleiben gemerkt, „Zwischenspeicher leeren“ löscht sie mit.
- Fehlermeldungen in der Leiste: kein Artikel erkannt (Knopf „Ganze Seite analysieren“), Schlüssel fehlt/ungültig,
  Guthaben leer, Modell unbekannt, Ratenlimit, API gestört; nicht gefundene Fundstellen stehen mit ⚠ in der Liste.
- Der Schlüssel liegt nur in `chrome.storage.local` dieses Browserprofils und geht nur an `api.anthropic.com`.
  Ergebnisse liegen ebenfalls dort (je Adresse, ohne `utm_…`-Parameter und Sprungmarke).

### Geprüft und offen

Geprüft (19.11.2026, im Browser mit nachgebauter Chrome-Schnittstelle und gespeicherten Ergebnissen aus `wertung.py`):
Textauszug, alle 35 Fundstellen dreier Testartikel gefunden und markiert, Seitenleiste, Hinweis beim Überfahren,
Schalter, Sprung zur Fundstelle, „kein Artikel“, „nicht gefunden“, Stream-Leser mit zerstückelter Antwort,
Fehlermeldungen, Einstellungsseite. Nicht geprüft: das Laden in Chrome selbst und ein echter API-Aufruf aus dem Addon.
