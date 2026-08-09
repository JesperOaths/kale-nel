#!/usr/bin/env node
import fs from 'node:fs';

const path = 'LIVE_V771D_DRINKS_TRANSACTIONAL_PROOF.sql';
const sql = fs.readFileSync(path, 'utf8');
const code = sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--[^\n\r]*/g, '');
const failures = [];

function requireText(text, label) {
  if (!sql.includes(text)) failures.push(`proof missing ${label}`);
}
function requireCode(pattern, label) {
  if (!pattern.test(code)) failures.push(`proof missing ${label}`);
}
function forbidCode(pattern, label) {
  if (pattern.test(code)) failures.push(`proof contains forbidden ${label}`);
}

// Supabase SQL Editor can wrap the whole submission in a transaction. Therefore the proof must
// not use script-level transaction control or temp baseline tables that disappear on ROLLBACK.
forbidCode(/\b(?:commit|rollback)\s*;/i, 'script-level COMMIT/ROLLBACK');
forbidCode(/\bcreate\s+(?:temp(?:orary)?\s+)?table\b/i, 'helper table creation');
forbidCode(/\btruncate\b/i, 'TRUNCATE');
if (code.includes('_v771d_baseline') || code.includes('_v771d_sequences')) failures.push('proof must not depend on temp baseline/sequence tables');
requireText("v_baseline jsonb := '[]'::jsonb", 'in-memory row-count baseline');
requireText("v_sequences jsonb := '[]'::jsonb", 'in-memory sequence baseline');

// Controlled DML must be rolled back by a private PL/pgSQL exception subtransaction. Only the
// private P771D signal is success; unexpected errors must restore sequences and re-raise.
requireCode(/raise\s+exception\s+using\s+errcode\s*=\s*'P771D'/i, 'private P771D rollback signal');
requireCode(/when\s+sqlstate\s+'P771D'\s+then[\s\S]*?v_expected_rollback\s*:=\s*true/i, 'P771D success handler');
requireCode(/when\s+others\s+then[\s\S]*?perform\s+setval\([\s\S]*?\braise\s*;/i, 'unexpected-error sequence restore and re-raise');
requireText("if not v_expected_rollback then raise exception 'v771d controlled subtransaction did not execute expected rollback'", 'expected rollback hard stop');

const controlledWriteIndex = code.indexOf('insert into public.gejast_player_sessions_v746');
const signalIndex = code.search(/raise\s+exception\s+using\s+errcode\s*=\s*'P771D'/i);
const expectedHandlerIndex = code.search(/when\s+sqlstate\s+'P771D'/i);
const lastSetvalIndex = code.lastIndexOf('perform setval(r.seq_name::regclass,r.last_value,r.is_called)');
const postcheckIndex = code.indexOf('select * from jsonb_to_recordset(v_baseline)');
const passTableIndex = code.indexOf("('approval_lifecycle','PASS'");
if (controlledWriteIndex < 0 || signalIndex < controlledWriteIndex) failures.push('private rollback signal must occur after controlled lifecycle DML');
if (expectedHandlerIndex < signalIndex) failures.push('P771D handler must follow the private rollback signal');
if (lastSetvalIndex < expectedHandlerIndex) failures.push('sequence restore must occur after expected controlled rollback');
if (postcheckIndex < lastSetvalIndex) failures.push('exact table postchecks must occur after sequence restoration');
if (passTableIndex < postcheckIndex) failures.push('PASS rows must be emitted only after rollback/residue verification');

// No schema/permission mutation belongs in a proof-only script.
forbidCode(/\balter\s+(?:table|function|policy|sequence)\b/i, 'ALTER DDL');
forbidCode(/\bdrop\s+(?:table|function|policy|sequence)\b/i, 'DROP DDL');
forbidCode(/\bgrant\b/i, 'GRANT');
forbidCode(/\brevoke\b/i, 'REVOKE');

// Pin the exact active production contracts; no legacy fallback is allowed in readiness proof.
requireText("to_regprocedure('public.contract_drinks_write_v664(text,text,jsonb,text)')", 'v664 write-contract preflight');
requireText("to_regprocedure('public.contract_drinks_read_v664(text,double precision,double precision,integer,text)')", 'v664 read-contract preflight');
requireCode(/public\.contract_drinks_write_v664\s*\(/i, 'v664 write contract invocation');
requireCode(/public\.contract_drinks_read_v664\s*\(/i, 'v664 read contract invocation');
for (const legacy of ['contract_drinks_write_v663', 'contract_drinks_write_v391', 'contract_drinks_write_v386', 'contract_drinks_write_v1', 'contract_drinks_read_v663']) {
  if (code.includes(legacy)) failures.push(`proof must not fall back to legacy contract ${legacy}`);
}

// Production enforces one pending drink per player. The creator must be free before the proof,
// approval must become terminal, and only then may the rejection fixture be created.
requireCode(/not\s+exists\s*\(\s*select\s+1[\s\S]*?from\s+public\.drink_events\s+e[\s\S]*?e\.player_id\s*=\s*p\.id[\s\S]*?lower\s*\(\s*coalesce\s*\(\s*e\.status\s*,\s*'pending'\s*\)\s*\)\s*=\s*'pending'/i, 'creator exclusion for existing pending drinks');
requireText('v771d proof requires one active friends-scope player with no existing pending drink', 'free-creator hard stop');
requireText('creator still has a pending drink after approval closure', 'post-approval pending hard stop');
const approveClosedIndex = code.indexOf("if v_status not in ('verified','approved')");
const rejectCreateIndex = code.indexOf('v_create_reject := public.contract_drinks_write_v664');
if (approveClosedIndex < 0 || rejectCreateIndex < 0 || rejectCreateIndex < approveClosedIndex) failures.push('rejection fixture must be created only after approval lifecycle closes');

// Both lifecycle directions must be exercised using independent non-creator verifier sessions.
requireText("'create_event'", 'create_event action');
requireText("'verify_event'", 'verify_event action');
requireText("'approved',true", 'approval vote');
requireText("'approve',true", 'approval compatibility flag');
requireText("'approved',false", 'rejection vote');
requireText("'approve',false", 'rejection compatibility flag');
requireCode(/v_tokens\s*:=\s*array\[v_token_b,v_token_c,v_token_d\]/i, 'three independent verifier sessions');
requireText("v_status in ('verified','approved')", 'approved terminal-state proof');
requireText("v_status in ('rejected','cancelled')", 'rejected terminal-state proof');
requireText("position('recent_verified' in v_read::text)", 'final approved read-contract evidence');
requireText("position('recent_rejected' in v_read::text)", 'final rejected read-contract evidence');
requireText("('one_pending_invariant','PASS'", 'one-pending invariant PASS row');

// Scope/session safety and complete rollback residue checks.
requireText("'friends'", 'friends scope fixture');
requireText("session_token like 'OC_V771D_DRINKS_%'", 'controlled-session residue check');
requireText("tablename like 'drink%' or tablename='gejast_player_sessions_v746'", 'Drinks/session baseline coverage');
requireText("lock table public.%I in share row exclusive mode", 'short proof write locks');
requireCode(/jsonb_build_object\('table_name',r\.tablename,'row_count',v_count\)/i, 'in-memory table baseline capture');
requireCode(/jsonb_build_object\('seq_name',r\.seq_name,'last_value',v_last,'is_called',v_called\)/i, 'in-memory sequence baseline capture');
requireText('perform setval(r.seq_name::regclass,r.last_value,r.is_called)', 'sequence restoration');
requireText('v_count<>r.row_count', 'exact row-count restoration check');
requireText('v_last<>r.last_value or v_called<>r.is_called', 'exact sequence-state restoration check');

// The proof must never enqueue/send push work.
forbidCode(/\bqueue_nearby_verification_pushes(?:_v\d+)?\s*\(/i, 'push queue RPC call');
forbidCode(/\b(?:send|dispatch)[a-z0-9_]*push[a-z0-9_]*\s*\(/i, 'push send/dispatch call');

// Preserve Ice=2.8 before, during and after the controlled lifecycle.
requireText("lower(key)='ice' and unit_value::numeric=2.8", 'pre/post Ice=2.8 invariant');
requireText('if v_ice<>2.8', 'in-lifecycle Ice=2.8 invariant');

for (const row of ['approval_lifecycle','rejection_lifecycle','one_pending_invariant','rollback_counts','sequence_restore','controlled_residue']) {
  requireText(`('${row}','PASS'`, `${row} PASS row`);
}

if (failures.length) {
  console.error('v771d Drinks transactional proof regression FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('v771d Drinks transactional proof regression PASS.');
