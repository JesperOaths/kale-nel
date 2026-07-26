#!/usr/bin/env node
import fs from 'node:fs';

const scorer = fs.readFileSync(new URL('./toepen.html', import.meta.url), 'utf8');
const vault = fs.readFileSync(new URL('./toepen_vault.html', import.meta.url), 'utf8');
const homepageOwner = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('./GEJAST_v755_toepen_backend.sql', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/2–8 geregistreerde spelers|2-8 geregistreerde spelers|2 tot 8 spelers/i.test(scorer), 'Toepen scorer must document 2-8 players');
assert(/toepen_match_draft_v1/.test(scorer), 'Toepen scorer must use its own local draft key');
assert(/create_toepen_game/.test(scorer), 'Toepen scorer must use a separate Toepen save RPC');
assert(!/create_jas_game/.test(scorer), 'Toepen scorer must never call the Klaverjas save RPC');
assert(/folded_at_stake/.test(scorer), 'Toepen scorer must preserve fold-at-stake data');
assert(/undo_stack/.test(scorer), 'Toepen scorer must support undo');
assert(/get_toepen_vault_summary/.test(vault), 'Toepen vault must use the dedicated analytics RPC');
assert(/id="homeToepenEntry"/.test(homepageOwner) && /href="\.\/toepen\.html"/.test(homepageOwner), 'Homepage owner must include the native Toepen entry');
assert(/create table if not exists public\.toepen_games/i.test(sql), 'Toepen SQL must create a separate game table');
assert(/create table if not exists public\.toepen_round_results/i.test(sql), 'Toepen SQL must preserve normalized round results');
assert(/security definer/i.test(sql), 'Toepen SQL must expose controlled RPCs');
assert(!/insert into public\.jas_games/i.test(sql), 'Toepen SQL must not write to Klaverjas tables');

console.log('Toepen static regression smoke ok.');
