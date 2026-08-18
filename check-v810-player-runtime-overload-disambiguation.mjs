#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
assert(Number(version.replace(/^v/i,''))>=810,'v810+ required');
const src=fs.readFileSync('gejast-home-profile-runtime.js','utf8');
const line=src.match(/async function loadPlayer\(\)\{[^\n]+/)?.[0]||'';
assert(line.includes('player_name_input:p'),'player_name_input missing');
assert(line.includes('player_input:p'),'explicit player_input is required to select the three-argument production overload');
assert(line.includes('site_scope_input:scope()'),'site scope missing');
assert(!line.includes('session_token_input'),'unsupported session token argument must not return');
console.log('PASS v810 player runtime overload disambiguation');
