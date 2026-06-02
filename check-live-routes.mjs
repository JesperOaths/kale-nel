#!/usr/bin/env node
/* GEJAST live route smoke checker for GitHub Pages deployment. */

const baseUrl = process.env.GEJAST_LIVE_BASE_URL || 'https://kalenel.nl';
const expectedVersion = process.env.GEJAST_EXPECTED_VERSION || '';
const timeoutMs = Number(process.env.GEJAST_SMOKE_TIMEOUT_MS || 15000);
const routes = [
  '/',
  '/index.html',
  '/pikken.html',
  '/paardenrace.html',
  '/scorer.html',
  '/beerpong.html',
  '/boerenbridge.html',
  '/despimarkt.html',
  '/beurs.html',
  '/rad.html',
  '/profiles.html',
  '/login.html',
];

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function urlFor(pathname) {
  return new URL(pathname, baseUrl).toString();
}

const failures = [];
const versionResponse = await fetchWithTimeout(urlFor('/VERSION'));
if (!versionResponse.ok) {
  failures.push(`/VERSION returned HTTP ${versionResponse.status}`);
} else {
  const liveVersion = (await versionResponse.text()).trim();
  if (expectedVersion && liveVersion !== expectedVersion) {
    failures.push(`/VERSION expected ${expectedVersion}, got ${liveVersion}`);
  }
  console.log(`Live VERSION: ${liveVersion}`);
}

for (const route of routes) {
  try {
    const response = await fetchWithTimeout(urlFor(route));
    if (!response.ok) failures.push(`${route} returned HTTP ${response.status}`);
    console.log(`${route} HTTP ${response.status}`);
  } catch (error) {
    failures.push(`${route} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error(`Live route smoke failed for ${failures.length} check(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Live route smoke ok. Base=${baseUrl}`);
