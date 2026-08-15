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

if (manifest.id !== 'GEJAST_v792_BACKEND_RPC_PROVENANCE') failures.push('provenance manifest id drifted');
if (manifest.schema_version !== 1) failures.push('provenance schema must remain version 1');
if (manifest.frontend_version !== 792) failures.push('SQL/provenance-only boundary must not bump frontend version 792');
if (manifest.production_observation?.status !== 'read_only_snapshot_only') failures.push('production observation must remain explicitly read-only and non-authoritative');
if (manifest.production_observation?.production_mutated !== false) failures.push('provenance evidence must state that production was not mutated');

const observed = manifest.production_observation?.functions || [];
if (observed.length !== expected.length) failures.push(`expected ${expected.length} tracked production RPC observations, found ${observed.length}`);
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
const definitions = new Map(expected.map(([name]) => [name, []]));
for (const file of sqlFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [name] of expected) {
    const escaped = escapeRegex(name);
    const createPattern = new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\s*\\.\\s*)?[\"']?${escaped}[\"']?\\s*\\(`, 'i');
    if (createPattern.test(source)) definitions.get(name).push(file.replaceAll('\\\\', '/'));
  }
}

const status = manifest.repository_authority?.status;
const mappedPaths = manifest.repository_authority?.authoritative_sql_paths || [];
const definedNames = [...definitions.entries()].filter(([, files]) => files.length).map(([name]) => name);
if (!['missing', 'checked_in'].includes(status)) failures.push('repository authority status must be missing or checked_in');
if (status === 'missing') {
  if (mappedPaths.length !== 0) failures.push('missing repository authority must not claim authoritative SQL paths');
  if (definedNames.length) failures.push(`tracked backend definitions entered Git without provenance transition: ${definedNames.join(', ')}`);
}
if (status === 'checked_in') {
  if (mappedPaths.length === 0) failures.push('checked_in repository authority requires authoritative SQL paths');
  const absent = expected.map(([name]) => name).filter((name) => definitions.get(name).length === 0);
  if (absent.length) failures.push(`checked_in authority is missing CREATE FUNCTION source for: ${absent.join(', ')}`);
  for (const sourcePath of mappedPaths) {
    if (!fs.existsSync(sourcePath)) failures.push(`authoritative SQL path does not exist: ${sourcePath}`);
  }
}

if (!/observational evidence/i.test(String(manifest.repository_authority?.rule || ''))) failures.push('manifest must preserve the observation-versus-source-authority rule');
if (!/same change/i.test(String(manifest.transition_policy?.missing_to_checked_in || ''))) failures.push('manifest must force provenance transition in the same change as new authority');

if (failures.length) {
  console.error(`Backend RPC provenance regression failed for ${failures.length} item(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Backend RPC provenance PASS: ${expected.length} production fingerprints remain observation-only; repository authority=${status}.`);
