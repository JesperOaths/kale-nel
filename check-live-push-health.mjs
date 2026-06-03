#!/usr/bin/env node
/* GEJAST live push/drinks health checker.
   Uses only public repo metadata and the site's publishable Supabase config. */
import fs from 'node:fs';

const repo = process.env.GEJAST_GITHUB_REPO || 'JesperOaths/kale-nel';
const workflow = process.env.GEJAST_PUSH_WORKFLOW || 'web-push-dispatcher.yml';
const maxRunAgeHours = Number(process.env.GEJAST_PUSH_MAX_RUN_AGE_HOURS || 12);
const timeoutMs = Number(process.env.GEJAST_PUSH_HEALTH_TIMEOUT_MS || 15000);

function readConfig() {
  const text = fs.readFileSync('gejast-config.js', 'utf8');
  const url = text.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
  const key = text.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
  if (!url || !key) throw new Error('Could not read public Supabase config from gejast-config.js');
  return { url, key };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(config, name, payload) {
  const { response, data } = await fetchJson(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify(payload || {}),
  });
  return { name, status: response.status, ok: response.ok, data };
}

const failures = [];

const runsUrl = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?per_page=5`;
const { response: runsResponse, data: runsData } = await fetchJson(runsUrl);
if (!runsResponse.ok) {
  failures.push(`GitHub workflow runs returned HTTP ${runsResponse.status}`);
} else {
  const runs = Array.isArray(runsData?.workflow_runs) ? runsData.workflow_runs : [];
  const latest = runs[0];
  if (!latest) {
    failures.push('GitHub workflow has no visible runs');
  } else {
    const ageHours = (Date.now() - Date.parse(latest.updated_at || latest.created_at || 0)) / 36e5;
    if (latest.status !== 'completed' || latest.conclusion !== 'success') {
      failures.push(`Latest push workflow run is ${latest.status}/${latest.conclusion || 'none'}`);
    }
    if (Number.isFinite(ageHours) && ageHours > maxRunAgeHours) {
      failures.push(`Latest push workflow run is older than ${maxRunAgeHours}h`);
    }
    console.log(`Push workflow latest: #${latest.run_number} ${latest.status}/${latest.conclusion} ${latest.html_url}`);
  }
}

const config = readConfig();
const probes = [
  ['get_drinks_pending_verification_summary_v661', { limit_input: 5, site_scope_input: 'friends' }, true],
  ['get_drinks_push_eligibility_summary_v661', { limit_input: 5, site_scope_input: 'friends' }, true],
  ['queue_nearby_verification_pushes_v3', { request_kind_input: 'drink', request_id_input: -1, site_scope_input: 'friends', cooldown_seconds_input: 600 }, true],
  ['queue_test_web_push', { session_token_input: 'invalid-session-for-public-probe', site_scope_input: 'friends' }, false],
];

for (const [name, payload, shouldBeOk] of probes) {
  const result = await rpc(config, name, payload);
  const data = result.data || {};
  const code = data.reason || data.code || data.error || '';
  console.log(`${name}: HTTP ${result.status}${code ? ` ${code}` : ''}`);
  if (shouldBeOk && !result.ok) failures.push(`${name} returned HTTP ${result.status}`);
  if (!shouldBeOk && result.ok) failures.push(`${name} accepted invalid public probe session`);
  if (name === 'queue_test_web_push' && !/MISSING_SESSION/i.test(String(data.message || code))) {
    failures.push('queue_test_web_push did not reject invalid session with MISSING_SESSION');
  }
}

if (failures.length) {
  console.error(`Live push health failed for ${failures.length} check(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Live push health ok. Repo=${repo}`);
