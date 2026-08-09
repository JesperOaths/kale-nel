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

// The production proof must be rollback-only. Comments are stripped before these checks so
// documentation such as "no COMMIT exists" cannot accidentally satisfy/fail the contract.
forbidCode(/\bcommit\s*;/i, 'COMMIT');
if ((code.match(/\bbegin\s*;/gi) || []).length !== 1) failures.push('proof must contain exactly one explicit transaction BEGIN;');
if ((code.match(/\brollback\s*;/gi) || []).length !== 1) failures.push('proof must contain exactly one explicit ROLLBACK;');

const beginIndex = code.search(/\bbegin\s*;/i);
const controlledWriteIndex = code.indexOf('insert into public.gejast_player_sessions_v746');
const restoreIndex = code.indexOf('do $restoreseq$');
const rollbackIndex = code.search(/\brollback\s*;/i);
const postcheckIndex = code.indexOf('do $postcheck$');
if (beginIndex < 0 || controlledWriteIndex < beginIndex) failures.push('controlled production writes must occur only after explicit BEGIN');
if (restoreIndex < 0 || rollbackIndex < 0 || restoreIndex > rollbackIndex) failures.push('sequence restoration must occur before ROLLBACK');
if (postcheckIndex < 0 || rollbackIndex < 0 || postcheckIndex < rollbackIndex) failures.push('post-rollback residue checks must occur after ROLLBACK');

// No schema/permission mutation belongs in a proof-only script. Temporary helper tables are
// allowed; permanent table/function/policy/grant changes are not.
forbidCode(/\balter\s+(?:table|function|policy|sequence)\b/i, 'ALTER DDL');
forbidCode(/\bdrop\s+(?:table|function|policy|sequence)\b/i, 'DROP DDL');
forbidCode(/\bgrant\b/i, 'GRANT');
forbidCode(/\brevoke\b/i, 'REVOKE');
if (/\bcreate\s+table\b/i.test(code)) failures.push('proof may create TEMP tables only, never permanent tables');

// Pin the exact current production contracts. This proof intentionally does not use legacy
// fallbacks because readiness is meant to certify the active v664 path.
requireText("to_regprocedure('public.contract_drinks_write_v664(text,text,jsonb,text)')", 'v664 write-contract preflight');
requireText("to_regprocedure('public.contract_drinks_read_v664(text,double precision,double precision,integer,text)')", 'v664 read-contract preflight');
requireCode(/public\.contract_drinks_write_v664\s*\(/i, 'v664 write contract invocation');
requireCode(/public\.contract_drinks_read_v664\s*\(/i, 'v664 read contract invocation');
for (const legacy of ['contract_drinks_write_v663', 'contract_drinks_write_v391', 'contract_drinks_write_v386', 'contract_drinks_write_v1', 'contract_drinks_read_v663']) {
  if (code.includes(legacy)) failures.push(`proof must not fall back to legacy contract ${legacy}`);
}

// Both lifecycle directions must be exercised using independent valid sessions.
requireText("'create_event'", 'create_event action');
requireText("'verify_event'", 'verify_event action');
requireText("'approved',true", 'approval vote');
requireText("'approve',true", 'approval compatibility flag');
requireText("'approved',false", 'rejection vote');
requireText("'approve',false", 'rejection compatibility flag');
requireText("v_tokens:=array[v_token_b,v_token_c,v_token_d]", 'three independent verifier sessions');
requireText("v_status in ('verified','approved')", 'approved terminal-state proof');
requireText("v_status in ('rejected','cancelled')", 'rejected terminal-state proof');
requireText("position('recent_verified' in v_read::text)", 'final approved read-contract evidence');
requireText("position('recent_rejected' in v_read::text)", 'final rejected read-contract evidence');

// Scope/session safety and complete rollback residue checks.
requireText("'friends'", 'friends scope fixture');
requireText("session_token like 'OC_V771D_DRINKS_%'", 'controlled-session residue check');
requireText("tablename like 'drink%' or tablename='gejast_player_sessions_v746'", 'Drinks/session baseline coverage');
requireText("lock table public.%I in share row exclusive mode", 'short proof write locks');
requireText("perform setval(r.seq_name::regclass,r.last_value,r.is_called)", 'sequence restoration');
requireText("v_count<>r.row_count", 'exact row-count restoration check');
requireText("v_last<>r.last_value or v_called<>r.is_called", 'exact sequence-state restoration check');

// The proof must never enqueue/send push work. A literal mention in comments is harmless, but
// executable code must not call any known push queue/send primitive.
forbidCode(/\bqueue_nearby_verification_pushes(?:_v\d+)?\s*\(/i, 'push queue RPC call');
forbidCode(/\b(?:send|dispatch)[a-z0-9_]*push[a-z0-9_]*\s*\(/i, 'push send/dispatch call');

// Preserve the product invariant that motivated the Drinks audit.
requireText("lower(key)='ice' and unit_value::numeric=2.8", 'pre/post Ice=2.8 invariant');
requireText("if v_ice<>2.8", 'in-transaction Ice=2.8 invariant');

// PASS output should only be reachable after rollback/postcheck sections.
requireText("('approval_lifecycle','PASS'", 'approval PASS row');
requireText("('rejection_lifecycle','PASS'", 'rejection PASS row');
requireText("('rollback_counts','PASS'", 'rollback-count PASS row');
requireText("('sequence_restore','PASS'", 'sequence-restore PASS row');
requireText("('controlled_residue','PASS'", 'controlled-residue PASS row');

if (failures.length) {
  console.error('v771d Drinks transactional proof regression FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('v771d Drinks transactional proof regression PASS.');
