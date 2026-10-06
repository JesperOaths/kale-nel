// C720P TV + Surround V20 S5 recovery.
// Intended to replace ensureIR() in c720p-tv-surround.html.
async function ensureIR() {
  if (irReady) return true;

  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    status("Finding S5 IR bridge" + (attempt > 1 ? " · retry" : "") + "…");

    try {
      await req(8789, "/s5/reconnect", "POST", 26000);
    } catch (err) {
      lastError = err;
    }

    await wait(700);

    try {
      const health = await req(8789, "/health", "GET", 10000);
      irReady = !!(
        health.s5_connected ||
        (health.s5_http && health.s5_http.ok)
      );

      if (irReady) {
        pill(e.irP, "IR", true);
        status("S5 IR bridge ready", "ok");
        return true;
      }
    } catch (err) {
      lastError = err;
    }
  }

  irReady = false;
  pill(e.irP, "IR", false, true);

  throw new Error(
    "S5 IR bridge unavailable" +
    (lastError ? ": " + String(lastError?.message || lastError) : "")
  );
}
