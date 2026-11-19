"""Wertungsanalyse für Nachrichtenartikel – Kommandozeile.

Analysiert alle Textdateien in testartikel/ mit dem festen Prompt aus addon/analyse/
(derselbe, den das Addon nutzt), speichert jedes Ergebnis als JSON unter ergebnisse/
und vergleicht zwei Läufe desselben Artikels.

Der API-Schlüssel kommt nur aus der Umgebungsvariablen ANTHROPIC_API_KEY.

    python wertung.py                     # alle Artikel, je zwei Läufe (vorhandene werden nicht neu bezahlt)
    python wertung.py --nur spiegel       # nur Dateien, deren Name "spiegel" enthält
    python wertung.py --vergleichen       # nur auswerten, keine API-Aufrufe
    python wertung.py --modell claude-sonnet-5-5 --effort medium
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

HIER = Path(__file__).resolve().parent
KERN = HIER / "addon" / "analyse"
DIMENSIONEN = ["wortwahl", "epistemisch", "quellen", "auswahl", "ueberschrift"]
KURZ = {"wortwahl": "W", "epistemisch": "E", "quellen": "Q", "auswahl": "A", "ueberschrift": "Ü"}

MODELL_VORGABE = "claude-opus-5-5"
EFFORT_VORGABE = "high"
MAX_TOKENS = 32000
FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Modelle, die den serverseitigen Ersatz bei Ablehnung ("fallbacks": "default") annehmen
MIT_FALLBACK = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-fable-5-2", "claude-sonnet-5-5"}
# US-Dollar je Million Tokens: Eingabe, Ausgabe, Cache-Lesen (Stand der API-Doku 11/2026, nur zur Schätzung)
PREISE = {
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-opus-5": (5.00, 25.00, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00, 0.10),
    "claude-sonnet-5": (2.00, 10.00, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
    "claude-fable-5-2": (8.00, 40.00, 0.20),
}
MIN_SAETZE_FUER_ANTEIL = 15


# ---------------------------------------------------------------- Zitate prüfen

_ERSETZEN = str.maketrans({
    "„": '"', "“": '"', "”": '"', "«": '"', "»": '"', "‟": '"', "″": '"',
    "‚": "'", "‘": "'", "’": "'", "‹": "'", "›": "'", "´": "'", "`": "'",
    "–": "-", "—": "-", "‑": "-", "‐": "-", "−": "-",
    " ": " ", " ": " ", " ": " ",
})


def normalisieren(text: str) -> str:
    """Vergleichsform: typografische Zeichen vereinheitlicht, Leerraum zusammengefasst, klein.

    Dieselbe Regel nutzt das Addon beim Suchen im Seitentext.
    """
    text = unicodedata.normalize("NFC", text).replace("­", "").replace("​", "")
    text = text.translate(_ERSETZEN)
    return re.sub(r"\s+", " ", text).strip().lower()


def woerter(text: str) -> list[str]:
    return re.findall(r"\w+", normalisieren(text))


def artikel_ohne_marken(text: str) -> str:
    return re.sub(r"^\s*\[[^\]\n]{1,30}\]\s*", "", text, flags=re.M)


def pruefen(analyse: dict, artikeltext: str) -> dict:
    """Prüft, was das Schema nicht erzwingen kann: Zitate wörtlich, kurz, eindeutig; Werte stimmig."""
    norm = normalisieren(artikel_ohne_marken(artikeltext))
    nicht_gefunden, zu_lang, mehrdeutig = [], [], []
    for m in analyse["markierungen"]:
        z = normalisieren(m["zitat"])
        anzahl = norm.count(z) if z else 0
        if anzahl == 0:
            nicht_gefunden.append(m["zitat"])
        elif anzahl > 1:
            mehrdeutig.append(m["zitat"])
        if len(m["zitat"].split()) > 10:
            zu_lang.append(m["zitat"])
    zitate = {normalisieren(m["zitat"]) for m in analyse["markierungen"]}
    belege_fremd = [b for b in analyse["richtung"]["belege"] if normalisieren(b) not in zitate]
    zaehlend = {d: 0 for d in DIMENSIONEN}
    for m in analyse["markierungen"]:
        if not m["strittig"]:
            zaehlend[m["dimension"]] += 1
    tw = analyse["teilwerte"]
    wert_ohne = [d for d in DIMENSIONEN if tw[d]["wert"] > 0 and zaehlend[d] == 0]
    markierung_ohne = [d for d in DIMENSIONEN if tw[d]["wert"] == 0 and zaehlend[d] > 0]
    k = analyse["kennzahl"]
    return {
        "markierungen": len(analyse["markierungen"]),
        "zitate_nicht_gefunden": nicht_gefunden,
        "zitate_zu_lang": zu_lang,
        "zitate_mehrdeutig": mehrdeutig,
        "belege_nicht_unter_markierungen": belege_fremd,
        "teilwert_ohne_markierung": wert_ohne,
        "markierung_bei_teilwert_0": markierung_ohne,
        "kennzahl_unstimmig": k["markiert"] > k["gesamt"] or k["markiert"] + k["strittig"] > k["gesamt"],
    }


def kennzahl_text(k: dict) -> str:
    text = f"{k['markiert']}/{k['gesamt']}"
    if k["gesamt"] >= MIN_SAETZE_FUER_ANTEIL:
        text += f" ({100 * k['markiert'] / k['gesamt']:.0f} %)"
    if k["strittig"]:
        text += f" +{k['strittig']} strittig"
    return text


# ---------------------------------------------------------------- API-Aufruf

def analysieren(client, artikeltext: str, modell: str, effort: str, fallback: bool) -> tuple[dict, dict]:
    system = (KERN / "prompt.md").read_text(encoding="utf-8")
    schema = json.loads((KERN / "schema.json").read_text(encoding="utf-8"))
    anfrage = dict(
        model=modell,
        max_tokens=MAX_TOKENS,
        thinking={"type": "adaptive"},
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": f"<artikel>\n{artikeltext.strip()}\n</artikel>"}],
    )
    if fallback and modell in MIT_FALLBACK:
        anfrage.update(betas=[FALLBACK_BETA], fallbacks="default")
    beginn = time.monotonic()
    with client.beta.messages.stream(**anfrage) as strom:
        antwort = strom.get_final_message()
    dauer = time.monotonic() - beginn

    if antwort.stop_reason == "refusal":
        raise RuntimeError("Das Modell hat die Analyse abgelehnt (stop_reason: refusal).")
    if antwort.stop_reason == "max_tokens":
        raise RuntimeError(f"Antwort abgeschnitten (max_tokens={MAX_TOKENS} erreicht).")
    text = next(b.text for b in antwort.content if b.type == "text")
    analyse = json.loads(text)

    u = antwort.usage
    ein, aus, cache_lesen = PREISE.get(modell, (0, 0, 0))
    cache_schreiben = getattr(u, "cache_creation_input_tokens", 0) or 0
    cache_gelesen = getattr(u, "cache_read_input_tokens", 0) or 0
    kosten = (u.input_tokens * ein + cache_schreiben * ein * 1.25 + cache_gelesen * cache_lesen
              + u.output_tokens * aus) / 1_000_000
    meta = {
        "modell_angefragt": modell,
        "modell": antwort.model,
        "effort": effort,
        "zeit": datetime.now().isoformat(timespec="seconds"),
        "dauer_s": round(dauer, 1),
        "tokens": {"eingabe": u.input_tokens, "cache_geschrieben": cache_schreiben,
                   "cache_gelesen": cache_gelesen, "ausgabe": u.output_tokens},
        "kosten_usd_ca": round(kosten, 4) if modell in PREISE else None,
        "ersatzmodell": antwort.model != modell,
    }
    return analyse, meta


# ---------------------------------------------------------------- Vergleich zweier Läufe

def _passen(a: str, b: str) -> bool:
    na, nb = normalisieren(a), normalisieren(b)
    if na in nb or nb in na:
        return True
    wa, wb = set(woerter(a)), set(woerter(b))
    return bool(wa and wb) and len(wa & wb) / min(len(wa), len(wb)) >= 0.5


def vergleichen(a: dict, b: dict) -> dict:
    ma, mb = a["markierungen"], b["markierungen"]
    frei = list(range(len(mb)))
    paare = []
    for i, x in enumerate(ma):
        for j in frei:
            if _passen(x["zitat"], mb[j]["zitat"]):
                paare.append((i, j))
                frei.remove(j)
                break
    gemeinsam = len(paare)
    vereinigt = len(ma) + len(mb) - gemeinsam
    delta = {d: b["teilwerte"][d]["wert"] - a["teilwerte"][d]["wert"] for d in DIMENSIONEN}
    return {
        "gattung_gleich": a["gattung"]["art"] == b["gattung"]["art"],
        "gattung": [a["gattung"]["art"], b["gattung"]["art"]],
        "kennzeichnung_gleich": a["kennzeichnungsproblem"]["vorhanden"] == b["kennzeichnungsproblem"]["vorhanden"],
        "teilwerte_delta": delta,
        "teilwerte_mittl_abw": round(sum(abs(v) for v in delta.values()) / len(delta), 2),
        "teilwerte_max_abw": max(abs(v) for v in delta.values()),
        "markierungen": [len(ma), len(mb)],
        "markierungen_gemeinsam": gemeinsam,
        "markierungen_jaccard": round(gemeinsam / vereinigt, 2) if vereinigt else 1.0,
        "dimension_gleich_bei_gemeinsamen": sum(ma[i]["dimension"] == mb[j]["dimension"] for i, j in paare),
        "nur_in_lauf_1": [ma[i]["zitat"] for i in range(len(ma)) if i not in {p[0] for p in paare}],
        "nur_in_lauf_2": [mb[j]["zitat"] for j in frei],
        "kennzahl": [kennzahl_text(a["kennzahl"]), kennzahl_text(b["kennzahl"])],
        "richtung_gleich": a["richtung"]["einordnung"] == b["richtung"]["einordnung"],
        "richtung": [a["richtung"]["einordnung"], b["richtung"]["einordnung"]],
    }


# ---------------------------------------------------------------- Ablauf

def pdf_zu_text(pdf: Path) -> str:
    """Text einer im Browser als PDF gedruckten Seite, ohne Seitenkopf (Datum, Titel) und Fußzeile (Adresse, n/m).

    Die erste gefundene Adresse kommt als "URL: …" an den Anfang. Bindestriche am Zeilenende sind bei
    Browser-Drucken echte Bindestriche ("US-" / "Armee"), deshalb wird nur der Zeilenumbruch entfernt.
    """
    from pypdf import PdfReader

    url, zeilen = None, []
    for seite in PdfReader(pdf).pages:
        for z in (seite.extract_text() or "").splitlines():
            z = z.strip()
            if not z or re.match(r"^\d{1,2}\.\d{1,2}\.\d{2,4}, \d{1,2}:\d{2}\b", z) or re.fullmatch(r"\d+/\d+", z):
                continue
            treffer = re.match(r"^(https?://\S+)(\s+\d+/\d+)?$", z)
            if treffer:
                url = url or treffer.group(1)
                continue
            zeilen.append(z)
    text = re.sub(r"(\w)-\n(\w)", r"\1-\2", "\n".join(zeilen))
    return (f"URL: {url}\n" if url else "") + text + "\n"


def pdfs_umwandeln(ordner: Path) -> None:
    """Legt zu jeder PDF ohne gleichnamige .txt eine an (vorhandene .txt werden nie überschrieben)."""
    for pdf in sorted(ordner.glob("*.pdf")):
        ziel = pdf.with_suffix(".txt")
        if ziel.exists():
            continue
        try:
            text = pdf_zu_text(pdf)
        except Exception as e:  # beschädigt, verschlüsselt …
            print(f"{pdf.name}: nicht lesbar ({e})", file=sys.stderr)
            continue
        if len(text.strip()) < 200:
            print(f"{pdf.name}: kaum Text (Scan ohne Textebene?), übersprungen.", file=sys.stderr)
            continue
        ziel.write_text(text, encoding="utf-8")
        print(f"{pdf.name} → {ziel.name} ({len(text)} Zeichen)")


def artikel_dateien(ordner: Path, nur: str | None) -> list[Path]:
    dateien = sorted(p for p in ordner.iterdir() if p.suffix.lower() in (".txt", ".md") and p.is_file())
    if nur:
        dateien = [p for p in dateien if nur.lower() in p.name.lower()]
    return dateien


def lauf_pfad(ergebnisse: Path, datei: Path, nr: int) -> Path:
    return ergebnisse / datei.stem / f"lauf{nr}.json"


def richtung_text(r: dict) -> str:
    if r["einordnung"] == "parteinahme":
        teile = []
        if r["zugunsten"]:
            teile.append("zugunsten " + ", ".join(r["zugunsten"]))
        if r["zulasten"]:
            teile.append("zulasten " + ", ".join(r["zulasten"]))
        return "; ".join(teile) or "Parteinahme"
    return {"zuspitzung_ohne_parteinahme": "Zuspitzung ohne Parteinahme",
            "keine_erkennbare_richtung": "keine erkennbare Richtung"}[r["einordnung"]]


def bericht(dateien: list[Path], ergebnisse: Path) -> str:
    zeilen = ["# Wertungsanalyse – Übersicht", "",
              f"Stand {datetime.now():%d.%m.%Y %H:%M}. Teilwerte W/E/Q/A/Ü = Wortwahl, epistemische Rahmung, "
              "Quellen, Auswahl, Überschrift (0–4). Kennzahl = markierte/alle Sätze, Anteil erst ab "
              f"{MIN_SAETZE_FUER_ANTEIL} Sätzen.", "",
              "## Lauf 1 je Artikel", "",
              "| Artikel | Gattung | Kennz.-Problem | W | E | Q | A | Ü | Kennzahl | Richtung | Zitate nicht gefunden | Kosten |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    vergleiche, kosten_summe = [], 0.0
    for datei in dateien:
        laeufe = []
        nr = 1
        while lauf_pfad(ergebnisse, datei, nr).exists():
            laeufe.append(json.loads(lauf_pfad(ergebnisse, datei, nr).read_text(encoding="utf-8")))
            nr += 1
        if not laeufe:
            zeilen.append(f"| {datei.stem} | – noch nicht analysiert – | | | | | | | | | | |")
            continue
        kosten_summe += sum(l["meta"].get("kosten_usd_ca") or 0 for l in laeufe)
        e = laeufe[0]
        a, p = e["analyse"], e["pruefung"]
        tw = [str(a["teilwerte"][d]["wert"]) for d in DIMENSIONEN]
        kosten = e["meta"].get("kosten_usd_ca")
        zeilen.append(
            f"| {datei.stem} | {a['gattung']['art']} | {'ja' if a['kennzeichnungsproblem']['vorhanden'] else 'nein'} | "
            + " | ".join(tw)
            + f" | {kennzahl_text(a['kennzahl'])} | {richtung_text(a['richtung'])} | "
            f"{len(p['zitate_nicht_gefunden'])} von {p['markierungen']} | "
            f"{'%.2f $' % kosten if kosten is not None else '?'} |")
        if len(laeufe) >= 2:
            vergleiche.append((datei.stem, vergleichen(laeufe[-2]["analyse"], laeufe[-1]["analyse"]), len(laeufe)))

    if vergleiche:
        zeilen += ["", "## Vergleich der letzten zwei Läufe", "",
                   "| Artikel | Gattung | ΔW | ΔE | ΔQ | ΔA | ΔÜ | mittl./max. Abw. | Markierungen | gemeinsam | Jaccard | gleiche Dim. | Kennzahl | Richtung |",
                   "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for name, v, _ in vergleiche:
            d = v["teilwerte_delta"]
            gattung = v["gattung"][0] if v["gattung_gleich"] else " → ".join(v["gattung"])
            richtung = "gleich" if v["richtung_gleich"] else " → ".join(v["richtung"])
            zeilen.append(
                f"| {name} | {gattung} | " + " | ".join(f"{d[k]:+d}" if d[k] else "0" for k in DIMENSIONEN)
                + f" | {v['teilwerte_mittl_abw']} / {v['teilwerte_max_abw']} | {v['markierungen'][0]} / {v['markierungen'][1]}"
                f" | {v['markierungen_gemeinsam']} | {v['markierungen_jaccard']} | "
                f"{v['dimension_gleich_bei_gemeinsamen']}/{v['markierungen_gemeinsam']} | "
                f"{v['kennzahl'][0]} → {v['kennzahl'][1]} | {richtung} |")
    zeilen += ["", f"Geschätzte Kosten aller gespeicherten Läufe: {kosten_summe:.2f} $"]
    return "\n".join(zeilen) + "\n"


def main() -> int:
    for strom in (sys.stdout, sys.stderr):
        strom.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Wertungsanalyse für Nachrichtenartikel")
    ap.add_argument("--ordner", default=str(HIER / "testartikel"))
    ap.add_argument("--ergebnisse", default=str(HIER / "ergebnisse"))
    ap.add_argument("--laeufe", type=int, default=2, help="Läufe je Artikel (vorhandene zählen mit)")
    ap.add_argument("--neu", action="store_true", help="vorhandene Läufe überschreiben")
    ap.add_argument("--nur", help="nur Dateien, deren Name diesen Text enthält")
    ap.add_argument("--modell", default=os.environ.get("WERTUNG_MODELL", MODELL_VORGABE))
    ap.add_argument("--effort", default=os.environ.get("WERTUNG_EFFORT", EFFORT_VORGABE),
                    choices=["low", "medium", "high", "xhigh", "max"])
    ap.add_argument("--ohne-fallback", action="store_true", help="kein Ersatzmodell bei Ablehnung")
    ap.add_argument("--parallel", type=int, default=4)
    ap.add_argument("--vergleichen", action="store_true", help="nur auswerten, keine API-Aufrufe")
    args = ap.parse_args()

    ordner, ergebnisse = Path(args.ordner), Path(args.ergebnisse)
    if not ordner.is_dir():
        print(f"Ordner {ordner} fehlt. Artikel als .txt (UTF-8) oder .pdf dort ablegen.", file=sys.stderr)
        return 2
    pdfs_umwandeln(ordner)
    dateien = artikel_dateien(ordner, args.nur)
    if not dateien:
        print(f"Keine .txt- oder .md-Dateien in {ordner}.", file=sys.stderr)
        return 2

    if not args.vergleichen:
        auftraege = [(d, nr) for d in dateien for nr in range(1, args.laeufe + 1)
                     if args.neu or not lauf_pfad(ergebnisse, d, nr).exists()]
        if auftraege:
            if not os.environ.get("ANTHROPIC_API_KEY"):
                print("ANTHROPIC_API_KEY ist nicht gesetzt. In PowerShell: $env:ANTHROPIC_API_KEY = Read-Host -MaskInput",
                      file=sys.stderr)
                return 2
            import anthropic
            client = anthropic.Anthropic()
            print(f"{len(auftraege)} Analysen mit {args.modell}, effort {args.effort} …")

            def erledigen(datei: Path, nr: int) -> str:
                text = datei.read_text(encoding="utf-8-sig")
                analyse, meta = analysieren(client, text, args.modell, args.effort, not args.ohne_fallback)
                ziel = lauf_pfad(ergebnisse, datei, nr)
                ziel.parent.mkdir(parents=True, exist_ok=True)
                ziel.write_text(json.dumps({"artikel": datei.name, "lauf": nr, "meta": meta, "analyse": analyse,
                                            "pruefung": pruefen(analyse, text)},
                                           ensure_ascii=False, indent=2), encoding="utf-8")
                return f"{datei.stem} Lauf {nr}: {meta['dauer_s']} s, {meta['tokens']['ausgabe']} Ausgabe-Tokens"

            fehler = 0
            with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
                zukunft = {pool.submit(erledigen, d, nr): (d, nr) for d, nr in auftraege}
                for z in as_completed(zukunft):
                    d, nr = zukunft[z]
                    try:
                        print("  " + z.result())
                    except anthropic.AuthenticationError:
                        print(f"  {d.stem} Lauf {nr}: Schlüssel ungültig (401).", file=sys.stderr)
                        fehler += 1
                    except anthropic.PermissionDeniedError:
                        print(f"  {d.stem} Lauf {nr}: Schlüssel hat keine Berechtigung (403).", file=sys.stderr)
                        fehler += 1
                    except anthropic.NotFoundError:
                        print(f"  {d.stem} Lauf {nr}: Modell {args.modell} unbekannt (404).", file=sys.stderr)
                        fehler += 1
                    except anthropic.RateLimitError:
                        print(f"  {d.stem} Lauf {nr}: Ratenlimit erreicht (429), später mit --parallel 1 wiederholen.",
                              file=sys.stderr)
                        fehler += 1
                    except anthropic.BadRequestError as e:
                        print(f"  {d.stem} Lauf {nr}: Anfrage abgelehnt (400): {e.message}", file=sys.stderr)
                        fehler += 1
                    except anthropic.APIStatusError as e:
                        print(f"  {d.stem} Lauf {nr}: API-Fehler {e.status_code}: {e.message}", file=sys.stderr)
                        fehler += 1
                    except anthropic.APIConnectionError:
                        print(f"  {d.stem} Lauf {nr}: keine Verbindung zur API.", file=sys.stderr)
                        fehler += 1
                    except (RuntimeError, json.JSONDecodeError) as e:
                        print(f"  {d.stem} Lauf {nr}: {e}", file=sys.stderr)
                        fehler += 1
            if fehler:
                print(f"{fehler} Analysen fehlgeschlagen.", file=sys.stderr)

    text = bericht(artikel_dateien(ordner, args.nur), ergebnisse)
    ergebnisse.mkdir(parents=True, exist_ok=True)
    (ergebnisse / "uebersicht.md").write_text(text, encoding="utf-8")
    print()
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
