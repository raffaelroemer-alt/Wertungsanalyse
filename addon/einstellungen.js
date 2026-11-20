const VORGABEN = { modell: "claude-opus-5-5", effort: "high" };
const $ = (id) => document.getElementById(id);

function melden(id, text, klasse) {
  const el = $(id);
  el.textContent = text;
  el.className = "meldung " + (klasse || "");
}

async function anzeigen() {
  const alles = await chrome.storage.local.get(null);
  $("schluesselStand").textContent = alles.apiKey ? "Ein Schlüssel ist gespeichert." : "Noch kein Schlüssel gespeichert.";
  $("schluesselStand").className = "klein " + (alles.apiKey ? "ok" : "warn");
  $("modell").value = alles.modell || VORGABEN.modell;
  $("effort").value = alles.effort || VORGABEN.effort;
  const ergebnisse = Object.keys(alles).filter((k) => k.startsWith("ergebnis:"));
  const spiegel = Object.keys(alles).filter((k) => k.startsWith("spiegel:")).length;
  $("speicherStand").textContent = (ergebnisse.length === 1 ? "1 Ergebnis gespeichert" : `${ergebnisse.length} Ergebnisse gespeichert`)
    + (spiegel ? `, dazu ${spiegel} Spiegelprobe${spiegel === 1 ? "" : "n"}.` : ".");
}

$("schluesselSpeichern").addEventListener("click", async () => {
  const wert = $("schluessel").value.trim();
  if (!wert) return melden("schluesselMeldung", "Bitte zuerst einen Schlüssel eingeben.", "warn");
  if (!wert.startsWith("sk-ant-")) return melden("schluesselMeldung", "Das sieht nicht nach einem Anthropic-Schlüssel aus (beginnt mit sk-ant-).", "warn");
  await chrome.storage.local.set({ apiKey: wert });
  $("schluessel").value = "";
  melden("schluesselMeldung", "Gespeichert.", "ok");
  anzeigen();
});

$("schluesselLoeschen").addEventListener("click", async () => {
  await chrome.storage.local.remove("apiKey");
  melden("schluesselMeldung", "Schlüssel gelöscht.", "ok");
  anzeigen();
});

$("modellSpeichern").addEventListener("click", async () => {
  const modell = $("modell").value.trim() || VORGABEN.modell;
  if (!/^[a-z0-9.\-]+$/.test(modell)) return melden("modellMeldung", "Ungültige Modell-ID.", "warn");
  await chrome.storage.local.set({ modell, effort: $("effort").value });
  melden("modellMeldung", "Gespeichert. Gilt für die nächste Analyse; gemerkte Ergebnisse bleiben.", "ok");
});

$("speicherLeeren").addEventListener("click", async () => {
  const alles = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(alles).filter((k) => k.startsWith("ergebnis:") || k.startsWith("spiegel:") || k.startsWith("bericht:")));
  anzeigen();
});

anzeigen();
