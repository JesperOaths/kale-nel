#!/usr/bin/env node
/* GEJAST beta read-only surface checker.
   Fetches important beta routes and looks for obvious deployment/runtime failure text.
   It does not log in, submit forms, create records, or mutate live data. */

import { fileURLToPath } from 'node:url';

const baseUrl = process.env.GEJAST_LIVE_BASE_URL || 'https://kalenel.nl';
const adminBaseUrl = process.env.GEJAST_ADMIN_BASE_URL || 'https://admin.kalenel.nl';
const timeoutMs = Number(process.env.GEJAST_BETA_SURFACE_TIMEOUT_MS || 15000);

const routeGroups = {
  account: ['/login.html', '/request.html', '/activate.html', '/profiles.html', '/my_profile.html'],
  games: [
    '/pikken.html',
    '/pikken_live.html',
    '/pikken_spectator.html',
    '/paardenrace.html',
    '/paardenrace_live.html',
    '/paardenrace_spectator.html',
    '/scorer.html',
    '/klaverjas_live.html',
    '/beerpong.html',
    '/boerenbridge.html',
    '/boerenbridge_live.html',
    '/rad.html',
  ],
  drinks: ['/drinks.html', '/drinks_add.html', '/drinks_pending.html', '/drinks_history.html', '/drinks_speed.html', '/drinks_stats.html'],
  despimarkt: ['/despimarkt.html', '/beurs.html', '/despimarkt_market.html', '/despimarkt_wallet.html', '/despimarkt_stats.html'],
  family: ['/familie.html', '/familie/index.html', '/familie/login.html', '/familie/profiles.html', '/familie/scorer.html', '/familie/leaderboard.html'],
  retiredPublic: ['/push_beta_test.html'],
  adminReadOnly: [
    '/admin.html',
    '/admin_system_health.html',
    '/admin_release_readiness.html',
    '/admin_runtime_verification.html',
    '/admin_deployment_verification.html',
    '/admin_drinks_push_health.html',
    '/admin_despimarkt_health.html',
    '/admin_analytics.html',
  ],
};

export const expectedProtected401Routes = new Set(routeGroups.adminReadOnly);
export const expectedRetired404Routes = new Set(routeGroups.retiredPublic);

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

function urlFor(pathname) {
  const url = new URL(pathname, expectedProtected401Routes.has(pathname) ? adminBaseUrl : baseUrl);
  url.searchParams.set('beta_readonly_smoke', String(Date.now()));
  return url.toString();
}

const failures = [];
let checked = 0;

export function classifyRouteResponse(route, responseStatus, bodyText = '') {
  const isExpectedProtected = expectedProtected401Routes.has(route);
  const isExpectedRetired = expectedRetired404Routes.has(route);
  const bad = badTextPatterns.find((pattern) => pattern.test(bodyText));

  if (isExpectedProtected) {
    if (responseStatus === 401) {
      return { ok: !bad, expected401: true, expected404: false, bad };
    }
    return {
      ok: false,
      expected401: true,
      expected404: false,
      bad,
      failure: `${route} protected route returned HTTP ${responseStatus}; expected HTTP 401`,
    };
  }

  if (isExpectedRetired) {
    return {
      ok: responseStatus === 404,
      expected401: false,
      expected404: true,
      bad: undefined,
      failure: responseStatus === 404 ? undefined : `${route} retired public route returned HTTP ${responseStatus}; expected HTTP 404`,
    };
  }

  const okStatus = responseStatus >= 200 && responseStatus < 400;
  return {
    ok: okStatus && !bad,
    expected401: false,
    expected404: false,
    bad,
    failure: !okStatus ? `${route} returned HTTP ${responseStatus}` : undefined,
  };
}

export async function runBetaReadonlySurfaceCheck() {
for (const [group, routes] of Object.entries(routeGroups)) {
  console.log(`${group}:`);
  for (const route of routes) {
    checked += 1;
    try {
      const response = await fetchWithTimeout(urlFor(route));
      const text = await response.text();
      const result = classifyRouteResponse(route, response.status, text);
      console.log(`- ${route} HTTP ${response.status}${result.expected401 ? ' expected-protected-401' : ''}${result.expected404 ? ' expected-retired-404' : ''}${result.bad ? ` bad-text:${result.bad}` : ''}`);
      if (result.failure) failures.push(result.failure);
      if (result.bad) failures.push(`${route} contains obvious failure text matching ${result.bad}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`- ${route} failed ${message}`);
      failures.push(`${route} failed: ${message}`);
    }
  }
}

if (failures.length) {
  console.error(`Beta read-only surface check failed for ${failures.length} item(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Beta read-only surfaces ok. Routes checked=${checked}. Base=${baseUrl}. AdminBase=${adminBaseUrl}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runBetaReadonlySurfaceCheck();
}
