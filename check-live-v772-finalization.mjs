#!/usr/bin/env node

const baseUrl = process.env.GEJAST_LIVE_BASE_URL || 'https://kalenel.nl';
const timeoutMs = Number(process.env.GEJAST_SMOKE_TIMEOUT_MS || 15000);
const waitSeconds = Math.max(0, Number(process.env.GEJAST_DEPLOY_WAIT_SECONDS || 120));
const cacheBuster = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const removed = [
  '/ADMIN_ADMINHTML_BODY_20260801.html',
  '/admin-dev.html',
  '/admin_v60_orig.html',
  '/index_v60_orig.html',
  '/klaverjas_quick_stats_v593.html',
  '/paardenrace_art_export.html',
  '/paardenrace_art_preview.html',
  '/probe.html',
  '/scorer_v60_orig.html',
];
const failures = [];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function urlFor(pathname) {
  const url = new URL(pathname, baseUrl);
  url.searchParams.set('cb', cacheBuster);
  return url.toString();
}
async function fetchManual(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function get(pathname) {
  return fetchManual(urlFor(pathname));
}
async function followToTerminal(pathname, maxRedirects = 5) {
  let url = urlFor(pathname);
  const chain = [];
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetchManual(url);
    const location = response.headers.get('location') || '';
    chain.push({ url, status: response.status, location });
    if (response.status < 300 || response.status >= 400 || !location) return { response, chain };
    url = new URL(location, url).toString();
  }
  throw new Error(`redirect chain exceeded ${maxRedirects} hops`);
}

async function waitForV772() {
  const deadline = Date.now() + waitSeconds * 1000;
  let last = '';
  let lastStatus = 0;
  do {
    try {
      const response = await get('/VERSION');
      lastStatus = response.status;
      last = (await response.text()).trim();
      console.log(`/VERSION HTTP ${response.status}; body=${JSON.stringify(last)}`);
      if (response.ok && last === 'v772') return true;
    } catch (error) {
      console.warn(`/VERSION fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (Date.now() >= deadline) break;
    await sleep(5000);
  } while (true);
  failures.push(`/VERSION expected v772, got HTTP ${lastStatus || '(none)'} body ${JSON.stringify(last || '(empty)')}`);
  return false;
}

await waitForV772();

try {
  const response = await get('/index.html');
  const text = await response.text();
  console.log(`/index.html HTTP ${response.status}; bytes=${text.length}`);
  if (!response.ok) failures.push(`/index.html returned HTTP ${response.status}`);
  if (!text.includes('Snelheidspoging')) failures.push('public homepage missing corrected Snelheidspoging label');
  if (text.includes('Snelheids poging')) failures.push('public homepage still serves old Snelheids poging label');
  if (!text.includes("GEJAST_PAGE_VERSION='v772'")) failures.push('public homepage missing v772 page-version marker');
} catch (error) {
  failures.push(`homepage edge proof failed: ${error instanceof Error ? error.message : String(error)}`);
}

for (const pathname of removed) {
  try {
    const { response, chain } = await followToTerminal(pathname);
    const text = await response.text();
    const chainText = chain.map((hop) => `${hop.status}${hop.location ? `->${hop.location}` : ''}`).join(' | ');
    console.log(`${pathname} chain=${chainText}; terminal=${response.status}; bytes=${text.length}`);
    if (response.status < 400) failures.push(`${pathname} still resolves to publicly served HTTP ${response.status}`);
  } catch (error) {
    failures.push(`${pathname} edge proof failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error(`v772 public edge proof FAILED (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('v772 public edge proof PASS: VERSION=v772, homepage copy/version are current, and all nine removed public artifacts terminate at non-public HTTP status after any perimeter redirect.');
