#!/usr/bin/env node
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const patterns = [
  ['private_key_block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github_pat', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['github_classic_pat', /\bghp_[A-Za-z0-9]{30,}\b/],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['literal_service_role', /(?:SUPABASE_SERVICE_ROLE_KEY|service_role_key)\s*[:=]\s*['"][^'"\s]{20,}['"]/i],
  ['literal_github_client_secret', /GITHUB_CLIENT_SECRET\s*[:=]\s*['"][^'"\s]{16,}['"]/i],
  ['literal_cookie_secret', /COOKIE_SECRET\s*[:=]\s*['"][^'"\s]{16,}['"]/i],
  ['literal_vapid_private', /VAPID_PRIVATE_KEY\s*[:=]\s*['"][^'"\s]{16,}['"]/i],
  ['literal_private_key', /(?:^|\b)PRIVATE_KEY\s*[:=]\s*['"][^'"\s]{16,}['"]/i]
];

function serviceRoleJwt(line) {
  const matches = String(line).match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
  for (const token of matches) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      if (String(payload?.role || '').toLowerCase() === 'service_role') return true;
    } catch (_) {}
  }
  return false;
}

const child = spawn('git', [
  'log','--all','--full-history','--no-ext-diff','--format=@@COMMIT:%H','--patch','--unified=0','--','.'
], { stdio: ['ignore','pipe','pipe'] });

let currentCommit = '';
let currentFile = '';
const findings = new Map();
const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

function record(kind) {
  const file = currentFile || '(unknown)';
  const commit = currentCommit || '(unknown)';
  const key = `${commit}\u0000${file}\u0000${kind}`;
  if (!findings.has(key)) findings.set(key, { commit, file, kind });
}

rl.on('line', (line) => {
  if (line.startsWith('@@COMMIT:')) {
    currentCommit = line.slice('@@COMMIT:'.length).trim();
    currentFile = '';
    return;
  }
  if (line.startsWith('+++ b/')) {
    currentFile = line.slice(6).trim();
    return;
  }
  if (line.startsWith('--- a/')) {
    if (!currentFile) currentFile = line.slice(6).trim();
    return;
  }
  if (!(line.startsWith('+') || line.startsWith('-')) || line.startsWith('+++') || line.startsWith('---')) return;
  const candidate = line.slice(1);
  for (const [kind, re] of patterns) if (re.test(candidate)) record(kind);
  if (serviceRoleJwt(candidate)) record('service_role_jwt');
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

const exitCode = await new Promise((resolve) => child.on('close', resolve));
if (exitCode !== 0) {
  console.error(`Git history scan failed with exit ${exitCode}: ${stderr.trim().slice(0,1000)}`);
  process.exit(exitCode || 1);
}

const rows = [...findings.values()].sort((a,b) => a.commit.localeCompare(b.commit) || a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind));
console.log(`GIT_HISTORY_HIGH_CONFIDENCE_SECRET_FINDINGS=${rows.length}`);
for (const row of rows) console.log('HISTORY_SECRET '+JSON.stringify(row));
if (!rows.length) console.log('Git history high-confidence secret scan PASS: no private-key blocks, service-role JWTs, GitHub/AWS tokens, or literal configured private secrets detected.');
