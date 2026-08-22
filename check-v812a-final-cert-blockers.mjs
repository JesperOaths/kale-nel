#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import './check-v812c-game-summary-write-boundary.mjs';

const sql = fs.readFileSync('GEJAST_v812a_track_site_event_conflict_guard.sql', 'utf8');
const boundarySql = fs.readFileSync('GEJAST_v812b_analytics_table_privilege_boundary.sql', 'utf8');
const prepare = fs.readFileSync('scripts/prepare-visual-audit-runtime-v812.mjs', 'utf8');
const visualWorkflow = fs.readFileSync('.github/workflows/full-live-visual-audit-v792.yml', 'utf8');
const liveBrowserWorkflow = fs.readFileSync('.github/workflows/final-certification-live-browser-v792.yml', 'utf8');
const version = fs.readFileSync('VERSION', 'utf8').trim();
const certification = JSON.parse(fs.readFileSync('release-certification.json', 'utf8'));
const versionNumber = Number((version.match(/^v(\d+)$/) || [])[1]);

assert.ok(Number.isInteger(versionNumber) && versionNumber >= 812, 'v812a/b/c guard requires shipped product v812 or newer');
assert.equal(certification.current_version, version, 'release certification state must track the shipped product version');
if (versionNumber > 812) {
  assert.equal(certification.status, 'REVALIDATION_REQUIRED', 'a post-v812 product candidate must remain fail-closed until exact-current certification completes');
  assert.equal(certification.superseded_uncertified_version, 'v812', 'the first post-v812 candidate must preserve v812 as the superseded uncertified product baseline');
  assert.ok(Array.isArray(certification.remaining_release_blockers) && certification.remaining_release_blockers.length > 0, 'post-v812 revalidation must retain explicit release blockers');
  assert.ok(Array.isArray(certification.required_next) && certification.required_next.length > 0, 'post-v812 revalidation must retain explicit next certification steps');
}

assert.match(sql, /create or replace function public\.track_site_event\s*\(/i, 'v812a must replace the deployed analytics RPC');
assert.doesNotMatch(sql, /create or replace function public\._gejast_elo_for_game_scope/i, 'v812a must not bundle the unrelated v806a ELO repair');
assert.match(sql, /on conflict on constraint site_visitors_pkey/i, 'visitor upsert must bind the named primary key');
assert.match(sql, /on conflict on constraint site_visit_sessions_pkey/i, 'session upsert must bind the named primary key');
assert.doesNotMatch(sql, /on conflict\s*\(\s*visitor_id\s*\)/i, 'ambiguous visitor_id conflict target must not return');
assert.doesNotMatch(sql, /on conflict\s*\(\s*session_id\s*\)/i, 'ambiguous session_id conflict target must not return');
assert.match(sql, /security definer/i, 'analytics RPC security-definer contract must be preserved');
assert.match(sql, /set search_path to 'public'/i, 'analytics RPC fixed search_path must be preserved');

for (const table of ['site_visitors', 'site_visit_sessions', 'site_visitor_events']) {
  assert.match(boundarySql, new RegExp(`revoke all privileges on table public\\.${table} from public, anon, authenticated`, 'i'), `${table} must not remain directly exposed to browser roles`);
}
assert.match(boundarySql, /grant execute on function public\.track_site_event\(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,text,text,text,boolean,text,boolean,jsonb\)[\s\S]*to anon, authenticated, service_role/i, 'current public analytics RPC must remain executable');
assert.match(boundarySql, /grant execute on function public\.admin_get_site_analytics_action\(text,integer,integer\)[\s\S]*to anon, authenticated, service_role/i, 'admin analytics RPC must remain callable so its session guard can enforce access');
assert.doesNotMatch(boundarySql, /grant\s+(?:select|insert|update|delete|all(?:\s+privileges)?)\s+on\s+(?:table\s+)?public\.site_(?:visitors|visit_sessions|visitor_events)\s+to\s+(?:anon|authenticated)/i, 'v812b must never re-grant direct analytics-table access to browser roles');

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
assert.match(visualWorkflow, /Refine (?:declared authenticated redirect aliases|authenticated redirects and proven transient aborts)/, 'fail-closed authenticated alias/runtime refinement must remain wired');
assert.match(visualWorkflow, /Cleanup disposable visual-audit state/, 'visual fixture cleanup must remain wired');

assert.match(liveBrowserWorkflow, /GEJAST_CERT_HEAD_SHA:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/, 'PR browser certification must serialize using the pull-request head SHA rather than the synthetic merge SHA');
assert.match(liveBrowserWorkflow, /head_sha=\$\{GEJAST_CERT_HEAD_SHA\}/, 'visual sibling discovery must query the exact PR head SHA indexed by Actions');
assert.doesNotMatch(liveBrowserWorkflow, /head_sha=\$\{GITHUB_SHA\}/, 'synthetic PR merge SHA must never be used to discover sibling visual runs');
assert.match(liveBrowserWorkflow, /Same-revision visual campaign did not finish before serialization timeout/, 'browser certification must fail closed if sibling visual serialization does not settle');

console.log('RESULT=V812ABC_FINAL_CERT_BLOCKERS_GUARD_PASS');
