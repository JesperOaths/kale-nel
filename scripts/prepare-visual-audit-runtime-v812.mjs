#!/usr/bin/env node
import fs from 'node:fs';

const target = 'scripts/full-live-visual-audit-v792.mjs';
let source = fs.readFileSync(target, 'utf8');

function replaceExactly(oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`V812_VISUAL_PREP_FAIL ${label} expected_once actual=${count}`);
  source = source.replace(oldText, newText);
}

replaceExactly(
  "const browser = await chromium.launch({ headless: true });",
  "const browser = await chromium.launch({ headless: true, executablePath: process.env.GEJAST_SYSTEM_CHROME });",
  'system_chrome_launch',
);

replaceExactly(
  "const authSettleTimeout = degradedFixtures ? Math.min(timeout, 1500) : Math.min(timeout, 12000);",
  "const authSettleTimeout = degradedFixtures ? Math.min(timeout, 1500) : Math.min(timeout, 24000);",
  'authenticated_auth_settle_budget',
);

const oldWait = `async function waitForAuthGateToSettle(page, route, kind) {
  const expected = kind === 'context' || trackedRouteUsesAuthGate(route);
  if (!expected) return { expected: false, settled: true, state: '', waited_ms: 0 };

  const started = Date.now();
  const deadline = started + authSettleTimeout;
  let lastState = '';
  while (Date.now() < deadline) {
    let authState = '';
    try { authState = await page.evaluate(() => document.documentElement.getAttribute('data-gejast-auth-state') || ''); }
    catch (_) {}
    if (authState) lastState = authState;

    let currentPath = '';
    try { currentPath = new URL(page.url()).pathname; } catch (_) {}
    if (authState && authState !== 'checking') {
      return { expected: true, settled: true, state: authState, waited_ms: Date.now() - started };
    }
    if (currentPath === '/login.html' && authState !== 'checking') {
      return { expected: true, settled: true, state: authState, waited_ms: Date.now() - started };
    }
    await page.waitForTimeout(200);
  }
  return { expected: true, settled: false, state: lastState, waited_ms: Date.now() - started };
}`;

const newWait = `function declaredRedirectTarget(route) {
  const repoPath = String(route || '').split('?')[0].replace(/^\\/+/, '');
  if (!repoPath || !fs.existsSync(repoPath)) return null;
  try {
    const sourceText = fs.readFileSync(repoPath, 'utf8');
    const match = sourceText.match(/(?:window\\.)?location\\.replace\\(\\s*(['\"])([^'\"]+)\\1\\s*\\)/i);
    return match ? new URL(match[2], routeUrl(route)) : null;
  } catch (_) { return null; }
}

function redirectDestinationReached(target, current) {
  if (!target) return true;
  if (current.href === target.href) return true;
  return target.hostname === 'kalenel.nl'
    && current.hostname === 'admin.kalenel.nl'
    && target.pathname === current.pathname
    && target.search === current.search;
}

async function waitForAuthGateToSettle(page, route, kind) {
  const redirectTarget = declaredRedirectTarget(route);
  let expected = kind === 'context' || trackedRouteUsesAuthGate(route) || !!redirectTarget;
  if (!expected) return { expected: false, settled: true, state: '', waited_ms: 0 };

  const started = Date.now();
  const deadline = started + authSettleTimeout;
  let lastState = '';
  while (Date.now() < deadline) {
    let snapshot = { authState: '', pending: false, gatePresent: false, bodyVisible: false, bodyChars: 0 };
    try {
      snapshot = await page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        return {
          authState: root.getAttribute('data-gejast-auth-state') || '',
          pending: root.classList.contains('gejast-auth-pending'),
          gatePresent: !!document.querySelector('style[data-gejast-auth-gate]'),
          bodyVisible: !!body && getComputedStyle(body).visibility !== 'hidden',
          bodyChars: body ? (body.innerText || '').trim().length : 0,
        };
      });
    } catch (_) {}
    if (snapshot.authState) lastState = snapshot.authState;
    if (snapshot.authState || snapshot.pending || snapshot.gatePresent) expected = true;

    let current = null;
    try { current = new URL(page.url()); } catch (_) {}
    if (!current || !redirectDestinationReached(redirectTarget, current)) {
      await page.waitForTimeout(200);
      continue;
    }

    if (current.hostname === 'admin.kalenel.nl' && snapshot.bodyVisible && snapshot.bodyChars >= 20) {
      return { expected: true, settled: true, state: 'outer-admin', waited_ms: Date.now() - started };
    }
    if (current.pathname === '/login.html' && snapshot.authState !== 'checking' && snapshot.bodyVisible) {
      return { expected: true, settled: true, state: snapshot.authState || 'login', waited_ms: Date.now() - started };
    }

    const destinationGatePresent = snapshot.authState || snapshot.pending || snapshot.gatePresent;
    if (!destinationGatePresent && snapshot.bodyVisible && snapshot.bodyChars >= 20) {
      return { expected, settled: true, state: 'public-destination', waited_ms: Date.now() - started };
    }
    if (destinationGatePresent && !snapshot.pending && snapshot.authState && snapshot.authState !== 'checking' && snapshot.bodyVisible && snapshot.bodyChars >= 20) {
      return { expected: true, settled: true, state: snapshot.authState, waited_ms: Date.now() - started };
    }
    await page.waitForTimeout(200);
  }
  return { expected: true, settled: false, state: lastState, waited_ms: Date.now() - started };
}`;

replaceExactly(oldWait, newWait, 'redirect_and_auth_settle');

replaceExactly(
  "  let response = null;\n  let navigationError = '';",
  `  let response = null;
  let finalNavigationStatus = 0;
  page.on('response', (res) => {
    try {
      const request = res.request();
      if (request.isNavigationRequest() && res.frame() === page.mainFrame()) finalNavigationStatus = res.status();
    } catch (_) {}
  });
  let navigationError = '';`,
  'final_navigation_status_listener',
);

replaceExactly(
  "    await page.waitForTimeout(settleMs);",
  `    await page.waitForTimeout(settleMs);
    const loadingDeadline = Date.now() + Math.min(10000, timeout);
    while (Date.now() < loadingDeadline) {
      const visibleLoading = await page.evaluate(() => ((document.body?.innerText || '').match(/Laden(?:…|\\.\\.\\.)/gi) || []).length).catch(() => 0);
      if (!visibleLoading) break;
      await page.waitForTimeout(500);
    }`,
  'bounded_loading_settle',
);

replaceExactly(
  "  const status = response?.status() || 0;",
  "  const status = finalNavigationStatus || response?.status() || 0;",
  'final_navigation_status_use',
);

replaceExactly(
  `function contextualFamilyRoutes() {
  return [
    ['familie/index.html', 'context__family__index'],
    ['familie/ladder.html', 'context__family__ladder'],
    ['familie/leaderboard.html', 'context__family__leaderboard'],
    ['familie/profiles.html', 'context__family__profiles'],
    [\`familie/player.html?player=\${encodeURIComponent(familyName)}&scope=family\`, 'context__family__player'],
    ['familie/boerenbridge.html', 'context__family__boerenbridge'],
    ['familie/scorer.html', 'context__family__scorer'],
  ];
}`,
  `function contextualFamilyRoutes() {
  return [
    ['index.html?scope=family', 'context__family__index'],
    ['ladder.html?game=klaverjas&scope=family', 'context__family__ladder'],
    ['leaderboard.html?scope=family', 'context__family__leaderboard'],
    ['profiles.html?scope=family', 'context__family__profiles'],
    [\`player.html?player=\${encodeURIComponent(familyName)}&scope=family\`, 'context__family__player'],
    ['boerenbridge.html?scope=family', 'context__family__boerenbridge'],
    ['scorer.html?scope=family', 'context__family__scorer'],
  ];
}`,
  'canonical_family_context_routes',
);

fs.writeFileSync(target, source);
console.log('RESULT=V812_VISUAL_RUNTIME_PREP_PASS redirect_destination_settle=true final_navigation_status=true system_chrome=true family_aliases=true bounded_loading_settle=true');
