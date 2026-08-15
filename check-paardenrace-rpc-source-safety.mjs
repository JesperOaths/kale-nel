#!/usr/bin/env node
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('backend-rpc-provenance.json', 'utf8'));
const applyWorkflow = fs.readFileSync('.github/workflows/apply-repair-sql.yml', 'utf8');
const expected = new Map([
  ['get_paardenrace_stats_fast_v687', 'e00a6cba57167f82bfb03bcea34ddef8'],
  ['update_paardenrace_room_choice_safe', '8348776c3324df2cdec284d38338f444'],
  ['verify_paardenrace_wager_safe', '1aa01d9ed17d1238af35cb9aa66fa232'],
]);
const failures = [];

const reconstructed = (manifest.rpcs || []).filter((rpc) => rpc?.repository_authority?.source_kind === 'read_only_production_reconstruction');
if (reconstructed.length !== expected.size) failures.push(`expected exactly ${expected.size} reconstructed Paardenrace RPCs, found ${reconstructed.length}`);

for (const [name, expectedNormalizedMd5] of expected) {
  const rpc = reconstructed.find((row) => row?.name === name);
  if (!rpc) {
    failures.push(`missing reconstructed provenance entry: ${name}`);
    continue;
  }

  const authority = rpc.repository_authority || {};
  const observed = rpc.observed_production || {};
  const sourcePath = String(authority.path || '').replaceAll('\\', '/');

  if (authority.status !== 'checked_in') failures.push(`${name} reconstruction must be checked_in`);
  if (!sourcePath || !fs.existsSync(sourcePath)) failures.push(`${name} reconstructed source path is missing: ${sourcePath || '(empty)'}`);
  if (/^GEJAST_v7.*\.sql$/i.test(sourcePath)) failures.push(`${name} reconstructed source must stay outside the live repair SQL namespace: ${sourcePath}`);
  if (observed.normalized_definition_md5 !== expectedNormalizedMd5) failures.push(`${name} normalized production fingerprint drifted`);
  if (!/^[0-9a-f]{32}$/.test(String(observed.definition_md5 || ''))) failures.push(`${name} must preserve its raw production pg_get_functiondef fingerprint`);

  if (sourcePath && fs.existsSync(sourcePath)) {
    const sql = fs.readFileSync(sourcePath, 'utf8');
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\bcreate\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\s*\\(`, 'i').test(sql)) {
      failures.push(`${name} reconstructed source path no longer defines the function`);
    }
  }
}

if (!/workflow_dispatch:/.test(applyWorkflow) || !/APPLY_LIVE_REPAIR_SQL/.test(applyWorkflow)) {
  failures.push('manual live repair workflow lost its explicit dispatch/confirmation boundary');
}
if (!/GEJAST_v7\*_\*\.sql/.test(applyWorkflow)) failures.push('manual live repair workflow repair-file namespace guard changed; review reconstructed-source isolation');

if (failures.length) {
  console.error(`Paardenrace reconstructed RPC source safety failed for ${failures.length} item(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Paardenrace reconstructed RPC source safety PASS: 3 production-recovered identities are source-backed, fingerprinted, and isolated from the manual live-repair namespace.');
