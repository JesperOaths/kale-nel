#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN_SOURCE_SCHEMA,
  ADMIN_SOURCE_RELEASE,
  assertNoObviousSecretMaterial,
  isPrivateAdminSourcePath,
  normalizeRel,
  sha256File,
  walkFiles
} from './admin-source-boundary.mjs';

const root = process.cwd();
const arg = process.argv.find((x) => x.startsWith('--out='));
const outArg = arg ? arg.slice('--out='.length) : 'private-admin-source-export-v847';
const out = path.resolve(root, outArg);

if (out === root || root.startsWith(out + path.sep)) {
  throw new Error('Refusing to export private admin source over the repository root');
}

const excludedDirs = new Set([
  '.git', 'node_modules', 'cloudflare', 'deployment_forensics_v761', 'mnt', 'sql',
  path.basename(out)
]);
const excludedFiles = [/\.md$/i, /\.txt$/i, /\.sql$/i, /\.patch$/i, /_orig\.html$/i];

const files = walkFiles(root, {
  include: isPrivateAdminSourcePath,
  excludedDirs,
  excludedFiles
});

if (!files.length) throw new Error('No private admin source files found');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const manifestFiles = [];
for (const rel of files) {
  const safe = normalizeRel(rel);
  const src = path.join(root, safe);
  assertNoObviousSecretMaterial(src, safe);
  const dst = path.join(out, safe);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  manifestFiles.push({
    path: safe,
    sha256: sha256File(dst),
    size: fs.statSync(dst).size
  });
}

const manifest = {
  schema: ADMIN_SOURCE_SCHEMA,
  release: ADMIN_SOURCE_RELEASE,
  created_at: new Date().toISOString(),
  source_repository: 'JesperOaths/kale-nel',
  source_ref: process.env.GITHUB_SHA || null,
  file_count: manifestFiles.length,
  files: manifestFiles
};
fs.writeFileSync(
  path.join(out, 'admin-source-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);

const readme = `# Kalenel private admin source export

This directory is generated from the public repository as a one-time migration package.

- Keep this repository private.
- Do not add secrets, API tokens, service-role keys, OAuth secrets, or production credentials.
- Preserve \`admin-source-manifest.json\`; the public deployment workflow verifies every file hash before use.
- After the private repository is configured in GitHub Actions, protected admin assets are sourced from there while shared public assets continue to come from the public repository.
- Once external-private deployment is proven, the matching protected source files can be removed from the public repository in a separate reviewed change.

Generated: ${manifest.created_at}
Files: ${manifest.file_count}
`;
fs.writeFileSync(path.join(out, 'README.md'), readme);

console.log(JSON.stringify({
  ok: true,
  out,
  file_count: manifest.file_count,
  schema: manifest.schema,
  release: manifest.release
}, null, 2));
