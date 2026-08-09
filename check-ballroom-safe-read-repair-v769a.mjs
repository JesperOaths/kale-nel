#!/usr/bin/env node
import fs from 'node:fs';

const file = 'GEJAST_v769a_ballroom_safe_read_repair.sql';
const sql = fs.readFileSync(file, 'utf8');
const lower = sql.toLowerCase();
const failures = [];

function need(needle, label) {
  if (!lower.includes(needle.toLowerCase())) failures.push(label);
}
function reject(re, label) {
  if (re.test(lower)) failures.push(label);
}

const createMatches = [...lower.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/g)].map((m) => m[1]);
const expected = ['get_ballroom_public_state_safe', 'get_ballroom_state_safe'];
if (createMatches.length !== 2 || createMatches.some((name) => !expected.includes(name))) {
  failures.push(`repair must replace exactly the two safe read functions; found ${createMatches.join(', ')}`);
}

need('security definer', 'safe read functions must remain SECURITY DEFINER');
if ((lower.match(/set\s+search_path\s*=\s*public/g) || []).length !== 2) failures.push('both functions must pin search_path to public');
need("where s.id = 1", 'singleton Ballroom state read must target id=1');
need("where r.status = 'pending'", 'request list must read pending requests only');
need("'approved_members'", 'state JSON must include approved_members');
need("'succession_line'", 'state JSON must include succession_line');
need("'pending_requests'", 'state JSON must include pending_requests');
need("'viewer'", 'state JSON must include viewer');
need('select public.get_ballroom_public_state_safe(session_token, session_token_input)', 'wrapper must delegate only to safe public-state reader');

reject(/\binsert\b/, 'repair must not insert data');
reject(/\bupdate\b/, 'repair must not update data');
reject(/\bdelete\b/, 'repair must not delete data');
reject(/\btruncate\b/, 'repair must not truncate data');
reject(/\bdrop\s+(?:table|schema|function)\b/, 'repair must not drop objects');
reject(/\balter\s+table\b/, 'repair must not alter tables');

for (const fn of expected) {
  need(`revoke execute on function public.${fn}(text, text) from public`, `${fn} must revoke PUBLIC execute`);
  need(`grant execute on function public.${fn}(text, text) to anon, authenticated`, `${fn} must grant only app roles`);
}

if (!/^begin;\s*/i.test(sql)) failures.push('repair must start a transaction');
if (!/commit;\s*$/i.test(sql)) failures.push('repair must commit transaction');

const ballroom = fs.readFileSync('ballroom.html', 'utf8');
if (!ballroom.includes("get_ballroom_state_safe")) failures.push('frontend must still prefer safe Ballroom state RPC');
if (!ballroom.includes("get_ballroom_public_state_safe")) failures.push('frontend safe public-state fallback must remain available');

if (failures.length) {
  console.error('Ballroom v769a safe-read repair guard FAILED:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Ballroom v769a safe-read repair guard PASS: exactly two read functions, zero data DML.');
