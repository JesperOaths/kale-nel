#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const manifestPath = 'backend-rpc-provenance.json';
const liveSmokePath = 'check-live-game-flows.mjs';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const liveSmoke = fs.readFileSync(liveSmokePath, 'utf8');
const failures = [];

const ignoredDirectories = new Set(['.git', 'node_modules', '.wrangler', 'dist', 'coverage']);
const sqlFiles = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relative = path.relative('.', path.join(directory, entry.name)).replaceAll('\\', '/');
    if (entry.isDirectory()) walk(relative);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) sqlFiles.push(relative);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function definesRpc(sql, rpc) {
  const schema = escapeRegExp(rpc.schema);
  const name = escapeRegExp(rpc.name);
  const qualified = `(?:["']?${schema}["']?\\s*\\.\\s*)?["']?${name}["']?`;
  return new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${qualified}\\s*\\(`, 'i').test(sql);
}

function canonicalLiveSmokeRpcNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/\brpc\(\s*['"]([a-z][a-z0-9_]+)['"]/gi)) names.add(match[1]);
  for (const match of source.matchAll(/^\s*\[\s*['"]([a-z][a-z0-9_]+)['"]\s*,\s*\{/gim)) names.add(match[1]);
  return [...names].sort();
}

walk('.');
const sqlByPath = new Map(sqlFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]));

if (manifest.schema_version !== 1) failures.push('backend RPC provenance schema_version must remain 1');
if (!String(manifest.purpose || '').trim()) failures.push('backend RPC provenance manifest must explain its purpose');
if (!Array.isArray(manifest.rpcs) || manifest.rpcs.length === 0) failures.push('backend RPC provenance manifest must list at least one RPC');

const seen = new Set();
const manifestRpcNames = new Set();
for (const rpc of manifest.rpcs || []) {
  const label = `${rpc?.schema || '(missing schema)'}.${rpc?.name || '(missing name)'}(${rpc?.identity_arguments || ''})`;
  const key = `${rpc?.schema}\u0000${rpc?.name}\u0000${rpc?.identity_arguments}`;
  if (seen.has(key)) failures.push(`duplicate backend RPC provenance entry: ${label}`);
  seen.add(key);

  if (!rpc?.schema || !rpc?.name || typeof rpc?.identity_arguments !== 'string') {
    failures.push(`${label} must declare schema, name and identity_arguments`);
    continue;
  }
  manifestRpcNames.add(rpc.name);

  if (rpc?.observed_production?.status !== 'observed') failures.push(`${label} production evidence status must be observed`);
  if (!/^[0-9a-f]{32}$/.test(String(rpc?.observed_production?.definition_md5 || ''))) failures.push(`${label} production definition_md5 must be 32 lowercase hex characters`);

  const authority = rpc?.repository_authority || {};
  if (!['missing', 'checked_in'].includes(authority.status)) failures.push(`${label} repository authority status must be missing or checked_in`);

  const matchingSql = [...sqlByPath.entries()].filter(([, sql]) => definesRpc(sql, rpc)).map(([file]) => file);
  if (authority.status === 'missing') {
    if (authority.path !== null && authority.path !== undefined) failures.push(`${label} missing repository authority must not claim a source path`);
    if (matchingSql.length) failures.push(`${label} is now defined in checked-in SQL (${matchingSql.join(', ')}); transition repository_authority to checked_in and name the authoritative path`);
  }

  if (authority.status === 'checked_in') {
    const authorityPath = String(authority.path || '').replaceAll('\\', '/');
    if (!authorityPath.toLowerCase().endsWith('.sql')) failures.push(`${label} checked-in authority path must point to a .sql file`);
    else if (!sqlByPath.has(authorityPath)) failures.push(`${label} checked-in authority path does not exist: ${authorityPath}`);
    else if (!definesRpc(sqlByPath.get(authorityPath), rpc)) failures.push(`${label} authority path does not define the named RPC: ${authorityPath}`);
  }
}

const smokeRpcNames = canonicalLiveSmokeRpcNames(liveSmoke);
for (const rpcName of smokeRpcNames) {
  if (!manifestRpcNames.has(rpcName)) failures.push(`canonical live-game smoke RPC lacks provenance entry: ${rpcName}`);
}

if (failures.length) {
  console.error(`Backend RPC provenance regression failed for ${failures.length} item(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const missing = (manifest.rpcs || []).filter((rpc) => rpc?.repository_authority?.status === 'missing').length;
console.log(`Backend RPC provenance PASS: ${manifest.rpcs.length} deployed RPC fingerprint(s) tracked; ${smokeRpcNames.length} canonical live-smoke RPC name(s) covered; ${missing} still explicitly lack checked-in SQL authority.`);
