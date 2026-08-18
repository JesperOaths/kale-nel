#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('GEJAST_v812a_track_site_event_conflict_guard.sql', 'utf8');
const prepare = fs.readFileSync('scripts/prepare-visual-audit-runtime-v812.mjs', 'utf8');
const visualWorkflow = fs.readFileSync('.github/workflows/full-live-visual-audit-v792.yml', 'utf8');
const version = fs.readFileSync('VERSION', 'utf8').trim();

assert.equal(version, 'v812', 'v812a is SQL/test-only and must not advance the shipped product version');

assert.match(sql, /create or replace function public\.track_site_event\s*\(/i, 'v812a must replace the deployed analytics RPC');
assert.doesNotMatch(sql, /create or replace function public\._gejast_elo_for_game_scope/i, 'v812a must not bundle the unrelated v806a ELO repair');
assert.match(sql, /on conflict on constraint site_visitors_pkey/i, 'visitor upsert must bind the named primary key');
assert.match(sql, /on conflict on constraint site_visit_sessions_pkey/i, 'session upsert must bind the named primary key');
assert.doesNotMatch(sql, /on conflict\s*\(\s*visitor_id\s*\)/i, 'ambiguous visitor_id conflict target must not return');
assert.doesNotMatch(sql, /on conflict\s*\(\s*session_id\s*\)/i, 'ambiguous session_id conflict target must not return');
assert.match(sql, /security definer/i, 'analytics RPC security-definer contract must be preserved');
assert.match(sql, /set search_path to 'public'/i, 'analytics RPC fixed search_path must be preserved');

assert.match(prepare, /declaredRedirectTarget/, 'visual runtime must derive checked-in redirect intent');
assert.match(prepare, /redirectDestinationReached/, 'visual runtime must wait for the declared destination');
assert.match(prepare, /current\.hostname === 'admin\.kalenel\.nl'/, 'visual runtime must recognize the live Cloudflare admin destination');
assert.match(prepare, /snapshot\.bodyVisible && snapshot\.bodyChars >= 20/, 'destination must be visibly rendered before capture');
assert.match(prepare, /snapshot\.authState !== 'checking'/, 'destination auth gate must settle before capture');
assert.match(prepare, /finalNavigationStatus/, 'visual evidence must use the final navigation response status');
assert.match(prepare, /executablePath: process\.env\.GEJAST_SYSTEM_CHROME/, 'visual runtime must retain deterministic system Chrome');

assert.match(visualWorkflow, /scripts\/prepare-visual-audit-runtime-v812\.mjs/, 'permanent visual workflow must apply the v812 runtime preparation');
assert.match(visualWorkflow, /node --check scripts\/prepare-visual-audit-runtime-v812\.mjs/, 'permanent visual workflow must syntax-check the runtime preparation');
assert.doesNotMatch(visualWorkflow, /npx\s+playwright\s+install|playwright\s+install\s+--with-deps/, 'unbounded Playwright browser download must remain absent');
assert.match(visualWorkflow, /Refine declared authenticated redirect aliases/, 'existing fail-closed declared-alias refinement must remain wired');
assert.match(visualWorkflow, /Cleanup disposable visual-audit state/, 'visual fixture cleanup must remain wired');

console.log('RESULT=V812A_FINAL_CERT_BLOCKERS_GUARD_PASS');
