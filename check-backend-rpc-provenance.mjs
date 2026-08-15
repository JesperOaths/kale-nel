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

function readBalancedParentheses(source, openIndex) {
  let depth = 0;
  let quote = null;
  let dollarTag = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (dollarTag) {
      if (source.startsWith(dollarTag, i)) {
        i += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }

    if (quote) {
      if (char === quote) {
        if (next === quote && quote === "'") i += 1;
        else quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === '$') {
      const tag = source.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        dollarTag = tag;
        i += tag.length - 1;
        continue;
      }
    }

    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

function splitTopLevelArguments(source) {
  if (!String(source || '').trim()) return [];
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      if (char === quote) {
        if (next === quote && quote === "'") i += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function stripTopLevelDefault(source) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      if (char === quote) {
        if (next === quote && quote === "'") i += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && char === '=') return source.slice(0, i);
    else if (depth === 0 && /[A-Za-z_]/.test(char)) {
      const word = source.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] || '';
      if (word.toLowerCase() === 'default') return source.slice(0, i);
      i += Math.max(0, word.length - 1);
    }
  }
  return source;
}

function normalizeIdentityArguments(source) {
  return splitTopLevelArguments(source)
    .map((argument) => stripTopLevelDefault(argument)
      .replace(/--[^\n\r]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/"([^"]+)"/g, '$1')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase())
    .filter(Boolean)
    .join(', ');
}

function functionArgumentBlocks(sql, rpc) {
  const schema = escapeRegExp(rpc.schema);
  const name = escapeRegExp(rpc.name);
  const qualified = `(?:["']?${schema}["']?\\s*\\.\\s*)?["']?${name}["']?`;
  const re = new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${qualified}\\s*\\(`, 'gi');
  const blocks = [];
  for (const match of sql.matchAll(re)) {
    const openIndex = match.index + match[0].lastIndexOf('(');
    const block = readBalancedParentheses(sql, openIndex);
    if (block !== null) blocks.push(block);
  }
  return blocks;
}

function definesRpc(sql, rpc) {
  const expected = normalizeIdentityArguments(rpc.identity_arguments);
  return functionArgumentBlocks(sql, rpc).some((args) => normalizeIdentityArguments(args) === expected);
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
    if (matchingSql.length) failures.push(`${label} exact deployed identity is now defined in checked-in SQL (${matchingSql.join(', ')}); transition repository_authority to checked_in and name the authoritative path`);
  }

  if (authority.status === 'checked_in') {
    const authorityPath = String(authority.path || '').replaceAll('\\', '/');
    if (!authorityPath.toLowerCase().endsWith('.sql')) failures.push(`${label} checked-in authority path must point to a .sql file`);
    else if (!sqlByPath.has(authorityPath)) failures.push(`${label} checked-in authority path does not exist: ${authorityPath}`);
    else if (!definesRpc(sqlByPath.get(authorityPath), rpc)) failures.push(`${label} authority path does not define the exact deployed identity: ${authorityPath}`);
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
