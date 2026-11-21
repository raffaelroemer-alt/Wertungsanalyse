"""Holt die Untertitel einer tagesschau.de-Seite und legt je Video einen Text für wertung.py an.

Aufruf:
    python tagesschau.py https://www.tagesschau.de/multimedia/sendung/tagesschau_20_uhr
    python tagesschau.py <adresse> --ordner testartikel --neu

Je Video mit Untertiteln (ganze Sendung und einzelne Beiträge) entstehen in testartikel/:
- ts_<datum>_<titel>.txt: Zeile "URL:", Zeile "Quelle:" (Herkunft, Hinweis auf Untertitel), Titel,
  dann je Sprecherwechsel ein Absatz mit der Marke [Absatz N]. Geräuschangaben wie "* Gong *", der
  Live-Hinweis und der Copyright-Vermerk der Untertitelung fallen weg.
- ts_<datum>_<titel>.stimmen.json: Absätze (nr wie im Text) mit Farbe, Zeiten, Sekunden und Wörtern, dazu
  Summen je Farbe. Die Analyse ordnet jeder Stimme ihre O-Ton-Absätze zu (Feld "absaetze"); daraus ergibt sich
  die Redezeit. wertung.py liest nur .txt/.md und lässt diese Datei in Ruhe.

Sprecherwechsel erkennt das Skript an der Farbe der Untertitel (deutsche Konvention: eine Farbe je Sprecher
innerhalb einer Szene). Namen stehen nicht in den Untertiteln, nur im Bild. Vorhandene Dateien werden nicht
überschrieben, außer mit --neu. Texte und Ergebnisse bleiben außerhalb des Repositorys (testartikel/ ist ignoriert).
"""
import argparse
import html
import json
import re
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

HIER = Path(__file__).parent
KOPF = {"User-Agent": "Mozilla/5.0 (Wertungsanalyse; privates Analysewerkzeug)"}
FARBE = {"textWhite": "weiß", "textYellow": "gelb", "textCyan": "cyan", "textGreen": "grün", "textMagenta": "magenta",
         "textBlue": "blau", "textRed": "rot", "textBlack": "schwarz"}
GERAEUSCH = re.compile(r"\*[^*]{0,80}\*")
LIVE = re.compile(r"Diese Sendung wurde[^.()]*?live untertitelt", re.I)
VERMERK = re.compile(r"^\s*(Copyright|©)\s*Untertitel", re.I)


def laden(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=KOPF), timeout=30) as antwort:
        return antwort.read().decode("utf-8")


def themen_liste(synopsis):
    """Themenliste einer Sendung (meta.synopsis); getrennt nur an Kommas vor einem neuen Thema (wie gemeinsam.js)."""
    t = re.sub(r"^\s*Themen der Sendung:\s*", "", synopsis or "", flags=re.I).strip()
    if "," not in t:
        return []
    return [x.strip() for x in re.split(r',\s+(?=[A-ZÄÖÜ0-9#„"»])', t) if x.strip()]


def videos(seite, ohne_untertitel=None):
    """Alle Videos der Seite mit deutschen Untertiteln (EBU-TT): Titel, Dauer, Untertitel-Adresse, Datum, Themen.
    Titel von Videos ohne Untertitel kommen in die Liste ohne_untertitel, falls angegeben."""
    gefunden, gesehen = [], set()
    for roh in re.findall(r'data-v="([^"]*)"', seite):
        try:
            daten = json.loads(html.unescape(roh))
        except json.JSONDecodeError:
            continue
        mc = daten.get("mc") or {}
        quellen = [q["url"] for u in mc.get("subtitles") or [] if u.get("languageCode") == "de"
                   for q in u.get("sources") or [] if q.get("kind") == "ebutt" and q.get("url")]
        if not quellen:
            if ohne_untertitel is not None and (mc.get("meta") or {}).get("title"):
                ohne_untertitel.append(mc["meta"]["title"])
            continue
        if quellen[0] in gesehen:
            continue
        gesehen.add(quellen[0])
        meta = mc.get("meta") or {}
        clip = (((mc.get("pluginData") or {}).get("trackingAgf@all") or {}).get("clipData") or {}).get("title", "")
        datum = re.search(r"(\d{4})\.(\d{2})\.(\d{2})", clip)
        gefunden.append({"titel": meta.get("title") or "ohne Titel", "dauer_s": meta.get("durationSeconds"),
                         "untertitel": quellen[0], "datum": "".join(datum.groups()) if datum else None,
                         "themen": themen_liste(meta.get("synopsis"))})
    return gefunden


def sekunden(zeit):
    """'00:15:31.920' oder '00:15:31:12' (Bilder bei 25/s) in Sekunden."""
    teile = zeit.strip().split(":")
    h, m, s = int(teile[0]), int(teile[1]), float(teile[2])
    bilder = int(teile[3]) / 25 if len(teile) > 3 else 0
    return h * 3600 + m * 60 + s + bilder


def absaetze(xml_text):
    """Untertitel → Absätze: neuer Absatz, wenn die Farbe wechselt. Liefert (absätze, live)."""
    wurzel = ET.fromstring(xml_text)
    zeilen, live = [], False
    for p in wurzel.iter():
        if not p.tag.endswith("}p") or p.get("begin") is None:
            continue
        stuecke = []
        for sp in p.iter():
            if sp.tag.endswith("}span"):
                text = " ".join("".join(sp.itertext()).split())
                if text:
                    stuecke.append((sp.get("style") or p.get("style") or "", text))
        if not stuecke:
            text = " ".join("".join(p.itertext()).split())
            stuecke = [(p.get("style") or "", text)] if text else []
        # Hinweis der Untertitelung ("Diese Sendung wurde vom NDR live untertitelt"), oft über zwei Zeilen verteilt
        ganz = " ".join(t for _, t in stuecke)
        if LIVE.search(ganz):
            live = True
            continue
        if VERMERK.search(ganz):  # "Copyright Untertitel: NDR 2026"
            continue
        for stil, text in stuecke:
            zeilen.append((stil, text, sekunden(p.get("begin")), sekunden(p.get("end"))))

    teile = []
    for stil, text, beginn, ende in zeilen:
        text = " ".join(GERAEUSCH.sub(" ", text).split())
        if not text:
            continue
        farbe = FARBE.get(stil, stil or "ohne")
        if teile and teile[-1]["farbe"] == farbe:
            teile[-1]["text"] += " " + text
            teile[-1]["ende"] = ende
        else:
            teile.append({"farbe": farbe, "beginn": beginn, "ende": ende, "text": text})
    for nr, t in enumerate(teile, 1):
        t["nr"] = nr
        t["sekunden"] = round(t["ende"] - t["beginn"], 1)
        t["woerter"] = len(t["text"].split())
    return teile, live


def kurzname(titel):
    t = unicodedata.normalize("NFKD", titel.replace("ß", "ss")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")[:50] or "video"


def zeit(s):
    return f"{int(s) // 60}:{int(s) % 60:02d}"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Untertitel einer tagesschau.de-Seite als Text für wertung.py")
    ap.add_argument("adresse", help="Seite auf tagesschau.de mit Video(s)")
    ap.add_argument("--ordner", default=str(HIER / "testartikel"))
    ap.add_argument("--neu", action="store_true", help="vorhandene Dateien überschreiben")
    args = ap.parse_args()
    if not re.match(r"https://(www\.)?tagesschau\.de/", args.adresse):
        sys.exit("Bitte eine Adresse auf https://www.tagesschau.de/ angeben.")

    ohne = []
    liste = videos(laden(args.adresse), ohne)
    if not liste:
        sys.exit("Auf der Seite wurden keine Videos mit Untertiteln gefunden."
                 + (f" Ohne Untertitel: {'; '.join(ohne)}. Ihr Text steckt meist in der ganzen Sendung "
                    "(tagesschau 20 Uhr oder tagesthemen)." if ohne else ""))
    if ohne:
        print(f"ohne Untertitel, übersprungen: {'; '.join(ohne)}")
    ordner = Path(args.ordner)
    ordner.mkdir(exist_ok=True)

    # Einzelbeiträge sind aus der Sendung geschnitten und tragen den Live-Hinweis nicht selbst:
    # trägt ihn ein Video der Seite, gilt er für alle.
    for v in liste:
        v["name"] = f"ts_{v['datum'] or 'ohne_datum'}_{kurzname(v['titel'])}"
        v["teile"], v["live"] = absaetze(laden(v["untertitel"]))
    live_seite = any(v["live"] for v in liste)

    for v in liste:
        name, teile, live = v["name"], v["teile"], live_seite
        ziel = ordner / f"{name}.txt"
        if ziel.exists() and not args.neu:
            print(f"vorhanden, übersprungen: {ziel.name}")
            continue
        if not teile:
            print(f"keine Untertitelzeilen: {v['titel']}")
            continue
        datum = f"{v['datum'][6:8]}.{v['datum'][4:6]}.{v['datum'][:4]}" if v["datum"] else "Datum unbekannt"
        quelle = (f"Quelle: tagesschau.de, Video „{v['titel']}“ vom {datum}. Text aus den "
                  + ("Live-Untertiteln (können gekürzt oder umformuliert sein)" if live else "Untertiteln")
                  + ". Fernsehbeitrag: Jeder Absatz [Absatz N] ist ein Sprecherwechsel (an der Untertitelfarbe "
                  "erkannt); Bilder, Grafiken und Namenseinblendungen fehlen."
                  + (f" Themen der Sendung laut tagesschau.de: {'; '.join(v['themen'])}." if len(v["themen"]) > 1 else ""))
        ziel.write_text("\n".join([f"URL: {args.adresse}", quelle, v["titel"],
                                   *[f"[Absatz {t['nr']}] {t['text']}" for t in teile]]) + "\n", encoding="utf-8")

        farben = {}
        for t in teile:
            f = farben.setdefault(t["farbe"], {"absaetze": 0, "sekunden": 0.0, "woerter": 0})
            f["absaetze"] += 1
            f["sekunden"] = round(f["sekunden"] + t["sekunden"], 1)
            f["woerter"] += t["woerter"]
        (ordner / f"{name}.stimmen.json").write_text(json.dumps({
            "titel": v["titel"], "seite": args.adresse, "untertitel": v["untertitel"], "datum": v["datum"],
            "live_untertitelt": live, "dauer_s": v["dauer_s"], "farben": farben,
            "absaetze": [{k: (round(x, 1) if isinstance(x, float) else x) for k, x in t.items()} for t in teile],
        }, ensure_ascii=False, indent=1), encoding="utf-8")

        dauer = v["dauer_s"] or (teile[-1]["ende"] if teile else 0)
        print(f"{ziel.name}: {zeit(dauer)} min, {len(teile)} Absätze, {sum(t['woerter'] for t in teile)} Wörter"
              + (", live untertitelt" if live else ""))
        for farbe, f in sorted(farben.items(), key=lambda x: -x[1]["sekunden"]):
            print(f"   {farbe:8} {f['sekunden']:6.0f} s  {f['woerter']:5} Wörter  {f['absaetze']:3} Absätze")


if __name__ == "__main__":
    main()
