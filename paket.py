"""Packt den Ordner addon/ als ZIP zum Signieren auf addons.mozilla.org (oder für den Chrome Web Store).

Aufruf: python paket.py  →  dist/wertungsanalyse-<version>.zip
Pfade im Archiv mit "/" und manifest.json auf oberster Ebene, wie Mozilla es verlangt.
"""
import json
import zipfile
from pathlib import Path

WURZEL = Path(__file__).parent
ADDON = WURZEL / "addon"


def main():
    version = json.loads((ADDON / "manifest.json").read_text(encoding="utf-8"))["version"]
    ziel = WURZEL / "dist" / f"wertungsanalyse-{version}.zip"
    ziel.parent.mkdir(exist_ok=True)
    dateien = sorted(p for p in ADDON.rglob("*") if p.is_file() and not p.name.startswith("."))
    with zipfile.ZipFile(ziel, "w", zipfile.ZIP_DEFLATED) as z:
        for p in dateien:
            z.write(p, p.relative_to(ADDON).as_posix())
    print(f"{ziel.relative_to(WURZEL)}: {len(dateien)} Dateien, {ziel.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
