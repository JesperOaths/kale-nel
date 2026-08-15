#!/usr/bin/env node
/* Static contract proof for the post-v792e Klaverjas persistence chain.
   This deliberately does not execute production SQL. It proves the checked-in f/g/h
   migrations contain the authoritative-persistence, wrapped-roem, and recovery-bridge
   protections that are otherwise only exercised by their isolated PostgreSQL workflows. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(path,'utf8');
const f=read('GEJAST_v792f_klaverjas_online_persistence_guard.sql');
const g=read('GEJAST_v792g_klaverjas_online_roem_wrapper_fix.sql');
const h=read('GEJAST_v792h_klaverjas_online_recovery_snapshot_bridge.sql');

assert.match(f,/create or replace function public\.klaverjas_online_save_state\(/);
assert.match(f,/ignore caller summary_payload\/final_jas_payload/i);
assert.match(f,/canonical_summary/);
assert.match(f,/canonical_final/);
assert.match(f,/grant execute on function public\.klaverjas_online_save_state/);
assert.match(f,/revoke execute on function public\._klaverjas_online_save_state_v792e_inner/);

assert.match(g,/pending_trick\.cards\/trick entries are play wrappers/);
assert.match(g,/card_item := play_item -> 'card'/);
assert.match(g,/create or replace function public\._klaverjas_online_roem_points/);
assert.match(g,/revoke execute on function public\._klaverjas_online_roem_points/);

assert.match(h,/recovery-snapshot hidden-hand bridge/i);
assert.match(h,/recovery_snapshot.*hands/);
assert.match(h,/idx <> actor_seat/);
assert.match(h,/public\._klaverjas_online_save_state_v792f_inner/);
assert.match(h,/revoke execute on function public\._klaverjas_online_save_state_v792f_inner/);

console.log('Klaverjas v792f persistence canonicalization: present');
console.log('Klaverjas v792g wrapped-roem correction: present');
console.log('Klaverjas v792h recovery hidden-hand bridge: present');
console.log('RESULT=KLAVERJAS_PERSISTENCE_CHAIN_V792F_G_H_PASS');
