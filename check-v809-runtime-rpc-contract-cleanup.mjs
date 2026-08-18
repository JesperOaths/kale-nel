#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
assert(Number(version.replace(/^v/i,''))>=809,'v809+ required');
const read=(p)=>fs.readFileSync(p,'utf8');
const ann=read('gejast-site-announcements.js');
assert(!ann.includes('limit_count: 8'),'announcement poll must not send obsolete limit_count');
assert(/consume_player_site_announcement_scoped[\s\S]{0,260}session_token: sessionToken/.test(ann),'announcement consume must send session_token');
const float=read('drinks-verify-float.js');
assert(float.includes('/rpc/get_drinks_page_public'),'verification float must use canonical drinks page queue');
assert(!float.includes('/rpc/get_all_pending_drink_event_verifications_public'),'verification float must not call empty pending compatibility RPC');
assert(!float.includes('/rpc/get_drink_event_vote_queue_public'),'verification float must not call empty vote-queue compatibility RPC');
const workflow=read('gejast-drinks-workflow.js');
assert(!workflow.includes("rpc('get_all_pending_drink_event_verifications_public'"),'drinks workflow must not call empty pending compatibility RPC');
assert(workflow.includes('Array.isArray(page.verify_queue)'),'drinks workflow must consume canonical page verify_queue');
const add=read('drinks_add.html');
assert(!add.includes("rpcWithTimeout('get_all_pending_drink_event_verifications_public'"),'drinks add must not call empty pending compatibility RPC');
assert(add.includes('Array.isArray(page.verify_queue)'),'drinks add must consume canonical page verify_queue');
for (const file of ['gejast-account-runtime.js','gejast-session-corner.js','home.html','gejast-combined-readers.js']) {
  assert(!/["']get_public_state["']/.test(read(file)),`${file} must not call legacy get_public_state session contract`);
}
assert(read('gejast-account-runtime.js').includes("rpc('account_public_state_v687'"),'account runtime must use canonical account state');
assert(read('gejast-session-corner.js').includes('/rpc/account_public_state_v687'),'session corner must use canonical account state');
assert(read('home.html').includes('/rpc/account_public_state_v687'),'home validation must use canonical account state');
assert(read('gejast-combined-readers.js').includes("RPC.callRpc('account_public_state_v687'"),'homepage fallback must use canonical account state');
const hp=read('gejast-home-profile-runtime.js');
const playerLine=hp.match(/async function loadPlayer\(\)\{[^\n]+/)?.[0]||'';
assert(playerLine.includes('player_name_input:p') && playerLine.includes('site_scope_input:scope()'),'player runtime bundle must send canonical player/scope args');
assert(!playerLine.includes('session_token_input'),'player runtime bundle must not send unsupported session_token_input');
console.log('PASS v809 runtime RPC contract cleanup');
