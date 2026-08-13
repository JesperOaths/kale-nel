#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('GEJAST_v792a_klaverjas_online_privacy_guard.sql', 'utf8');
const room = fs.readFileSync('klaverjas_room.html', 'utf8');
const version = fs.readFileSync('VERSION', 'utf8').trim();

assert.equal(version, 'v792', 'v792a is SQL-only and must not bump the frontend version');
assert.match(room, /recovery_snapshot\s*=\s*makeRecoverySnapshot/i, 'room persists a recovery snapshot');
assert.match(room, /hands:st\.hands\s*\|\|\s*\[\]/, 'recovery snapshot contains hands');

assert.match(sql, /recovery_snapshot/i, 'migration handles recovery snapshot');
assert.match(sql, /redacted_recovery_hands/i, 'migration independently redacts recovery hands');
assert.match(sql, /viewer_seat\s+is\s+not\s+null[\s\S]*?is_bot/i, 'bot hands require a seated viewer');
assert.match(sql, /klaverjas_online_roster_mutation_rejected/i, 'existing roster mutation is rejected');
assert.match(sql, /klaverjas_online_roster_addition_rejected/i, 'unsafe roster additions are rejected');
assert.match(sql, /revoke\s+select\s+on\s+table\s+public\.klaverjas_online_games/i, 'raw table reads are revoked from web roles');
assert.match(sql, /klaverjas_online_cleanup_rooms\(text,boolean\)[\s\S]*?from\s+public,\s*anon,\s*authenticated/i, 'destructive cleanup execution is revoked from web roles');
assert.match(sql, /klaverjas_online_cleanup_rooms\(text,boolean\)[\s\S]*?to\s+service_role/i, 'cleanup remains service-role-only');
assert.match(sql, /_klaverjas_online_public\(public\.klaverjas_online_games,text\)[\s\S]*?from\s+public,\s*anon,\s*authenticated/i, 'raw projection helper is internal-only');

console.log('Online Klaverjas v792a privacy boundary guard ok.');
