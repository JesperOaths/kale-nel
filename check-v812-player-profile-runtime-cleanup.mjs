#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
assert(Number(version.replace(/^v/i,''))>=812,'v812+ required');
const src=fs.readFileSync('gejast-profile-source.js','utf8');
assert(!src.includes("RPC.callRpc('get_public_player_unified_scoped'"),'active profile source must not call the known-broken unified aggregate RPC');
assert(src.includes("RPC.callRpc('get_profiles_page_bundle_scoped'"),'profile identity must retain the healthy scoped profiles bundle fallback');
assert(src.includes("RPC.callRpc('get_public_shared_player_stats_scoped', payload)"),'player panels must use healthy scoped shared stats');
assert(src.includes("RPC.callRpc('get_public_player_game_insights_scoped', payload)"),'player panels must use healthy scoped game insights');
assert(src.includes('game_key_input: gameKey') && src.includes('player_name_input: playerName') && src.includes('site_scope_input: scope'),'scoped player panel RPC arguments must be explicit');
console.log('PASS v812 player profile runtime cleanup');
