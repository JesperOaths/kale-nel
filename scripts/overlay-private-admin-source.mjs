#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { normalizeRel, readPrivateManifest } from './admin-source-boundary.mjs';

const root = process.cwd();
const raw = String(process.env.KALENEL_PRIVATE_ADMIN_SOURCE_DIR || '.private-admin-source').trim();
const sourceRoot = path.resolve(root, raw);
if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
  throw new Error(`Private admin source checkout not found: ${sourceRoot}`);
}

const manifest = readPrivateManifest(sourceRoot);
let copied = 0;
for (const item of manifest.files) {
  const rel = normalizeRel(item.path);
  const src = path.join(sourceRoot, rel);
  const dst = path.join(root, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied += 1;
}

console.log(JSON.stringify({
  ok: true,
  mode: 'private-admin-source-overlay',
  source_release: manifest.release || null,
  source_ref: manifest.source_ref || null,
  copied
}, null, 2));
