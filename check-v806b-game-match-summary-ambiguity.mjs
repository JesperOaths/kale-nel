#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('GEJAST_v806b_game_match_summary_ambiguity.sql','utf8');
assert(sql.includes('PREPARED ONLY. Do not apply to production without explicit authorization.'),'v806b must preserve explicit production authorization boundary');
assert(sql.includes('create or replace function public.save_game_match_summary'),'save_game_match_summary replacement missing');
assert(sql.includes("v_game_type text := lower(trim(coalesce($2,'')))"),'game_type input must be positional');
assert(sql.includes("v_client_match_id text := nullif(trim(coalesce($3,'')), '')"),'client_match_id input must be positional');
assert(sql.includes("coalesce($4->'winner_names','[]'::jsonb)"),'summary payload must be positional');
assert(sql.includes('on conflict on constraint game_match_summaries_game_type_client_match_id_key'),'upsert must name the existing unique constraint');
assert(!/on conflict\s*\(\s*game_type\s*,\s*client_match_id\s*\)/i.test(sql),'ambiguous conflict target must not return');
assert(sql.trim().toLowerCase().endsWith('commit;'),'migration must be transaction-bounded');
console.log('PASS prepared v806b game-match-summary ambiguity repair');
