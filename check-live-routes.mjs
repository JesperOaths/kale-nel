#!/usr/bin/env node
/* GEJAST read-only live deployment health checker. */

const baseUrl = process.env.GEJAST_LIVE_BASE_URL || 'https://kalenel.nl';
const adminBaseUrl = process.env.GEJAST_ADMIN_BASE_URL || 'https://admin.kalenel.nl';
const expectedVersion = process.env.GEJAST_EXPECTED_VERSION || '';
const timeoutMs = Number(process.env.GEJAST_SMOKE_TIMEOUT_MS || 15000);
const deployWaitSeconds = Math.max(0, Number(process.env.GEJAST_DEPLOY_WAIT_SECONDS || 0));
const cacheBuster = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const publicRoutes = [
  '/',
  '/index.html',
  '/scorer.html',
  '/score.html',
  '/klaverjas_scorer_v596_repo_ready.html',
  '/klaverjas_live.html',
  '/klaverjas_online.html',
  '/toepen.html',
  '/beerpong.html',
  '/boerenbridge.html',
  '/boerenbridge_live.html',
  '/pikken.html',
  '/pikken_live.html',
  '/pikken_spectator.html',
  '/paardenrace.html',
  '/paardenrace_live.html',
  '/paardenrace_spectator.html',
  '/drinks.html',
  '/drinks_add.html',
  '/drinks_pending.html',
  '/drinks_history.html',
  '/drinks_speed.html',
  '/despimarkt.html',
  '/beurs.html',
  '/rad.html',
  '/profiles.html',
  '/my_profile.html',
  '/login.html',
  '/request.html',
  '/activate.html',
  '/familie.html',
  '/familie/index.html',
  '/familie/login.html',
  '/familie/scorer.html',
  '/familie/leaderboard.html',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: 'no-store',
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function urlFor(pathname, origin = baseUrl) {
  const url = new URL(pathname, origin);
  url.searchParams.set('cb', cacheBuster);
  return url.toString();
}

async function readText(pathname, origin = baseUrl) {
  const response = await fetchWithTimeout(urlFor(pathname, origin));
  const text = await response.text();
  return { response, text };
}

function requireText(text, needle, label, failures) {
  if (!text.includes(needle)) failures.push(`${label} missing ${JSON.stringify(needle)}`);
}

async function readLiveVersion() {
  const { response, text } = await readText('/VERSION');
  if (!response.ok) throw new Error(`/VERSION returned HTTP ${response.status}`);
  return text.trim();
}

async function waitForExpectedVersion(failures) {
  const deadline = Date.now() + deployWaitSeconds * 1000;
  let lastVersion = '';
  let lastError = null;
  do {
    try {
      lastVersion = await readLiveVersion();
      lastError = null;
      console.log(`Live VERSION: ${lastVersion}`);
      if (!expectedVersion || lastVersion === expectedVersion) return lastVersion;
    } catch (error) {
      lastError = error;
      console.warn(`VERSION probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (Date.now() >= deadline) break;
    await sleep(5000);
  } while (true);

  if (lastError) failures.push(lastError instanceof Error ? lastError.message : String(lastError));
  else if (expectedVersion) failures.push(`/VERSION expected ${expectedVersion}, got ${lastVersion || '(empty)'}`);
  return lastVersion;
}

const failures = [];
await waitForExpectedVersion(failures);

for (const route of publicRoutes) {
  try {
    const response = await fetchWithTimeout(urlFor(route));
    if (!response.ok) failures.push(`${route} returned HTTP ${response.status}`);
    console.log(`${route} HTTP ${response.status}`);
  } catch (error) {
    failures.push(`${route} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  const { response, text } = await readText('/index.html');
  if (!response.ok) failures.push(`/index.html content probe returned HTTP ${response.status}`);
  requireText(text, 'id="homeKlaverjasEntry"', 'homepage round-scorer entry', failures);
  requireText(text, 'href="./scorer.html"', 'homepage round-scorer route', failures);
  requireText(text, 'id="homeKlaverjasLiveEntry"', 'homepage live-scorer entry', failures);
  requireText(text, 'href="./score.html"', 'homepage live-scorer route', failures);
  if (expectedVersion) requireText(text, `GEJAST_PAGE_VERSION='${expectedVersion}'`, 'homepage deployed version', failures);
} catch (error) {
  failures.push(`homepage content probe failed: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const { response, text } = await readText('/score.html');
  if (!response.ok) failures.push(`/score.html content probe returned HTTP ${response.status}`);
  requireText(text, "new URL('./klaverjas_scorer_v596_repo_ready.html',location.href)", 'score alias target', failures);
  if (expectedVersion) requireText(text, `GEJAST_PAGE_VERSION='${expectedVersion}'`, 'score alias deployed version', failures);
} catch (error) {
  failures.push(`score alias content probe failed: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const { response, text } = await readText('/klaverjas_scorer_v596_repo_ready.html');
  if (!response.ok) failures.push(`/klaverjas_scorer_v596_repo_ready.html content probe returned HTTP ${response.status}`);
  requireText(text, 'id="liveBtn"', 'Klaverjas live-start button', failures);
  requireText(text, 'Live starten', 'Klaverjas live-start label', failures);
  if (expectedVersion) requireText(text, `./gejast-klaverjas-runtime.js?${expectedVersion}`, 'Klaverjas runtime cache version', failures);
} catch (error) {
  failures.push(`Klaverjas live scorer content probe failed: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const { response, text } = await readText('/gejast-klaverjas-runtime.js');
  if (!response.ok) failures.push(`/gejast-klaverjas-runtime.js content probe returned HTTP ${response.status}`);
  requireText(text, 'function normalizeMatchInput(input, options)', 'Klaverjas split validator', failures);
  requireText(text, '{ allowTie: true }', 'Klaverjas 0-0 live-start allowance', failures);
  requireText(text, 'start_klaverjas_live_match_v687', 'Klaverjas live start RPC alias', failures);
} catch (error) {
  failures.push(`Klaverjas runtime content probe failed: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const { response, text } = await readText('/scorer.html');
  if (!response.ok) failures.push(`/scorer.html content probe returned HTTP ${response.status}`);
  requireText(text, '<title>Klaverjas Scoreformulier</title>', 'round-by-round scorer preservation', failures);
} catch (error) {
  failures.push(`round scorer content probe failed: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const response = await fetchWithTimeout(urlFor('/admin.html'), { redirect: 'manual' });
  const location = response.headers.get('location') || '';
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    failures.push(`/admin.html expected redirect to admin perimeter, got HTTP ${response.status}`);
  } else {
    let redirectHost = '';
    try { redirectHost = new URL(location, baseUrl).host; } catch (_) {}
    if (redirectHost !== new URL(adminBaseUrl).host) failures.push(`/admin.html redirected to unexpected host ${redirectHost || '(invalid)'}`);
  }
  if ((response.headers.get('cache-control') || '').toLowerCase().includes('no-store') === false) {
    failures.push('/admin.html redirect missing Cache-Control: no-store');
  }
  console.log(`/admin.html HTTP ${response.status} -> ${location || '(no location)'}`);
} catch (error) {
  failures.push(`public admin perimeter probe failed: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const response = await fetchWithTimeout(urlFor('/admin.html', adminBaseUrl), { redirect: 'manual' });
  if (response.status !== 401) failures.push(`admin subdomain expected unauthenticated HTTP 401, got ${response.status}`);
  if ((response.headers.get('cache-control') || '').toLowerCase().includes('no-store') === false) failures.push('admin subdomain missing Cache-Control: no-store');
  if ((response.headers.get('x-frame-options') || '').toUpperCase() !== 'DENY') failures.push('admin subdomain missing X-Frame-Options: DENY');
  if ((response.headers.get('x-content-type-options') || '').toLowerCase() !== 'nosniff') failures.push('admin subdomain missing X-Content-Type-Options: nosniff');
  console.log(`Admin perimeter HTTP ${response.status}; build=${response.headers.get('x-kalenel-admin-build') || 'unknown'}`);
} catch (error) {
  failures.push(`admin subdomain perimeter probe failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length) {
  console.error(`Live deployment health failed for ${failures.length} check(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Live deployment health ok. Base=${baseUrl}; AdminBase=${adminBaseUrl}; routes=${publicRoutes.length}`);
