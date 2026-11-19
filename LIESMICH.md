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
Richtungsbelege ohne Markierung, Teilwerte ohne Markierung und umgekehrt.

### Vergleich zweier Läufe

Teilwerte: Abweichung je Dimension, Mittel und Maximum. Markierungen: zwei Fundstellen gelten als dieselbe, wenn
eine in der anderen steckt oder sie mindestens die Hälfte der Wörter teilen; daraus Anzahl gemeinsam, Jaccard
(gemeinsam / alle verschiedenen) und wie viele der gemeinsamen dieselbe Dimension haben.

## Addon

### Laden

1. In Chrome `chrome://extensions` öffnen, oben rechts **Entwicklermodus** einschalten.
2. **Entpackte Erweiterung laden** → Ordner `C:\Users\Neu\Wertungsanalyse\addon` wählen.
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
- Fehlermeldungen in der Leiste: kein Artikel erkannt (Knopf „Ganze Seite analysieren“), Schlüssel fehlt/ungültig,
  Guthaben leer, Modell unbekannt, Ratenlimit, API gestört; nicht gefundene Fundstellen stehen mit ⚠ in der Liste.
- Der Schlüssel liegt nur in `chrome.storage.local` dieses Browserprofils und geht nur an `api.anthropic.com`.
  Ergebnisse liegen ebenfalls dort (je Adresse, ohne `utm_…`-Parameter und Sprungmarke).

### Geprüft und offen

Geprüft (19.11.2026, im Browser mit nachgebauter Chrome-Schnittstelle und gespeicherten Ergebnissen aus `wertung.py`):
Textauszug, alle 35 Fundstellen dreier Testartikel gefunden und markiert, Seitenleiste, Hinweis beim Überfahren,
Schalter, Sprung zur Fundstelle, „kein Artikel“, „nicht gefunden“, Stream-Leser mit zerstückelter Antwort,
Fehlermeldungen, Einstellungsseite. Nicht geprüft: das Laden in Chrome selbst und ein echter API-Aufruf aus dem Addon.
