# Wertungsanalyse

Privates Werkzeug: analysiert einen Nachrichtenartikel auf Wertung (Gattung, fünf Dimensionen,
Richtung, Kennzahl, neutrale Fassung) mit der Anthropic-API. Nicht zur Veröffentlichung.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `addon/analyse/prompt.md` | fester Analyse-Prompt (Kriterien aus dem Skill „artikel-wertungsanalyse“ plus Anker 0–4, Kurztexte ohne Anteil, ein Befund = eine Dimension) |
| `addon/analyse/schema.json` | JSON-Schema der Antwort (strukturierte Ausgabe über `output_config.format`) |
| `wertung.py` | Kommandozeile: analysiert `testartikel/`, speichert `ergebnisse/<artikel>/laufN.json`, vergleicht zwei Läufe, schreibt `ergebnisse/uebersicht.md` |
| `addon/manifest.json` | Chrome-Addon, Manifest V3, Rechte: `activeTab`, `scripting`, `storage`, Zugriff nur auf `api.anthropic.com` |
| `addon/hintergrund.js` | Service Worker: Klick aufs Symbol → Skripte in den Tab; API-Aufruf (Streaming, strukturierte Ausgabe); Zwischenspeicher je Adresse |
| `addon/inhalt.js` · `addon/markierung.css` | Artikeltext mit Readability, Fundstellen im Seitentext suchen und markieren, Seitenleiste (Shadow DOM), Hinweis beim Überfahren |
| `addon/einstellungen.html` · `.js` | Schlüssel, Modell, effort, Zwischenspeicher leeren |
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
- Bei Opus 5.5/Sonnet 5.5 springt bei einer Ablehnung serverseitig ein Ersatzmodell ein (`fallbacks: "default"`,
  Beta); `--ohne-fallback` schaltet das ab.

### Format der Testartikel

PDFs (im Browser als PDF gedruckte Seiten) wandelt das Skript selbst in eine gleichnamige `.txt` um: ohne Seitenkopf und Fußzeile, Adresse als `URL: …`. Navigation, Werbung und fremde Teaser bleiben drin, der Prompt lässt sie aus. Eine vorhandene `.txt` wird nie überschrieben, sie darf also von Hand bereinigt werden.

Sonst eine `.txt` (UTF-8) je Artikel. Erste Zeile Überschrift, dann der Text. Teile, die nicht zur Zählbasis gehören,
mit einer Marke am Zeilenanfang kennzeichnen: `[Bildunterschrift]`, `[Kasten]`, `[Teaser]`; außerdem möglich
`[Unterzeile]`, `[Vorspann]`, `[Zwischenüberschrift]`, `[Autor]`, `[Ressort]`. Optional `URL: …` in der ersten Zeile.

### Was die Prüfung meldet

Das Schema erzwingt Felder und Werte, aber nicht die Zitatregeln. `pruefung` in jeder Ergebnisdatei nennt:
Zitate, die nicht wörtlich im Artikel stehen (verglichen nach Vereinheitlichung von Anführungszeichen, Strichen,
Leerraum und Groß/Klein – dieselbe Regel nutzt das Addon), Zitate über zehn Wörter, mehrdeutige Zitate,
Richtungsbelege ohne Markierung, Teilwerte ohne Markierung und umgekehrt. Für die strategischen Muster außerdem:
Belege, die nicht im Artikel stehen oder über zehn Wörter haben, Muster ohne Beleg, mehr als acht Leitbegriffe.
Für das Stimmenverzeichnis: erstes Vorkommen nicht im Artikel oder über zehn Wörter, Stimmen ohne Aussage,
mehr zugeschriebene Aussagen als Sätze, mehr als fünf Akteure ohne Stimme.

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

```powershell
.venv\Scripts\python wertung.py --ordner spiegeltests --ergebnisse ergebnisse\spiegel
```

Fünf Artikel × zwei Läufe = zehn API-Aufrufe. `uebersicht.md` hat dann drei zusätzliche Abschnitte:
- **Spiegelpaare:** `<stamm>_pro` gegen `<stamm>_kontra`. Die Teilwerte werden über alle Läufe gemittelt.
  Symmetrisch heißt: keine Dimension weicht um mehr als 1 ab, gleiche Muster (in mindestens der Hälfte der
  Läufe) und gleiches Kennzeichnungsproblem. Die Richtung muss man selbst ansehen: Sie soll gespiegelt sein.
- **Abgleich mit `erwartung.json`:** je Artikel, in wie vielen Läufen alles erfüllt ist und was abwich
  (Gattung, Kennzeichnungsproblem, Richtung, Muster, Stellen, die markiert oder gerade nicht markiert sein müssen,
  verbotene Leitbegriffe). Das funktioniert für jeden Ordner, in dem eine `erwartung.json` liegt.
- **Wiederkehrende Leitbegriffe:** `pro.example` und `kontra.example` sollten je zwei Artikel mit gemeinsamen
  Begriffen zeigen. `neutral.example` sollte dort nicht auftauchen.

## Addon

### Laden

1. In Chrome `chrome://extensions` öffnen, oben rechts **Entwicklermodus** einschalten.
2. **Entpackte Erweiterung laden** → Ordner `%USERPROFILE%\Wertungsanalyse\addon` wählen (je PC verschieden, z. B. `C:\Users\Neu\…`
   oder `C:\Users\raffa\…`).
3. Über das Puzzle-Symbol die „Wertungsanalyse“ an die Symbolleiste anheften.
4. Rechtsklick aufs Symbol → **Optionen**: API-Schlüssel eintragen und speichern. Modell und effort
   (Vorgabe Opus 5.5, `high`) lassen sich dort ändern.

Nach Änderungen am Code auf `chrome://extensions` beim Addon auf ↻ klicken und die Artikelseite neu laden.

### Benutzen

- Klick aufs Symbol startet die Analyse des aktiven Tabs (nie automatisch). Ein zweiter Klick blendet die
  Leiste aus und ein. Gemerkte Ergebnisse kommen ohne API-Aufruf; ↻ in der Leiste analysiert neu (kostet).
- Farben: Wortwahl orange, epistemische Rahmung violett, Quellen blau, Auswahl grün, Überschrift rot.
  Gestrichelt = strittig, gepunktet = nur struktureller Befund. Überfahren zeigt Begründung und neutrale Alternative,
  ein Klick auf eine Fundstelle in der Leiste springt hin.
- Der Abschnitt „Strategische Muster“ nennt die Muster mit Begründung und Belegen. Ein Klick auf einen Beleg springt
  hin und hebt ihn kurz gelb hervor (die Belege werden nicht dauerhaft markiert). Gemerkte Ergebnisse aus der Zeit
  vor den Mustern zeigen dort einen Hinweis; ↻ analysiert neu.
- „Wer kommt zu Wort“ zeigt die Aussagen je Position als Balken, je Herkunft (Regierung, Wissenschaft …), die
  Stimmen selbst (Klick springt zum ersten Vorkommen) und Genannte ohne eigene Aussage.
- Fehlermeldungen in der Leiste: kein Artikel erkannt (Knopf „Ganze Seite analysieren“), Schlüssel fehlt/ungültig,
  Guthaben leer, Modell unbekannt, Ratenlimit, API gestört; nicht gefundene Fundstellen stehen mit ⚠ in der Liste.
- Der Schlüssel liegt nur in `chrome.storage.local` dieses Browserprofils und geht nur an `api.anthropic.com`.
  Ergebnisse liegen ebenfalls dort (je Adresse, ohne `utm_…`-Parameter und Sprungmarke).

### Geprüft und offen

Geprüft (19.11.2026, im Browser mit nachgebauter Chrome-Schnittstelle und gespeicherten Ergebnissen aus `wertung.py`):
Textauszug, alle 35 Fundstellen dreier Testartikel gefunden und markiert, Seitenleiste, Hinweis beim Überfahren,
Schalter, Sprung zur Fundstelle, „kein Artikel“, „nicht gefunden“, Stream-Leser mit zerstückelter Antwort,
Fehlermeldungen, Einstellungsseite. Nicht geprüft: das Laden in Chrome selbst und ein echter API-Aufruf aus dem Addon.
