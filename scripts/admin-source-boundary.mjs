import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ADMIN_SOURCE_SCHEMA = 'kalenel-private-admin-source/v1';
export const ADMIN_SOURCE_RELEASE = 'v847-private-admin-source-boundary';

export const allowedExtensions = new Set([
  '.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.svg', '.json', '.csv'
]);

export function normalizeRel(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');
}

export function isSafeRelativePath(value) {
  const raw = String(value || '');
  if (!raw || raw.includes(String.fromCharCode(0))) return false;
  if (/^[\\/]/.test(raw) || /^[A-Za-z]:[\\/]/.test(raw)) return false;
  const slash = raw.replaceAll('\\', '/');
  if (slash.split('/').some((part) => part === '..')) return false;
  const rel = normalizeRel(raw);
  return Boolean(rel) && !path.posix.isAbsolute(rel);
}

export function isPrivateAdminSourcePath(value) {
  if (!isSafeRelativePath(value)) return false;
  const rel = normalizeRel(value);
  const base = path.posix.basename(rel);
  const ext = path.posix.extname(base).toLowerCase();
  if (!allowedExtensions.has(ext)) return false;

  if (/^familie\/admin\.html$/i.test(rel)) return true;
  if (/^(?:drinks_admin|familie_admin|match_control|match_swap|vault)\.html$/i.test(rel)) return true;
  if (/_vault\.html$/i.test(base)) return true;
  if (/^admin[^/]*\.(?:html|js|css|json|csv|png|jpe?g|webp|gif|ico|svg)$/i.test(base)) return true;
  if (/^gejast-admin[^/]*\.(?:js|css|json)$/i.test(base)) return true;
  if (/^gejast-push-admin-source\.js$/i.test(base)) return true;
  return false;
}

export function walkFiles(root, {
  include = () => true,
  excludedDirs = new Set(),
  excludedFiles = [],
  rel = ''
} = {}) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const entryRel = normalizeRel(rel ? `${rel}/${entry.name}` : entry.name);
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) continue;
      files.push(...walkFiles(full, { include, excludedDirs, excludedFiles, rel: entryRel }));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!allowedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    if (excludedFiles.some((rx) => rx.test(entryRel))) continue;
    if (include(entryRel)) files.push(entryRel);
  }
  return files.sort();
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function assertNoObviousSecretMaterial(file, rel = file) {
  const ext = path.extname(file).toLowerCase();
  if (!['.html', '.js', '.css', '.json', '.csv'].includes(ext)) return;
  const body = fs.readFileSync(file, 'utf8');
  const checks = [
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i, 'private key'],
    [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
    [/\bsk_live_[A-Za-z0-9]{16,}\b/, 'live payment secret'],
    [/\bwhsec_[A-Za-z0-9]{16,}\b/, 'webhook signing secret'],
    [/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"][^'"]{20,}['"]/i, 'Supabase service-role secret']
  ];
  for (const [rx, label] of checks) {
    if (rx.test(body)) throw new Error(`Refusing private-admin export: apparent ${label} in ${rel}`);
  }
}

export function readPrivateManifest(sourceRoot) {
  const manifestPath = path.join(sourceRoot, 'admin-source-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Private admin source is missing admin-source-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.schema !== ADMIN_SOURCE_SCHEMA) {
    throw new Error(`Unsupported private admin source schema: ${manifest?.schema || 'missing'}`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Private admin source manifest contains no files');
  }
  const seen = new Set();
  for (const item of manifest.files) {
    const rel = normalizeRel(item?.path);
    if (!isSafeRelativePath(rel) || !isPrivateAdminSourcePath(rel)) {
      throw new Error(`Invalid private admin source path in manifest: ${item?.path || ''}`);
    }
    if (seen.has(rel)) throw new Error(`Duplicate private admin source path: ${rel}`);
    seen.add(rel);
    const file = path.join(sourceRoot, rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Private admin source file missing: ${rel}`);
    const actual = sha256File(file);
    if (!/^[a-f0-9]{64}$/i.test(String(item?.sha256 || '')) || actual !== String(item.sha256).toLowerCase()) {
      throw new Error(`Private admin source hash mismatch: ${rel}`);
    }
    assertNoObviousSecretMaterial(file, rel);
  }
  return manifest;
}
