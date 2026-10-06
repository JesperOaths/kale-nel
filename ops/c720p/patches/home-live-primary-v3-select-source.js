// C720P Security LIVE primary-only source selection.
// Intended to replace the selectSource() implementation in home-live-primary-v2.html.
// S3 is deliberately not a fallback.
async function selectSource() {
  if (!isOn()) return;
  const g = generation;

  let primary = null;
  try {
    primary = await getJson(PRIMARY_HEALTH);
  } catch (_) {}

  if (g !== generation || !isOn()) return;

  if (primaryHealthy(primary)) {
    await setSource("primary", PRIMARY_STREAM, "Live · New camera", "");
    return;
  }

  try { cam.removeAttribute("src"); } catch (_) {}
  statusBox.textContent = "Primary camera offline";
  statusBox.classList.add("show");
}
