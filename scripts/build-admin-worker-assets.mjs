import fs from 'node:fs';
import path from 'node:path';
import {
  isPrivateAdminSourcePath,
  normalizeRel,
  readPrivateManifest,
  walkFiles
} from './admin-source-boundary.mjs';

const root = process.cwd();
const out = path.join(root, 'cloudflare', 'workers', 'admin-gate', 'static');
const excludedDirs = new Set(['.git', 'node_modules', 'cloudflare', 'deployment_forensics_v761', 'mnt', 'sql']);
const excludedFiles = [/\.md$/i, /\.txt$/i, /\.sql$/i, /\.patch$/i, /_orig\.html$/i];

const privateSourceRaw = String(process.env.KALENEL_PRIVATE_ADMIN_SOURCE_DIR || '').trim();
const requirePrivate = /^(?:1|true|yes)$/i.test(String(process.env.KALENEL_REQUIRE_PRIVATE_ADMIN_SOURCE || ''));
const privateSourceRoot = privateSourceRaw ? path.resolve(root, privateSourceRaw) : '';

if (requirePrivate && !privateSourceRoot) {
  throw new Error('Private admin source is required but KALENEL_PRIVATE_ADMIN_SOURCE_DIR is not configured');
}
if (privateSourceRoot && (!fs.existsSync(privateSourceRoot) || !fs.statSync(privateSourceRoot).isDirectory())) {
  throw new Error(`Configured private admin source directory does not exist: ${privateSourceRoot}`);
}

const sourceMode = privateSourceRoot ? 'external-private' : 'public-fallback';
let privateManifest = null;
let privateFiles = [];

if (privateSourceRoot) {
  privateManifest = readPrivateManifest(privateSourceRoot);
  privateFiles = privateManifest.files.map((item) => normalizeRel(item.path));
}

const publicFiles = walkFiles(root, {
  include: (rel) => sourceMode === 'public-fallback' || !isPrivateAdminSourcePath(rel),
  excludedDirs,
  excludedFiles
});

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function copyFile(sourceRoot, rel) {
  const src = path.join(sourceRoot, rel);
  const dst = path.join(out, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

for (const rel of publicFiles) copyFile(root, rel);
for (const rel of privateFiles) copyFile(privateSourceRoot, rel);

const files = [...new Set([...publicFiles, ...privateFiles])].sort();
const protectedEntrypointPattern = /(^|\/)(admin[^/]*\.html|drinks_admin\.html|familie_admin\.html|match_control\.html|match_swap\.html|[^/]*_vault\.html|vault\.html)$/i;

const manifest = {
  built_at: new Date().toISOString(),
  release: 'v762-admin-worker-gate',
  file_count: files.length,
  admin_source_mode: sourceMode,
  private_admin_source: privateManifest ? {
    schema: privateManifest.schema,
    release: privateManifest.release || null,
    source_ref: privateManifest.source_ref || null,
    file_count: privateFiles.length
  } : null,
  migration_ready: sourceMode === 'external-private',
  notes: [
    'Generated static asset bundle for Cloudflare Workers Static Assets.',
    'Secrets, markdown, SQL, patch files, mnt, deployment_forensics_v761, and cloudflare source are intentionally excluded.',
    sourceMode === 'external-private'
      ? 'Protected admin source came from the separately checked-out private admin-source repository; shared public assets came from the public repository.'
      : 'TRANSITION MODE: protected admin source still came from the public repository. Configure the private admin-source repository before removing protected source from public Git history.',
    'The public site remains served from the existing origin; this bundle is served only behind the admin Worker OAuth gate.'
  ],
  protected_entrypoints: files.filter((f) => protectedEntrypointPattern.test(f)).sort()
};

fs.writeFileSync(path.join(out, 'admin-worker-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

if (sourceMode === 'public-fallback') {
  console.warn('WARNING: admin Worker built in public-fallback mode; private-admin-source migration is not complete.');
}

console.log(JSON.stringify({
  out,
  copied: files.length,
  admin_source_mode: sourceMode,
  private_source_files: privateFiles.length,
  manifest: 'admin-worker-manifest.json'
}, null, 2));
