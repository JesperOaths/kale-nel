#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('GEJAST_v806a_runtime_warning_backend_repairs.sql','utf8');
assert(sql.includes('PREPARED ONLY. Do not apply to production without explicit authorization.'),'v806a must retain explicit production-authorization boundary');
assert(sql.includes('create or replace function public._gejast_elo_for_game_scope'),'Elo helper replacement missing');
assert(sql.includes("coalesce($1,'')"),'Elo helper must reference game input positionally');
assert(!/coalesce\(game_key\s*,\s*''\)/i.test(sql),'ambiguous bare game_key reference must not return');
assert(sql.includes('on conflict on constraint site_visitors_pkey'),'visitor upsert must name PK constraint');
assert(sql.includes('on conflict on constraint site_visit_sessions_pkey'),'session upsert must name PK constraint');
assert(!/on conflict \(visitor_id\)/i.test(sql),'ambiguous visitor_id conflict target must not return');
assert(!/on conflict \(session_id\)/i.test(sql),'ambiguous session_id conflict target must not return');
assert(sql.trim().toLowerCase().endsWith('commit;'),'migration must be transaction-bounded');
console.log('PASS prepared v806a runtime-warning backend repairs');
