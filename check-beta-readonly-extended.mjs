#!/usr/bin/env node
/* Extended beta read-only checker.
   Verifies stats, ladder, scope, and admin observability pages without login or mutation. */

const baseUrl = process.env.GEJAST_LIVE_BASE_URL || 'https://kalenel.nl';
const adminBaseUrl = process.env.GEJAST_ADMIN_BASE_URL || 'https://admin.kalenel.nl';
const timeoutMs = Number(process.env.GEJAST_BETA_SURFACE_TIMEOUT_MS || 15000);

const checks = [
  { area: 'stats', path: '/pikken_stats.html', text: /Pikken|stats|leaderboard|rang/i },
  { area: 'stats', path: '/paardenrace_stats.html', text: /Paardenrace|stats|leaderboard|races/i },
  { area: 'stats', path: '/drinks_stats.html', text: /drinks|stats|snelheid|bakken/i },
  { area: 'stats', path: '/drinks_speed_stats.html', text: /speed|snelheid|stats|drinks/i },
  { area: 'stats', path: '/rad_stats.html', text: /Rad|stats|leaderboard|spel/i },
  { area: 'stats', path: '/despimarkt_stats.html', text: /Despimarkt|Beurs|stats|market/i },
  { area: 'ladder', path: '/leaderboard.html', text: /leaderboard|ranglijst|spelers/i },
  { area: 'ladder', path: '/ladder.html', text: /ladder|ranglijst|leaderboard/i },
  { area: 'ladder', path: '/pikken_ladder.html', text: /Pikken|ladder|leaderboard/i },
  { area: 'ladder', path: '/paardenrace_ladder.html', text: /Paardenrace|ladder|leaderboard/i },
  { area: 'scope', path: '/familie.html', text: /familie|family/i },
  { area: 'scope', path: '/familie/index.html', text: /familie|family/i },
  { area: 'scope', path: '/familie/leaderboard.html', text: /leaderboard|ranglijst|familie/i },
  { area: 'scope', path: '/profiles.html?scope=friends', text: /profiel|profiles|spelers/i },
  { area: 'scope', path: '/profiles.html?scope=family', text: /profiel|profiles|spelers/i },
  { area: 'adminObservability', path: '/admin_system_health.html', protected: true },
  { area: 'adminObservability', path: '/admin_ops_observability.html', protected: true },
  { area: 'adminObservability', path: '/admin_analytics.html', protected: true },
  { area: 'adminObservability', path: '/admin_deployment_verification.html', protected: true },
  { area: 'adminObservability', path: '/admin_runtime_verification.html', protected: true },
];

const badTextPatterns = [
  /schema cache/i,
  /Could not find the function/i,
  /PGRST\d+/i,
  /TypeError:\s/i,
  /ReferenceError:\s/i,
  /SyntaxError:\s/i,
  /404\s*Not Found/i,
];

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function urlFor(check) {
  const url = new URL(check.path, check.protected ? adminBaseUrl : baseUrl);
  url.searchParams.set('beta_extended_smoke', String(Date.now()));
  return url.toString();
}

const failures = [];
const counts = new Map();

for (const check of checks) {
  const url = urlFor(check);
  try {
    const response = await fetchWithTimeout(url);
    const text = await response.text();
    const bad = badTextPatterns.find((pattern) => pattern.test(text));
    counts.set(check.area, (counts.get(check.area) || 0) + 1);

    if (check.protected) {
      console.log(`${check.area}: ${check.path} HTTP ${response.status}${response.status === 401 ? ' expected-protected-401' : ''}${bad ? ` bad-text:${bad}` : ''}`);
      if (response.status !== 401) failures.push(`${check.path} protected admin route returned HTTP ${response.status}; expected HTTP 401`);
      if (bad) failures.push(`${check.path} protected response contains obvious failure text matching ${bad}`);
      continue;
    }

    const hasExpectedText = check.text.test(text);
    const okStatus = response.status >= 200 && response.status < 400;
    console.log(`${check.area}: ${check.path} HTTP ${response.status}${hasExpectedText ? '' : ' missing-expected-text'}${bad ? ` bad-text:${bad}` : ''}`);
    if (!okStatus) failures.push(`${check.path} returned HTTP ${response.status}`);
    if (!hasExpectedText) failures.push(`${check.path} did not contain expected ${check.area} text`);
    if (bad) failures.push(`${check.path} contains obvious failure text matching ${bad}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${check.area}: ${check.path} failed ${message}`);
    failures.push(`${check.path} failed: ${message}`);
  }
}

if (failures.length) {
  console.error(`Extended beta read-only check failed for ${failures.length} item(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Extended beta read-only surfaces ok. ${Array.from(counts.entries()).map(([area, count]) => `${area}=${count}`).join(', ')}. Base=${baseUrl}. AdminBase=${adminBaseUrl}`);
