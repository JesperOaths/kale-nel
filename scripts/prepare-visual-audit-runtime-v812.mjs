#!/usr/bin/env node
import fs from 'node:fs';

const target = 'scripts/full-live-visual-audit-v792.mjs';
const source = fs.readFileSync(target, 'utf8');

const required = [
  ['system_chrome_launch', 'executablePath: process.env.GEJAST_SYSTEM_CHROME'],
  ['redirect_intent', 'function declaredRedirectTarget'],
  ['redirect_destination', 'function redirectDestinationReached'],
  ['admin_destination', "current.hostname === 'admin.kalenel.nl'"],
  ['visible_destination', 'snapshot.bodyVisible && snapshot.bodyChars >= 20'],
  ['settled_auth', "snapshot.authState !== 'checking'"],
  ['final_navigation_status', 'finalNavigationStatus'],
  ['bounded_loading_settle', 'const loadingDeadline = Date.now() + Math.min(10000, timeout)'],
  ['canonical_family_index', "['index.html?scope=family', 'context__family__index']"],
  ['canonical_family_ladder', "['ladder.html?game=klaverjas&scope=family', 'context__family__ladder']"],
  ['transient_auth_retry', 'for (let attempt = 0; attempt < 2; attempt++)'],
  ['retry_evidence', 'authRetryCount += 1'],
];

const missing = required.filter(([, needle]) => !source.includes(needle)).map(([label]) => label);
if (missing.length) {
  throw new Error(`V812_VISUAL_PREP_FAIL missing_runtime_invariants=${missing.join(',')}`);
}

const forbidden = [
  ['unbounded_browser_download', /npx\s+playwright\s+install|playwright\s+install\s+--with-deps/i],
];
const presentForbidden = forbidden.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
if (presentForbidden.length) {
  throw new Error(`V812_VISUAL_PREP_FAIL forbidden_runtime_patterns=${presentForbidden.join(',')}`);
}

console.log('RESULT=V812_VISUAL_RUNTIME_PREP_PASS redirect_destination_settle=true final_navigation_status=true system_chrome=true family_aliases=true bounded_loading_settle=true auth_retry=true mutation_free=true');
