import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'cloudflare', 'workers', 'admin-gate', 'static');
const allowedExtensions = new Set(['.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.svg', '.json', '.csv']);
const excludedDirs = new Set(['.git', 'node_modules', 'cloudflare', 'deployment_forensics_v761', 'mnt', 'sql']);
const excludedFiles = [/\.md$/i, /\.txt$/i, /\.sql$/i, /\.patch$/i, /_orig\.html$/i];

function walk(dir, rel = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) continue;
      files.push(...walk(full, entryRel));
    } else if (entry.isFile()) {
      if (!allowedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      if (excludedFiles.some((rx) => rx.test(entryRel))) continue;
      files.push(entryRel);
    }
  }
  return files;
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = walk(root);
for (const rel of files) {
  const src = path.join(root, rel);
  const dst = path.join(out, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

const manifest = {
  built_at: new Date().toISOString(),
  release: 'v762-admin-worker-gate',
  file_count: files.length,
  notes: [
    'Generated static asset bundle for Cloudflare Workers Static Assets.',
    'Secrets, markdown, SQL, patch files, mnt, deployment_forensics_v761, and cloudflare source are intentionally excluded.',
    'The public site remains served from the existing origin; this bundle is served only behind the admin Worker OAuth gate.'
  ],
  protected_entrypoints: files.filter((f) => /(^|\/)(admin[^/]*\.html|drinks_admin\.html|familie_admin\.html|match_control\.html|match_swap\.html|[^/]*_vault\.html|vault\.html)$/i.test(f)).sort()
};
fs.writeFileSync(path.join(out, 'admin-worker-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ out, copied: files.length, manifest: 'admin-worker-manifest.json' }, null, 2));
