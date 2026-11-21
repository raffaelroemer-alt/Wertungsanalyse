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
MUSTER_KURZ = {"moralische_klammer": "Kl", "moralische_delegitimierung": "De", "dichotomie": "Di",
               "vereinnahmendes_wir": "Wir", "umbenennung": "Um", "leitbegriff_wiederholung": "Wh",
               "angstappell": "An", "suendenbock": "Sb"}
MAX_LEITBEGRIFFE = 8
MAX_OHNE_STIMME = 5


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
    sm = muster_von(analyse)
    muster_nicht_gefunden, muster_zu_lang = [], []
    for mu in sm["muster"]:
        for b in mu["belege"]:
            if not normalisieren(b) or normalisieren(b) not in norm:
                muster_nicht_gefunden.append(b)
            if len(b.split()) > 10:
                muster_zu_lang.append(b)
    leiter_ungueltig, leiter_gleich = [], []
    for m in analyse["markierungen"]:
        wl = m.get("wortleiter") or {"stufen": []}
        n = len(wl["stufen"])
        if not n:
            continue
        if not 3 <= n <= 7 or not (0 <= wl["gewaehlt"] < n and 0 <= wl["neutral"] < n):
            leiter_ungueltig.append(m["zitat"])
        elif wl["gewaehlt"] == wl["neutral"] and not m["strittig"]:
            leiter_gleich.append(m["zitat"])
    st = stimmen_von(analyse)
    stimmen_nicht_gefunden, stimmen_zu_lang = [], []
    for sm_ in st["liste"]:
        b = sm_["erstes_vorkommen"]
        if not normalisieren(b) or normalisieren(b) not in norm:
            stimmen_nicht_gefunden.append(b)
        if len(b.split()) > 10:
            stimmen_zu_lang.append(b)
    # Fernsehtranskripte: O-Ton-Absätze müssen als [Absatz N] im Text stehen und gehören höchstens einer Stimme
    vorhanden = {int(n) for n in re.findall(r"^\s*\[Absatz (\d+)\]", artikeltext, flags=re.M)}
    vergeben: dict[int, int] = {}
    for x in st["liste"]:
        for n in x.get("absaetze") or []:
            vergeben[n] = vergeben.get(n, 0) + 1
    return {
        "markierungen": len(analyse["markierungen"]),
        "zitate_nicht_gefunden": nicht_gefunden,
        "zitate_zu_lang": zu_lang,
        "zitate_mehrdeutig": mehrdeutig,
        "belege_nicht_unter_markierungen": belege_fremd,
        "teilwert_ohne_markierung": wert_ohne,
        "markierung_bei_teilwert_0": markierung_ohne,
        "kennzahl_unstimmig": k["markiert"] > k["gesamt"] or k["markiert"] + k["strittig"] > k["gesamt"],
        "muster_belege_nicht_gefunden": muster_nicht_gefunden,
        "muster_belege_zu_lang": muster_zu_lang,
        "muster_ohne_beleg": [mu["art"] for mu in sm["muster"] if not mu["belege"]],
        "leitbegriffe_zu_viele": len(sm["leitbegriffe"]) > MAX_LEITBEGRIFFE,
        "wirkung_fehlt": [m["zitat"] for m in analyse["markierungen"] if "wirkung" in m and not m["wirkung"].strip()],
        "wortleiter_ungueltig": leiter_ungueltig,
        "wortleiter_gewaehlt_ist_neutral": leiter_gleich,
        "wortleiter_anteil": (f"{sum(bool((m.get('wortleiter') or {}).get('stufen')) for m in analyse['markierungen'])}"
                              f"/{len(analyse['markierungen'])}"),
        "stimmen_vorkommen_nicht_gefunden": stimmen_nicht_gefunden,
        "stimmen_vorkommen_zu_lang": stimmen_zu_lang,
        "stimmen_ohne_aussage": [x["sprecher"] for x in st["liste"] if x["aussagen"] < 1],
        "stimmen_aussagen_ueber_gesamt": sum(x["aussagen"] for x in st["liste"]) > k["gesamt"] > 0,
        "ohne_stimme_zu_viele": len(st["ohne_stimme"]) > MAX_OHNE_STIMME,
        "zitatwertungen_nicht_gefunden": [z["zitat"] for z in (analyse.get("zitatwertungen") or {}).get("liste", [])
                                          if not normalisieren(z["zitat"]) or normalisieren(z["zitat"]) not in norm],
        "zitatwertungen_zu_lang": [z["zitat"] for z in (analyse.get("zitatwertungen") or {}).get("liste", [])
                                   if len(z["zitat"].split()) > 10],
        "beitraege_beginn_nicht_gefunden": [b["beginn"] for b in analyse.get("beitraege") or []
                                            if not normalisieren(b["beginn"]) or normalisieren(b["beginn"]) not in norm],
        "beitraege_beginn_zu_lang": [b["beginn"] for b in analyse.get("beitraege") or [] if len(b["beginn"].split()) > 10],
        "stimmen_absatz_unbekannt": sorted(n for n in vergeben if n not in vorhanden),
        "stimmen_absatz_doppelt": sorted(n for n, k in vergeben.items() if k > 1),
    }


def muster_von(analyse: dict) -> dict:
    """Strategische Muster; ältere Ergebnisse ohne das Feld gelten als 'keine Muster'."""
    return analyse.get("strategische_muster") or {"muster": [], "leitbegriffe": []}


def muster_text(analyse: dict) -> str:
    """Kurzform wie 'Di, Um, Wir?' (Fragezeichen = strittig), '–' = keine, '?' = ältere Analyse ohne Muster."""
    if "strategische_muster" not in analyse:
        return "?"
    teile = []
    for mu in analyse["strategische_muster"]["muster"]:
        t = MUSTER_KURZ[mu["art"]] + ("?" if mu["strittig"] else "")
        if t not in teile:
            teile.append(t)
    return ", ".join(teile) or "–"


def stimmen_von(analyse: dict) -> dict:
    """Verzeichnis der Stimmen; ältere Ergebnisse ohne das Feld gelten als leer."""
    return analyse.get("stimmen") or {"liste": [], "ohne_stimme": []}


def stimmen_text(analyse: dict) -> str:
    """Kurzform wie '7/21, 2 Pos., 1 ohne, Z: einseitig 4/5 unw.': Stimmen/Aussagen, Positionen außer 'ohne Position',
    Akteure ohne Stimme, Wertung über Zitate (Einschätzung, unwidersprochene/alle wertenden Zitate).

    '?' = ältere Analyse ohne Verzeichnis.
    """
    if "stimmen" not in analyse:
        return "?"
    st = analyse["stimmen"]
    if not st["liste"] and not st["ohne_stimme"]:
        return "–"
    teile = [f"{len(st['liste'])}/{sum(x['aussagen'] for x in st['liste'])}"]
    positionen = {x["position"].strip().lower() for x in st["liste"]} - {"ohne position"}
    if positionen:
        teile.append(f"{len(positionen)} Pos.")
    if st["ohne_stimme"]:
        teile.append(f"{len(st['ohne_stimme'])} ohne")
    # Wertung über Zitate: Einschätzung und Anteil unwidersprochener wertender Zitate, z. B. "Z: einseitig 4/5 unw."
    zw = analyse.get("zitatwertungen")
    if zw:
        kurz = {"keine_wertenden_zitate": "keine", "ausgewogen": "ausgewogen",
                "ueberwiegend_eine_seite": "überwiegend", "einseitig": "einseitig"}[zw["einschaetzung"]["einordnung"]]
        unw = sum(z["behandlung"] == "unwidersprochen" for z in zw["liste"])
        teile.append(f"Z: {kurz}" + (f" {unw}/{len(zw['liste'])} unw." if zw["liste"] else ""))
    return ", ".join(teile)


def kennzahl_text(k: dict) -> str:
    text = f"{k['markiert']}/{k['gesamt']}"
    if k["gesamt"] >= MIN_SAETZE_FUER_ANTEIL:
        text += f" ({100 * k['markiert'] / k['gesamt']:.0f} %)"
    if k["strittig"]:
        text += f" +{k['strittig']} strittig"
    return text


# ---------------------------------------------------------------- Schema

# Die API übersetzt das Antwortschema in eine Grammatik und lehnt zu große Grammatiken ab ("compiled grammar
# is too large"). Auswahllisten (enum) vergrößern sie stark. Deshalb geht das Schema ohne enum an die API
# (die erlaubten Werte stehen in der Beschreibung und im Prompt), und die Antwort wird hier gegen das volle
# Schema geprüft. Dieselbe Regel nutzt das Addon (hintergrund.js).

def api_schema(schema):
    """Kopie des Schemas ohne enum; die erlaubten Werte wandern in die description."""
    if isinstance(schema, list):
        return [api_schema(x) for x in schema]
    if not isinstance(schema, dict):
        return schema
    neu = {k: api_schema(v) for k, v in schema.items() if k != "enum"}
    if isinstance(schema.get("enum"), list):
        werte = ", ".join(str(w) for w in schema["enum"])
        neu["description"] = (schema["description"] + ". " if schema.get("description") else "") + f"Erlaubte Werte: {werte}"
    return neu


def _aufloesen(schema: dict, defs: dict) -> dict:
    return defs[schema["$ref"].split("/")[-1]] if "$ref" in schema else schema


def enums_angleichen(wert, schema: dict, defs: dict | None = None):
    """Gleicht Groß/Klein von enum-Werten an (die API garantiert die Schreibung nicht)."""
    defs = schema.get("$defs", {}) if defs is None else defs
    schema = _aufloesen(schema, defs)
    if isinstance(wert, str) and isinstance(schema.get("enum"), list) and wert not in schema["enum"]:
        treffer = [e for e in schema["enum"] if isinstance(e, str) and e.casefold() == wert.strip().casefold()]
        return treffer[0] if treffer else wert
    if isinstance(wert, dict):
        props = schema.get("properties", {})
        return {k: enums_angleichen(v, props[k], defs) if k in props else v for k, v in wert.items()}
    if isinstance(wert, list) and isinstance(schema.get("items"), dict):
        return [enums_angleichen(x, schema["items"], defs) for x in wert]
    return wert


def schema_fehler(wert, schema: dict, pfad: str = "$", defs: dict | None = None) -> list[str]:
    """Prüft type, required, additionalProperties, enum, items und $ref (ohne Zusatzpaket)."""
    defs = schema.get("$defs", {}) if defs is None else defs
    schema = _aufloesen(schema, defs)
    typ = schema.get("type")
    if typ == "integer" and not (isinstance(wert, int) and not isinstance(wert, bool)):
        return [f"{pfad}: keine Ganzzahl"]
    erwartet = {"object": dict, "array": list, "string": str, "boolean": bool}.get(typ)
    if erwartet and not isinstance(wert, erwartet):
        return [f"{pfad}: erwartet {typ}"]
    f = []
    if "enum" in schema and wert not in schema["enum"]:
        f.append(f"{pfad}: {wert!r} nicht erlaubt")
    if typ == "object":
        f += [f"{pfad}.{k}: fehlt" for k in schema.get("required", []) if k not in wert]
        if schema.get("additionalProperties") is False:
            f += [f"{pfad}.{k}: unbekannt" for k in wert if k not in schema.get("properties", {})]
        for k, s in schema.get("properties", {}).items():
            if k in wert:
                f += schema_fehler(wert[k], s, f"{pfad}.{k}", defs)
    if typ == "array" and isinstance(schema.get("items"), dict):
        for i, x in enumerate(wert):
            f += schema_fehler(x, schema["items"], f"{pfad}[{i}]", defs)
    return f


# ---------------------------------------------------------------- API-Aufruf

def analysieren(client, artikeltext: str, modell: str, effort: str, fallback: bool) -> tuple[dict, dict]:
    # Ohne erzwungenes Format: Das Analyseschema ist für die Grammatik der API zu groß ("compiled grammar is too
    # large"). Das Schema steht im Prompt, die Antwort wird gegen das volle Schema geprüft.
    return _anfrage(client, "prompt.md", "schema.json", artikeltext, modell, effort, fallback, erzwungen=False)


def spiegeln(client, artikeltext: str, modell: str, effort: str, fallback: bool) -> tuple[dict, dict]:
    """Gegenfassung mit vertauschten Seiten (Spiegelprobe), gleiche Machart und Stärke wie das Original."""
    return _anfrage(client, "spiegel_prompt.md", "spiegel_schema.json", artikeltext, modell, effort, fallback,
                    erzwungen=True)


def mit_schema(prompt: str, schema: dict) -> str:
    """Prompt plus Schema als Text, für Anfragen ohne erzwungenes Format (wie im Addon)."""
    return f"{prompt.rstrip()}\n\n<schema>\n{json.dumps(schema, ensure_ascii=False, separators=(",", ":"))}\n</schema>\n"


def json_aus_text(text: str):
    """JSON aus der Antwort, auch wenn das Modell doch eine Codeblock-Markierung oder einen Satz davor schreibt."""
    t = text.strip()
    anfang, ende = t.find("{"), t.rfind("}")
    if anfang < 0 or ende < anfang:
        raise json.JSONDecodeError("kein JSON-Objekt in der Antwort", t, 0)
    return json.loads(t[anfang:ende + 1])


def _anfrage(client, prompt_datei: str, schema_datei: str, artikeltext: str, modell: str, effort: str,
             fallback: bool, erzwungen: bool) -> tuple[dict, dict]:
    system = (KERN / prompt_datei).read_text(encoding="utf-8")
    schema = json.loads((KERN / schema_datei).read_text(encoding="utf-8"))
    ausgabe = {"effort": effort}
    if erzwungen:
        ausgabe["format"] = {"type": "json_schema", "schema": api_schema(schema)}
    else:
        system = mit_schema(system, schema)
    anfrage = dict(
        model=modell,
        max_tokens=MAX_TOKENS,
        thinking={"type": "adaptive"},
        output_config=ausgabe,
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
        raise RuntimeError("Das Modell hat die Anfrage abgelehnt (stop_reason: refusal).")
    if antwort.stop_reason == "max_tokens":
        raise RuntimeError(f"Antwort abgeschnitten (max_tokens={MAX_TOKENS} erreicht).")
    text = next(b.text for b in antwort.content if b.type == "text")
    analyse = enums_angleichen(json_aus_text(text), schema)
    fehler = schema_fehler(analyse, schema)
    if fehler:
        raise RuntimeError(f"Antwort passt nicht zum Schema ({len(fehler)} Stellen): " + "; ".join(fehler[:5]))

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
        "muster": [muster_text(a), muster_text(b)],
        "muster_gleich": ({m["art"] for m in muster_von(a)["muster"]} == {m["art"] for m in muster_von(b)["muster"]}
                          and ("strategische_muster" in a) == ("strategische_muster" in b)),
        "stimmen": [stimmen_text(a), stimmen_text(b)],
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


def quelle_von(datei: Path) -> str:
    """Domain aus der Zeile 'URL: …' am Anfang der Artikeldatei, sonst '?'."""
    try:
        with datei.open(encoding="utf-8-sig") as f:
            for _ in range(3):
                treffer = re.match(r"\s*URL:\s*https?://([^/\s]+)", f.readline())
                if treffer:
                    return treffer.group(1).lower().removeprefix("www.")
    except OSError:
        pass
    return "?"


def wiederkehrende_leitbegriffe(alle: dict[str, list[dict]], quellen: dict[str, str]) -> list[str]:
    """Leitbegriffe, die in mindestens zwei Artikeln vorkommen (Vereinigung aller Läufe je Artikel).

    Dasselbe wertende Wort in mehreren Texten einer Quelle ist ein Hinweis auf eine Sprachregelung,
    kein Beweis: Zufall, gemeinsame Agenturvorlage oder ein Begriff aus der Debatte selbst sind möglich.
    """
    fundorte: dict[str, set[str]] = {}
    schreibweisen: dict[str, dict[str, int]] = {}
    for artikel, laeufe in alle.items():
        for lauf in laeufe:
            for begriff in muster_von(lauf["analyse"])["leitbegriffe"]:
                schl = normalisieren(begriff).strip("\"' ")
                if not schl:
                    continue
                fundorte.setdefault(schl, set()).add(artikel)
                sw = schreibweisen.setdefault(schl, {})
                sw[begriff.strip()] = sw.get(begriff.strip(), 0) + 1
    mehrfach = [(schl, sorted(art)) for schl, art in fundorte.items() if len(art) >= 2]
    if not mehrfach:
        return []

    def je_quelle(artikel: list[str]) -> dict[str, int]:
        zaehler: dict[str, int] = {}
        for a in artikel:
            zaehler[quellen[a]] = zaehler.get(quellen[a], 0) + 1
        return zaehler

    mehrfach.sort(key=lambda x: (-max(je_quelle(x[1]).values()), -len(x[1]), x[0]))
    zeilen = ["", "## Wiederkehrende Leitbegriffe über mehrere Artikel", "",
              "Wertende Schlüsselbegriffe, die das Modell in mindestens zwei Artikeln genannt hat (alle Läufe). "
              "Häufung in einer Quelle kann auf eine Sprachregelung hindeuten; sie belegt sie nicht.", "",
              "| Begriff | Artikel | je Quelle | Artikel |", "|---|---|---|---|"]
    for schl, artikel in mehrfach:
        anzeige = max(schreibweisen[schl].items(), key=lambda kv: kv[1])[0]
        q = je_quelle(artikel)
        q_text = ", ".join(f"{k} {v}" for k, v in sorted(q.items(), key=lambda kv: (-kv[1], kv[0])))
        zeilen.append(f"| {anzeige} | {len(artikel)} | {q_text} | {', '.join(artikel)} |")
    return zeilen


def erwartung_abweichungen(a: dict, e: dict) -> list[str]:
    """Abweichungen einer Analyse von den Erwartungen eines Eintrags aus erwartung.json (leer = erfüllt)."""
    f = []
    if "gattung" in e and a["gattung"]["art"] not in e["gattung"]:
        f.append(f"Gattung {a['gattung']['art']}")
    if "kennzeichnungsproblem" in e and a["kennzeichnungsproblem"]["vorhanden"] != e["kennzeichnungsproblem"]:
        f.append("Kennzeichnungsproblem " + ("ja" if a["kennzeichnungsproblem"]["vorhanden"] else "nein"))
    if "richtung" in e and a["richtung"]["einordnung"] not in e["richtung"]:
        f.append(f"Richtung {a['richtung']['einordnung']}")
    zitate = [m["zitat"] for m in a["markierungen"] if not m["strittig"]]
    wertend = [m["zitat"] for m in a["markierungen"] if not m["strittig"] and not m.get("nur_struktur")]
    for stelle in e.get("markiert_enthaelt", []):
        if not any(_passen(stelle, z) for z in zitate):
            f.append(f"nicht markiert: {stelle}")
    for wort in e.get("nicht_markiert", []):
        if any(normalisieren(wort) in normalisieren(z) for z in wertend):
            f.append(f"markiert: {wort}")
    if "strategische_muster" not in a:
        return f + ["Analyse ohne Muster (ältere Version)"]
    sm = a["strategische_muster"]
    arten = {m["art"] for m in sm["muster"]}
    for art in e.get("muster_mind", []):
        if art not in arten:
            f.append(f"Muster {MUSTER_KURZ[art]} fehlt")
    if e.get("muster_keine"):
        f += [f"Muster {MUSTER_KURZ[m['art']]} gefunden" for m in sm["muster"] if not m["strittig"]]
    leit = {normalisieren(x) for x in sm["leitbegriffe"]}
    f += [f"Leitbegriff {x}" for x in e.get("leitbegriffe_nicht", []) if normalisieren(x) in leit]
    if "zitatwertung" in e:
        zw = a.get("zitatwertungen")
        if not zw:
            f.append("Analyse ohne Zitatwertungen (ältere Version)")
        elif zw["einschaetzung"]["einordnung"] not in e["zitatwertung"]:
            f.append(f"Zitatwertung {zw['einschaetzung']['einordnung']}")
    return f


def erwartung_abgleich(alle: dict[str, list[dict]], erwartung: dict) -> list[str]:
    namen = [n for n in alle if n in erwartung]
    if not namen:
        return []
    zeilen = ["", "## Abgleich mit erwartung.json", "",
              "Zahl in Klammern = in wie vielen Läufen die Abweichung auftrat.", "",
              "| Artikel | Läufe erfüllt | Abweichungen |", "|---|---|---|"]
    for name in namen:
        laeufe = alle[name]
        zaehler: dict[str, int] = {}
        erfuellt = 0
        for lauf in laeufe:
            abw = erwartung_abweichungen(lauf["analyse"], erwartung[name])
            erfuellt += not abw
            for x in dict.fromkeys(abw):
                zaehler[x] = zaehler.get(x, 0) + 1
        text = "; ".join(f"{x} ({n}/{len(laeufe)})" for x, n in zaehler.items()) or "–"
        zeilen.append(f"| {name} | {erfuellt}/{len(laeufe)} | {text} |")
    return zeilen


def _zahl(x: float) -> str:
    return str(int(x)) if x == int(x) else f"{x:.1f}"


def _muster_mehrheit(laeufe: list[dict], nur_fest: bool = False) -> set[str]:
    """Musterarten, die in mindestens der Hälfte der Läufe vorkommen (nur_fest: nur nicht strittige)."""
    zaehler: dict[str, int] = {}
    for lauf in laeufe:
        for art in {m["art"] for m in muster_von(lauf["analyse"])["muster"] if not (nur_fest and m["strittig"])}:
            zaehler[art] = zaehler.get(art, 0) + 1
    return {art for art, n in zaehler.items() if 2 * n >= len(laeufe)}


def symmetrie(a: list[dict], b: list[dict]) -> dict:
    """Vergleicht zwei Gruppen von Läufen (pro/kontra oder Original/Gegenfassung).

    Teilwerte gemittelt; abweichend ist eine Dimension mit mehr als 1 Unterschied, ungleiche nicht strittige
    Muster (Mehrheit der Läufe), ungleiches Kennzeichnungsproblem und ungleiche Wertung über Zitate. Muster, die nur strittig vorkommen,
    werden in der Zelle ausgewiesen, entscheiden aber nicht.
    """
    zellen, abweichend = [], []
    for d in DIMENSIONEN:
        ma = sum(l["analyse"]["teilwerte"][d]["wert"] for l in a) / len(a)
        mb = sum(l["analyse"]["teilwerte"][d]["wert"] for l in b) / len(b)
        zellen.append(f"{_zahl(ma)} / {_zahl(mb)}")
        if abs(ma - mb) > 1:
            abweichend.append(KURZ[d])
    mua, mub = _muster_mehrheit(a, nur_fest=True), _muster_mehrheit(b, nur_fest=True)
    sta, stb = _muster_mehrheit(a) - mua, _muster_mehrheit(b) - mub
    kurz = lambda menge: ", ".join(sorted(MUSTER_KURZ[x] for x in menge)) or "–"
    muster = kurz(mua) if mua == mub else f"{kurz(mua)} / {kurz(mub)}"
    if sta or stb:
        muster += f" (strittig: {kurz(sta)})" if sta == stb else f" (strittig: {kurz(sta)} / {kurz(stb)})"
    if mua != mub:
        abweichend.append("Muster")
    ka = 2 * sum(l["analyse"]["kennzeichnungsproblem"]["vorhanden"] for l in a) >= len(a)
    kb = 2 * sum(l["analyse"]["kennzeichnungsproblem"]["vorhanden"] for l in b) >= len(b)
    kennz = ("ja" if ka else "nein") if ka == kb else f"{'ja' if ka else 'nein'} / {'ja' if kb else 'nein'}"
    if ka != kb:
        abweichend.append("Kennz.")
    # Wertung über Zitate: häufigste Einschätzung je Seite (nur wenn alle Läufe sie haben)
    za, zb = _zitat_mehrheit(a), _zitat_mehrheit(b)
    if za and zb and za != zb:
        abweichend.append(f"Zitate ({za} / {zb})")
    return {"zellen": zellen, "muster": muster, "kennz": kennz, "abweichend": abweichend}


def _zitat_mehrheit(laeufe: list[dict]) -> str | None:
    """Häufigste Einschätzung der Wertung über Zitate; None, wenn ein Lauf sie nicht hat (ältere Analyse)."""
    werte = [(l["analyse"].get("zitatwertungen") or {}).get("einschaetzung", {}).get("einordnung") for l in laeufe]
    if not werte or None in werte:
        return None
    return max(set(werte), key=werte.count)


def spiegelpaare(alle: dict[str, list[dict]]) -> list[str]:
    """Vergleicht Artikel <stamm>_pro mit <stamm>_kontra: Gleiche Bauart muss gleich bewertet werden.

    Teilwerte gemittelt über alle Läufe; symmetrisch heißt: keine Dimension weicht um mehr als 1 ab,
    gleiche nicht strittige Muster (Mehrheit der Läufe) und gleiche Einschätzung des Kennzeichnungsproblems.
    """
    staemme = sorted(n[:-4] for n in alle if n.endswith("_pro") and n[:-4] + "_kontra" in alle)
    if not staemme:
        return []
    zeilen = ["", "## Spiegelpaare (pro / kontra)", "",
              "Teilwerte gemittelt über alle Läufe. Symmetrisch: keine Dimension weicht um mehr als 1 ab, "
              "gleiche nicht strittige Muster (in mindestens der Hälfte der Läufe), gleiches Kennzeichnungsproblem. "
              "Muster, die nur strittig vorkommen, stehen in Klammern und entscheiden nicht.", "",
              "| Paar | W | E | Q | A | Ü | Muster | Kennz.-Problem | Richtung pro | Richtung kontra | symmetrisch |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
    for stamm in staemme:
        p, k = alle[stamm + "_pro"], alle[stamm + "_kontra"]
        sym = symmetrie(p, k)
        abweichend = sym["abweichend"]
        zeilen.append(f"| {stamm} | " + " | ".join(sym["zellen"]) + f" | {sym['muster']} | {sym['kennz']} | "
                      f"{richtung_text(p[0]['analyse']['richtung'])} | {richtung_text(k[0]['analyse']['richtung'])} | "
                      + ("ja" if not abweichend else "nein: " + ", ".join(abweichend)) + " |")
    return zeilen


def spiegel_pfad(ergebnisse: Path, datei: Path, name: str) -> Path:
    """Dateien der Spiegelprobe: spiegel.json (Gegenfassung), spiegel_text.txt, spiegel_lauf1.json (ihre Analyse)."""
    return ergebnisse / datei.stem / name


def _richtung_gedreht(o: dict, s: dict) -> bool:
    """Bei Parteinahme in beiden Fassungen: Wer im Original begünstigt wird, darf es im Spiegel nicht sein."""
    if o["einordnung"] != "parteinahme" or s["einordnung"] != "parteinahme":
        return True
    return not any(_passen(x, y) for x in o["zugunsten"] for y in s["zugunsten"])


def spiegelprobe(dateien: list[Path], ergebnisse: Path, alle: dict[str, list[dict]]) -> list[str]:
    zeilen = []
    for datei in dateien:
        sp = spiegel_pfad(ergebnisse, datei, "spiegel.json")
        if not sp.exists():
            continue
        g = json.loads(sp.read_text(encoding="utf-8"))["spiegel"]
        an = spiegel_pfad(ergebnisse, datei, "spiegel_lauf1.json")
        if not g["spiegelbar"]:
            zeilen.append(f"| {datei.stem} | nicht spiegelbar: {g['streitfrage']} |" + " |" * 10)
            continue
        if not an.exists() or datei.stem not in alle:
            zeilen.append(f"| {datei.stem} | Analyse fehlt |" + " |" * 10)
            continue
        s = json.loads(an.read_text(encoding="utf-8"))
        sym = symmetrie(alle[datei.stem], [s])
        abweichend = sym["abweichend"]
        ro, rs = alle[datei.stem][0]["analyse"]["richtung"], s["analyse"]["richtung"]
        if ro["einordnung"] != rs["einordnung"]:
            abweichend.append("Richtung")
        elif not _richtung_gedreht(ro, rs):
            abweichend.append("Richtung nicht gedreht")
        zeilen.append(f"| {datei.stem} | " + " | ".join(sym["zellen"]) + f" | {sym['muster']} | {sym['kennz']} | "
                      f"{richtung_text(ro)} | {richtung_text(rs)} | {len(g['nicht_gespiegelt'])} | "
                      + ("ja" if not abweichend else "nein: " + ", ".join(abweichend)) + " |")
    if not zeilen:
        return []
    return ["", "## Spiegelprobe (Original / Gegenfassung)", "",
            "Die Gegenfassung vertauscht die Seiten bei gleicher Machart (spiegel_text.txt je Artikel). Teilwerte: "
            "Mittel der Original-Läufe / ein Lauf der Gegenfassung. Symmetrisch: keine Dimension weicht um mehr als 1 "
            "ab, gleiche nicht strittige Muster, gleiches Kennzeichnungsproblem, gleiche Einordnung der Richtung, bei Parteinahme "
            "gedreht. Eine Abweichung heißt: Die Analyse misst ungleich oder die Gegenfassung ist nicht gleich stark "
            "geraten; das zeigt nur das Lesen der Gegenfassung.", "",
            "| Artikel | W | E | Q | A | Ü | Muster | Kennz.-Problem | Richtung Original | Richtung Gegenfassung "
            "| nicht gespiegelt | symmetrisch |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|"] + zeilen


def bericht(dateien: list[Path], ergebnisse: Path) -> str:
    zeilen = ["# Wertungsanalyse – Übersicht", "",
              f"Stand {datetime.now():%d.%m.%Y %H:%M}. Teilwerte W/E/Q/A/Ü = Wortwahl, epistemische Rahmung, "
              "Quellen, Auswahl, Überschrift (0–4). Kennzahl = markierte/alle Sätze, Anteil erst ab "
              f"{MIN_SAETZE_FUER_ANTEIL} Sätzen. Muster: Kl moralische Klammer, De moralische Delegitimierung, "
              "Di Dichotomie, Wir vereinnahmendes Wir, Um Umbenennung, Wh Leitbegriff-Wiederholung, An Angstappell, Sb Sündenbock; "
              "? = strittig, – = keine, ? allein = Analyse vor Einführung der Muster. "
              "Stimmen: Stimmen/zugeschriebene Aussagen, Zahl der Positionen (ohne ‚ohne Position‘), "
              "Akteure ohne Stimme; ? = Analyse vor Einführung des Verzeichnisses.", "",
              "## Lauf 1 je Artikel", "",
              "| Artikel | Gattung | Kennz.-Problem | W | E | Q | A | Ü | Kennzahl | Richtung | Muster | Stimmen | Zitate nicht gefunden | Kosten |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    vergleiche, kosten_summe = [], 0.0
    alle_laeufe: dict[str, list[dict]] = {}
    quellen: dict[str, str] = {}
    for datei in dateien:
        laeufe = []
        nr = 1
        while lauf_pfad(ergebnisse, datei, nr).exists():
            laeufe.append(json.loads(lauf_pfad(ergebnisse, datei, nr).read_text(encoding="utf-8")))
            nr += 1
        if not laeufe:
            zeilen.append(f"| {datei.stem} | – noch nicht analysiert – | | | | | | | | | | | | |")
            continue
        alle_laeufe[datei.stem] = laeufe
        quellen[datei.stem] = quelle_von(datei)
        kosten_summe += sum(l["meta"].get("kosten_usd_ca") or 0 for l in laeufe)
        e = laeufe[0]
        a, p = e["analyse"], e["pruefung"]
        tw = [str(a["teilwerte"][d]["wert"]) for d in DIMENSIONEN]
        kosten = e["meta"].get("kosten_usd_ca")
        zeilen.append(
            f"| {datei.stem} | {a['gattung']['art']} | {'ja' if a['kennzeichnungsproblem']['vorhanden'] else 'nein'} | "
            + " | ".join(tw)
            + f" | {kennzahl_text(a['kennzahl'])} | {richtung_text(a['richtung'])} | {muster_text(a)} | {stimmen_text(a)} | "
            f"{len(p['zitate_nicht_gefunden'])} von {p['markierungen']} | "
            f"{'%.2f $' % kosten if kosten is not None else '?'} |")
        if len(laeufe) >= 2:
            vergleiche.append((datei.stem, vergleichen(laeufe[-2]["analyse"], laeufe[-1]["analyse"]), len(laeufe)))

    if vergleiche:
        zeilen += ["", "## Vergleich der letzten zwei Läufe", "",
                   "| Artikel | Gattung | ΔW | ΔE | ΔQ | ΔA | ΔÜ | mittl./max. Abw. | Markierungen | gemeinsam | Jaccard | gleiche Dim. | Kennzahl | Richtung | Muster | Stimmen |",
                   "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for name, v, _ in vergleiche:
            d = v["teilwerte_delta"]
            gattung = v["gattung"][0] if v["gattung_gleich"] else " → ".join(v["gattung"])
            richtung = "gleich" if v["richtung_gleich"] else " → ".join(v["richtung"])
            muster = "gleich" if v["muster_gleich"] else " → ".join(v["muster"])
            stimmen = v["stimmen"][0] if v["stimmen"][0] == v["stimmen"][1] else " → ".join(v["stimmen"])
            zeilen.append(
                f"| {name} | {gattung} | " + " | ".join(f"{d[k]:+d}" if d[k] else "0" for k in DIMENSIONEN)
                + f" | {v['teilwerte_mittl_abw']} / {v['teilwerte_max_abw']} | {v['markierungen'][0]} / {v['markierungen'][1]}"
                f" | {v['markierungen_gemeinsam']} | {v['markierungen_jaccard']} | "
                f"{v['dimension_gleich_bei_gemeinsamen']}/{v['markierungen_gemeinsam']} | "
                f"{v['kennzahl'][0]} → {v['kennzahl'][1]} | {richtung} | {muster} | {stimmen} |")
    zeilen += spiegelpaare(alle_laeufe)
    zeilen += spiegelprobe(dateien, ergebnisse, alle_laeufe)
    erwartung_datei = dateien[0].parent / "erwartung.json" if dateien else None
    if erwartung_datei and erwartung_datei.exists():
        zeilen += erwartung_abgleich(alle_laeufe, json.loads(erwartung_datei.read_text(encoding="utf-8")))
    zeilen += wiederkehrende_leitbegriffe(alle_laeufe, quellen)
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
    ap.add_argument("--spiegel", action="store_true",
                    help="Spiegelprobe: Gegenfassung schreiben und analysieren (zwei Aufrufe je Artikel)")
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
        if args.spiegel:
            auftraege += [(d, 0) for d in dateien
                          if args.neu or not spiegel_pfad(ergebnisse, d, "spiegel_lauf1.json").exists()]
        if auftraege:
            if not os.environ.get("ANTHROPIC_API_KEY"):
                print("ANTHROPIC_API_KEY ist nicht gesetzt. In PowerShell: $env:ANTHROPIC_API_KEY = Read-Host -MaskInput",
                      file=sys.stderr)
                return 2
            import anthropic
            client = anthropic.Anthropic()
            print(f"{len(auftraege)} Aufträge mit {args.modell}, effort {args.effort} …")

            def spiegel_erledigen(datei: Path) -> str:
                """Lauf 0 = Spiegelprobe: Gegenfassung (falls nötig) und ihre Analyse."""
                text = datei.read_text(encoding="utf-8-sig")
                sp = spiegel_pfad(ergebnisse, datei, "spiegel.json")
                if args.neu or not sp.exists():
                    gegen, meta = spiegeln(client, text, args.modell, args.effort, not args.ohne_fallback)
                    sp.parent.mkdir(parents=True, exist_ok=True)
                    sp.write_text(json.dumps({"artikel": datei.name, "meta": meta, "spiegel": gegen},
                                             ensure_ascii=False, indent=2), encoding="utf-8")
                    spiegel_pfad(ergebnisse, datei, "spiegel_text.txt").write_text(gegen["text"], encoding="utf-8")
                gegen = json.loads(sp.read_text(encoding="utf-8"))["spiegel"]
                if not gegen["spiegelbar"] or not gegen["text"].strip():
                    return f"{datei.stem} Spiegelprobe: nicht spiegelbar ({gegen['streitfrage']})"
                analyse, meta = analysieren(client, gegen["text"], args.modell, args.effort, not args.ohne_fallback)
                spiegel_pfad(ergebnisse, datei, "spiegel_lauf1.json").write_text(
                    json.dumps({"artikel": datei.name, "lauf": "spiegel", "meta": meta, "analyse": analyse,
                                "pruefung": pruefen(analyse, gegen["text"])}, ensure_ascii=False, indent=2),
                    encoding="utf-8")
                return f"{datei.stem} Spiegelprobe: {len(gegen['nicht_gespiegelt'])} Stellen nicht gespiegelt"

            def erledigen(datei: Path, nr: int) -> str:
                if nr == 0:
                    return spiegel_erledigen(datei)
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
                    nr = nr or "Spiegelprobe"
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
