#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ADMIN_SOURCE_SCHEMA,
  isPrivateAdminSourcePath,
  readPrivateManifest,
  sha256File
} from './scripts/admin-source-boundary.mjs';

for (const rel of [
  'admin.html',
  'admin_shop_operations.html',
  'admin-session-sync.js',
  'admin-topnav.js',
  'gejast-admin-rpc.js',
  'gejast-push-admin-source.js',
  'drinks_admin.html',
  'familie_admin.html',
  'match_control.html',
  'match_swap.html',
  'vault.html',
  'boerenbridge_vault.html',
  'familie/admin.html'
]) assert.equal(isPrivateAdminSourcePath(rel), true, `expected private admin path: ${rel}`);

for (const rel of [
  '../admin.html',
  '/admin.html',
  '\\\\server\\share\\admin.html',
  'C:\\\\temp\\admin.html',
  'nested/../admin.html'
]) assert.equal(isPrivateAdminSourcePath(rel), false, `unsafe admin path must be rejected: ${rel}`);

for (const rel of [
  'index.html',
  'shop/index.html',
  'gejast-config.js',
  'site-shell.css',
  'logo-small.png',
  'supabase/functions/shop-ops-v847/index.ts'
]) assert.equal(isPrivateAdminSourcePath(rel), false, `expected public/shared path: ${rel}`);

const build = fs.readFileSync('scripts/build-admin-worker-assets.mjs', 'utf8');
const extract = fs.readFileSync('scripts/extract-private-admin-source.mjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/deploy-admin-worker.yml', 'utf8');
const gitignore = fs.readFileSync('.gitignore', 'utf8');

assert.match(build, /KALENEL_PRIVATE_ADMIN_SOURCE_DIR/);
assert.match(build, /KALENEL_REQUIRE_PRIVATE_ADMIN_SOURCE/);
assert.match(build, /external-private/);
assert.match(build, /public-fallback/);
assert.match(build, /readPrivateManifest/);
assert.match(extract, /admin-source-manifest\.json/);
assert.match(extract, /assertNoObviousSecretMaterial/);
assert.match(workflow, /KALENEL_ADMIN_SOURCE_REPOSITORY/);
assert.match(workflow, /KALENEL_ADMIN_SOURCE_TOKEN/);
assert.match(workflow, /KALENEL_REQUIRE_PRIVATE_ADMIN_SOURCE/);
assert.match(workflow, /path: \.private-admin-source/);
assert.match(workflow, /persist-credentials: false/);
assert.doesNotMatch(workflow, /^\s{2}push:/m);
assert.match(gitignore, /private-admin-source-export-v847\//);
assert.match(gitignore, /\.private-admin-source\//);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kalenel-admin-source-'));
try {
  const rel = 'admin_probe.html';
  const file = path.join(tmp, rel);
  fs.writeFileSync(file, '<!doctype html><title>private probe</title>\n');
  const manifest = {
    schema: ADMIN_SOURCE_SCHEMA,
    release: 'test',
    source_ref: 'test',
    files: [{ path: rel, sha256: sha256File(file), size: fs.statSync(file).size }]
  };
  fs.writeFileSync(path.join(tmp, 'admin-source-manifest.json'), JSON.stringify(manifest));
  const parsed = readPrivateManifest(tmp);
  assert.equal(parsed.files.length, 1);
  fs.appendFileSync(file, 'tamper');
  assert.throws(() => readPrivateManifest(tmp), /hash mismatch/i);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('v847 private admin source boundary checks passed');
