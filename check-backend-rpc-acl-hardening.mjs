#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const contractPath = 'GEJAST_v792i_BACKEND_RPC_ACL_CONTRACT.json';
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const sqlPath = contract.remediation?.sql_path;
const sql = fs.readFileSync(sqlPath, 'utf8');
const failures = [];

if (contract.id !== 'GEJAST_v792i_BACKEND_RPC_ACL_CONTRACT') failures.push('ACL contract id drifted');
if (contract.schema_version !== 1) failures.push('ACL contract schema must remain version 1');
if (contract.frontend_version !== 792 || contract.sql_suffix !== 'v792i') failures.push('v792i must remain SQL-only on frontend version 792');
if (contract.deployment_status !== 'repository_patch_ready_not_applied') failures.push('ACL contract must not claim production deployment before explicit authorization/application');
if (contract.production_observation?.production_mutated !== false) failures.push('ACL evidence must state that production was not mutated');
if (contract.production_observation?.security_definer_private_helper_count !== 118) failures.push('read-only helper snapshot count must remain 118 until deliberately refreshed');
if (contract.production_observation?.anon_execute_count !== 118 || contract.production_observation?.authenticated_execute_count !== 118) failures.push('read-only browser-role exposure counts must remain 118 until deliberately refreshed');
if (contract.remediation?.gameplay_dml_allowed !== false) failures.push('ACL repair must prohibit gameplay DML');
if (contract.remediation?.function_body_replacement_allowed !== false) failures.push('ACL repair must prohibit function-body replacement');
if (contract.remediation?.requires_explicit_production_sql_authorization !== true) failures.push('ACL repair must preserve explicit production SQL authorization boundary');

const revoked = contract.remediation?.revoke_execute_from || [];
for (const role of ['PUBLIC', 'anon', 'authenticated']) {
  if (!revoked.includes(role)) failures.push(`ACL contract must revoke ${role}`);
}
if ((contract.remediation?.privileges_added || []).length !== 0) failures.push('ACL repair must not add privileges');

const strippedSql = sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*$/gm, '');
if (!/\bbegin\s*;/i.test(strippedSql) || !/\bcommit\s*;/i.test(strippedSql)) failures.push('ACL repair must remain transactional');
if (!/p\.prosecdef/i.test(strippedSql)) failures.push('ACL repair must stay scoped to SECURITY DEFINER helpers');
if (!/\\_pikken\\_%/i.test(strippedSql) || !/\\_paardenrace\\_%/i.test(strippedSql)) failures.push('ACL repair must cover both private helper prefixes');
for (const role of ['public', 'anon', 'authenticated']) {
  const revoke = new RegExp(`revoke\\s+execute\\s+on\\s+function[\\s\\S]*?from\\s+${role}`, 'i');
  if (!revoke.test(strippedSql)) failures.push(`ACL SQL must revoke EXECUTE from ${role}`);
}
if (/grant\s+execute[\s\S]*?\bto\s+(?:public|anon|authenticated)\b/i.test(strippedSql)) failures.push('ACL SQL must never grant helper EXECUTE to a browser role');
if (/\bcreate\s+(?:or\s+replace\s+)?function\b/i.test(strippedSql)) failures.push('ACL repair must not replace function bodies');
if (/(?:^|;)\s*(?:insert|update|delete|truncate)\b/im.test(strippedSql)) failures.push('ACL repair must not contain gameplay DML statements');
if (!/has_function_privilege\s*\(\s*'anon'/i.test(strippedSql) || !/has_function_privilege\s*\(\s*'authenticated'/i.test(strippedSql)) failures.push('ACL SQL must fail closed by verifying browser roles lost EXECUTE');
if (!/raise\s+exception/i.test(strippedSql)) failures.push('ACL SQL must abort if post-revoke verification fails');

const riskyExamples = contract.confirmed_unguarded_examples || [];
const expectedExamples = [
  '_pikken_destroy_game_cascade',
  '_pikken_set_game_host',
  '_pikken_finish_empty_game',
  '_paardenrace_insert_verified_drink_event',
  '_paardenrace_seed_player_row',
  '_paardenrace_cleanup_empty_rooms'
];
for (const name of expectedExamples) {
  if (!riskyExamples.some((item) => item.name === name && /^[a-f0-9]{32}$/.test(String(item.definition_md5 || '')))) failures.push(`missing fingerprinted unsafe example: ${name}`);
}

const ignoredDirs = new Set(['.git', 'node_modules']);
const clientFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && /\.(?:js|html)$/i.test(entry.name)) clientFiles.push(full);
  }
}
walk('.');

const privateRpcCall = /\.rpc\s*\(\s*['"]_(?:pikken|paardenrace)_/i;
for (const file of clientFiles) {
  const source = fs.readFileSync(file, 'utf8');
  if (privateRpcCall.test(source)) failures.push(`shipped client directly calls a private gameplay helper: ${file.replaceAll('\\', '/')}`);
}

if (failures.length) {
  console.error(`Backend RPC ACL hardening regression failed for ${failures.length} item(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Backend RPC ACL hardening PASS: v792i remains privilege-only, fail-closed, and private helpers stay outside the shipped client contract.');
