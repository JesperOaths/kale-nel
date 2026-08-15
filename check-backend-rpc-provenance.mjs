#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const manifestPath = 'GEJAST_v792_BACKEND_RPC_PROVENANCE.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const failures = [];

const expected = [
  ['pikken_join_lobby_fast_v687', 'pin_input character varying, player_id_input bigint, player_name_input text, session_token_input uuid', '63615a7a93565475461203eccf137f63'],
  ['pikken_start_game_scoped', 'game_id_input uuid, player_id_input bigint, session_token_input uuid', '993fb4156472aaf6d43fc4dc0984c972'],
  ['pikken_destroy_game_fast_v687', 'game_id_input uuid, player_id_input bigint, session_token_input uuid', '91eb159533802ec9ba4977c982bf4e63'],
  ['join_paardenrace_room_fast_v687', 'pin_input text, player_id_input bigint, player_name_input text, session_token_input uuid', 'e9a6b66f732efa6119a0a47c3fe9d543'],
  ['paardenrace_start_countdown_v687', 'pin_input character varying, player_id_input bigint, session_token_input uuid', '2a28ce008e6125aa266108290231c24e'],
  ['start_paardenrace_room_safe', 'pin_input character varying, player_id_input bigint, session_token_input uuid', '5e4deac18e12d5c44839bf26ee5117a3'],
  ['get_paardenrace_room_state_fast_v687', 'id_input character varying', '8f7f866581a8c67ebb31b5ae1287e732'],
  ['paardenrace_disband_room_v687', 'room_id_input bigint, player_id_input bigint, session_token_input uuid', 'c189392453949aca77ace1baaedb4d70']
];
const expectedNames = expected.map(([name]) => name);

if (manifest.id !== 'GEJAST_v792_BACKEND_RPC_PROVENANCE') failures.push('provenance manifest id drifted');
if (manifest.schema_version !== 2) failures.push('provenance schema must remain version 2');
if (manifest.frontend_version !== 792) failures.push('SQL/provenance-only boundary must not bump frontend version 792');
if (manifest.production_observation?.status !== 'read_only_snapshot_only') failures.push('production observation must remain explicitly read-only and non-authoritative');
if (manifest.production_observation?.production_mutated !== false) failures.push('provenance evidence must state that production was not mutated');

const observed = manifest.production_observation?.functions || [];
if (observed.length !== expected.length) failures.push(`expected ${expected.length} tracked production RPC observations, found ${observed.length}`);
if (new Set(observed.map((item) => item.name)).size !== observed.length) failures.push('production RPC observation names must be unique');
for (const [name, args, md5] of expected) {
  const row = observed.find((item) => item.name === name);
  if (!row) failures.push(`missing tracked production RPC observation: ${name}`);
  else {
    if (row.identity_arguments !== args) failures.push(`${name} identity arguments drifted from the read-only snapshot`);
    if (row.definition_md5 !== md5) failures.push(`${name} definition fingerprint drifted from the recorded read-only snapshot`);
  }
}

const ignoredDirs = new Set(['.git', 'node_modules']);
const sqlFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) sqlFiles.push(full);
  }
}
walk('.');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const definitions = new Map(expectedNames.map((name) => [name, []]));
for (const file of sqlFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const name of expectedNames) {
    const escaped = escapeRegex(name);
    const createPattern = new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\s*\\.\\s*)?[\"']?${escaped}[\"']?\\s*\\(`, 'i');
    if (createPattern.test(source)) definitions.get(name).push(file.split(path.sep).join('/'));
  }
}
for (const files of definitions.values()) files.sort();

const authority = manifest.repository_authority || {};
const authorityRows = authority.functions || [];
if (authorityRows.length !== expected.length) failures.push(`repository authority must map exactly ${expected.length} tracked RPCs`);
if (new Set(authorityRows.map((item) => item.name)).size !== authorityRows.length) failures.push('repository authority RPC names must be unique');
const extraAuthorityNames = authorityRows.map((item) => item.name).filter((name) => !expectedNames.includes(name));
if (extraAuthorityNames.length) failures.push(`repository authority contains untracked RPCs: ${extraAuthorityNames.join(', ')}`);

let presentCount = 0;
for (const name of expectedNames) {
  const actualPaths = definitions.get(name) || [];
  const row = authorityRows.find((item) => item.name === name);
  if (!row) {
    failures.push(`missing repository authority row: ${name}`);
    continue;
  }
  const mappedPaths = Array.isArray(row.definition_paths) ? [...row.definition_paths].sort() : [];
  if (new Set(mappedPaths).size !== mappedPaths.length) failures.push(`${name} definition_paths must not contain duplicates`);
  if (JSON.stringify(mappedPaths) !== JSON.stringify(actualPaths)) {
    failures.push(`${name} SQL source mapping drifted: manifest=[${mappedPaths.join('|')}] actual=[${actualPaths.join('|')}]`);
  }

  if (actualPaths.length) {
    presentCount += 1;
    if (row.source_status !== 'checked_in_definitions_present') failures.push(`${name} must mark checked-in definitions present`);
    if (row.production_parity_status !== 'not_proven_against_snapshot') failures.push(`${name} checked-in source must not claim deployed parity without deterministic proof`);
  } else {
    if (row.source_status !== 'missing') failures.push(`${name} must remain explicitly missing while no CREATE FUNCTION source exists`);
    if (row.production_parity_status !== 'not_reconstructible_from_git') failures.push(`${name} missing source must remain non-reconstructible from Git`);
  }
}

const computedStatus = presentCount === 0 ? 'missing' : presentCount === expected.length ? 'checked_in' : 'partial';
if (authority.status !== computedStatus) failures.push(`repository authority status must be ${computedStatus}, found ${authority.status || '(missing)'}`);
if (!/observational evidence/i.test(String(authority.rule || ''))) failures.push('manifest must preserve the observation-versus-source-authority rule');
if (!/same change/i.test(String(manifest.transition_policy?.source_mapping || ''))) failures.push('manifest must force source mapping updates in the same change');
if (!/deterministic comparison/i.test(String(manifest.transition_policy?.production_parity || ''))) failures.push('manifest must prohibit unproven production-parity claims');
if (!/all tracked RPCs/i.test(String(manifest.transition_policy?.complete_authority || ''))) failures.push('complete authority transition must require all tracked RPCs');

if (failures.length) {
  console.error(`Backend RPC provenance regression failed for ${failures.length} item(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Backend RPC provenance PASS: ${presentCount}/${expected.length} tracked RPCs have checked-in definitions; production fingerprints remain observation-only; repository authority=${computedStatus}.`);
