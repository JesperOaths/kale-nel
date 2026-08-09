#!/usr/bin/env node
import fs from 'node:fs';

const config = fs.readFileSync('gejast-config.js', 'utf8');
const baseUrl = config.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
const key = config.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
if (!baseUrl || !key) throw new Error('Could not resolve public Supabase config.');

const expectPost = process.env.GEJAST_SCOPED_LIVE_EXPECT_POST === '1';
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

async function rpc(name, body) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}
  return { status: response.status, text, data };
}

function isSignatureMissing(result) {
  return result.status === 404 && /PGRST202|could not find the function|schema cache/i.test(result.text || '');
}

// This helper is a STABLE SELECT-only function. Probe only status and row count;
// do not print participant/live-row content.
for (const scope of ['friends', 'family']) {
  const helper = await rpc('_gejast_live_surface_rows_v352', {
    site_scope_input: scope,
    include_finished: false,
  });
  if (helper.status !== 200 || !Array.isArray(helper.data)) {
    throw new Error(`Scoped live row helper unavailable for ${scope}: HTTP ${helper.status}`);
  }
  console.log(`SCOPED_ROW_HELPER ${scope} HTTP=200 rows=${helper.data.length}`);
}

const missingId = '__v770a_missing_probe__';
const summary = await rpc('get_live_match_summary_public_scoped', {
  game_type_input: 'klaverjas',
  match_ref_input: missingId,
  client_match_id_input: missingId,
  site_scope_input: 'friends',
});

const homepageFriends = await rpc('get_homepage_live_state_public_scoped', {
  session_token: null,
  site_scope_input: 'friends',
});
const homepageFamily = await rpc('get_homepage_live_state_public_scoped', {
  session_token: null,
  site_scope_input: 'family',
});

if (!expectPost) {
  if (!isSignatureMissing(summary)) {
    throw new Error(`Expected pre-apply scoped summary signature drift, got HTTP ${summary.status}`);
  }
  if (!isSignatureMissing(homepageFriends) || !isSignatureMissing(homepageFamily)) {
    throw new Error(`Expected pre-apply scoped homepage signature drift, got friends=${homepageFriends.status} family=${homepageFamily.status}`);
  }

  const oldSummaryStub = await rpc('get_live_match_summary_public_scoped', { site_scope_input: 'friends' });
  const oldHomepageStub = await rpc('get_homepage_live_state_public_scoped', { site_scope_input: 'friends' });
  if (oldSummaryStub.status !== 200 || oldHomepageStub.status !== 200) {
    throw new Error(`Expected deployed v690 one-argument stubs, got summary=${oldSummaryStub.status} homepage=${oldHomepageStub.status}`);
  }

  console.log('v770a PRE-APPLY PASS: current frontend signatures are missing while v690 one-argument stubs remain deployed.');
  process.exit(0);
}

if (summary.status !== 200 || !summary.data || summary.data.found !== false || summary.data.site_scope !== 'friends') {
  throw new Error(`Post-apply scoped summary contract invalid: HTTP ${summary.status}`);
}

for (const [scope, result] of [['friends', homepageFriends], ['family', homepageFamily]]) {
  if (result.status !== 200 || !result.data || result.data.ok !== true || result.data.site_scope !== scope) {
    throw new Error(`Post-apply scoped homepage contract invalid for ${scope}: HTTP ${result.status}`);
  }
  const entries = result.data.entries;
  if (!entries || typeof entries !== 'object' || !entries.klaverjas || !entries.boerenbridge) {
    throw new Error(`Post-apply scoped homepage entries missing for ${scope}`);
  }
  if (result.data.viewer_name !== null) {
    throw new Error(`Null-session scoped homepage probe unexpectedly resolved a viewer for ${scope}`);
  }
}

console.log('v770a POST-APPLY PASS: current frontend signatures resolve with scope-preserving read contracts.');
