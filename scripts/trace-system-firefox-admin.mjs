import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const firefox = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kalenel-firefox-profile-'));
const logPath = 'ADMIN_SYSTEM_FIREFOX_TRACE_20260801.json';
const url = 'https://admin.kalenel.nl/admin.html';
const startedAt = new Date().toISOString();
const proc = spawn(firefox, ['-no-remote', '-profile', profile, '-private-window', url], { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
proc.stdout.on('data', (buf) => { stdout += buf.toString(); });
proc.stderr.on('data', (buf) => { stderr += buf.toString(); });
await new Promise((resolve) => setTimeout(resolve, 8000));
proc.kill();
await new Promise((resolve) => proc.once('exit', resolve));
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push({ path: full.slice(profile.length + 1), size: fs.statSync(full).size });
  }
}
walk(profile);
fs.writeFileSync(logPath, JSON.stringify({ startedAt, firefox, profile, url, exitCode: proc.exitCode, signalCode: proc.signalCode, stdout, stderr, profileFiles: files.slice(0, 200) }, null, 2) + '\n');
console.log(JSON.stringify({ logPath, exitCode: proc.exitCode, signalCode: proc.signalCode, stderr: stderr.slice(0, 1000) }, null, 2));
