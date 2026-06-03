#!/usr/bin/env node
/* GEJAST beta performance probe.
   Non-destructive live measurement for key beta pages. It reports response time,
   HTML size, asset count, and the heaviest same-origin assets it can discover. */

const baseUrl = process.env.GEJAST_LIVE_BASE_URL || 'https://kalenel.nl';
const timeoutMs = Number(process.env.GEJAST_PERF_TIMEOUT_MS || 20000);
const failOnBudget = process.env.GEJAST_PERF_FAIL_ON_BUDGET === '1';
const maxHtmlBytes = Number(process.env.GEJAST_PERF_MAX_HTML_BYTES || 350000);
const maxRouteMs = Number(process.env.GEJAST_PERF_MAX_ROUTE_MS || 2500);

const routes = [
  '/',
  '/profiles.html',
  '/pikken.html',
  '/pikken_live.html',
  '/paardenrace.html',
  '/paardenrace_live.html',
  '/drinks.html',
  '/drinks_pending.html',
];

function urlFor(pathname) {
  const url = new URL(pathname, baseUrl);
  url.searchParams.set('beta_perf_probe', String(Date.now()));
  return url.toString();
}

async function fetchTimed(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
    const elapsedMs = Math.round(performance.now() - started);
    return { response, elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}

function assetUrls(html, pageUrl) {
  const urls = new Set();
  const patterns = [
    /\ssrc=["']([^"']+)["']/gi,
    /\shref=["']([^"']+)["']/gi,
    /url\(["']?([^"')]+)["']?\)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = String(match[1] || '').trim();
      if (!raw || raw.startsWith('data:') || raw.startsWith('javascript:') || raw.startsWith('#')) continue;
      try {
        const url = new URL(raw, pageUrl);
        if (url.origin === new URL(baseUrl).origin) {
          url.search = '';
          urls.add(url.toString());
        }
      } catch (_) {}
    }
  }
  return [...urls];
}

async function headSize(url) {
  try {
    const { response } = await fetchTimed(url, { method: 'HEAD' });
    const raw = response.headers.get('content-length');
    return raw ? Number(raw) : null;
  } catch (_) {
    return null;
  }
}

function fmtBytes(value) {
  if (!Number.isFinite(value)) return 'unknown';
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value > 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

const failures = [];
const allAssets = new Map();

for (const route of routes) {
  const pageUrl = urlFor(route);
  const { response, elapsedMs } = await fetchTimed(pageUrl);
  const html = await response.text();
  const htmlBytes = Buffer.byteLength(html);
  const assets = assetUrls(html, pageUrl);
  console.log(`${route}: HTTP ${response.status}, ${elapsedMs}ms, html ${fmtBytes(htmlBytes)}, assets ${assets.length}`);
  if (!response.ok) failures.push(`${route} returned HTTP ${response.status}`);
  if (elapsedMs > maxRouteMs) failures.push(`${route} response time ${elapsedMs}ms exceeds ${maxRouteMs}ms`);
  if (htmlBytes > maxHtmlBytes) failures.push(`${route} HTML ${fmtBytes(htmlBytes)} exceeds ${fmtBytes(maxHtmlBytes)}`);
  for (const asset of assets) allAssets.set(asset, null);
}

const sizedAssets = [];
for (const asset of allAssets.keys()) {
  const size = await headSize(asset);
  if (Number.isFinite(size)) sizedAssets.push({ asset, size });
}

sizedAssets.sort((a, b) => b.size - a.size);
console.log('');
console.log('Heaviest same-origin assets discovered:');
for (const item of sizedAssets.slice(0, 15)) {
  const path = new URL(item.asset).pathname;
  console.log(`- ${fmtBytes(item.size)} ${path}`);
}

if (failures.length) {
  console.log('');
  console.log('Performance budget notes:');
  for (const failure of failures) console.log(`- ${failure}`);
  if (failOnBudget) process.exit(1);
}

console.log('');
console.log(`Beta performance probe complete. Routes=${routes.length}; assets-sized=${sizedAssets.length}.`);
