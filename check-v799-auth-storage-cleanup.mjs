#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const current=Number((version.match(/\d+/)||['0'])[0]);
assert.ok(current>=799,'v799 auth storage cleanup requires VERSION v799 or newer');
const gate=fs.readFileSync('gejast-auth-gate.js','utf8');
for(const owner of ['sessionStorage.getItem(SESSION_KEY)','sessionStorage.getItem(LEGACY_SESSION_KEY)','window.GEJAST_CONFIG?.clearPlayerSessionTokens?.()','for(const storage of [localStorage,sessionStorage])','storage.removeItem(SESSION_KEY)','storage.removeItem(LEGACY_SESSION_KEY)','storage.removeItem(ACTIVITY_KEY)','storage.removeItem(SERVER_TOUCH_KEY)']) assert(gate.includes(owner),`v799 gate missing mirrored-session cleanup owner: ${owner}`);
assert(gate.includes("CONFIG_SRC='/gejast-config.js?v802'"),'v799 gate config bootstrap must carry v799');
console.log('v799 mirrored auth storage cleanup contract ok.');
