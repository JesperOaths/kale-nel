#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
assert(Number(version.replace(/^v/i,''))>=808,'v808+ required');
const html=fs.readFileSync('familie/player.html','utf8');
assert(html.includes("const player=String(q.get('player')||'').trim()"),'Family player alias must inspect player query');
assert(html.includes("if(!player){location.replace('../profiles.html?scope=family');}"),'empty Family player alias must route to Family profiles');
assert(html.includes("q.set('scope','family');location.replace('../player.html?'+q.toString())"),'named Family player alias must preserve canonical player redirect with family scope');
console.log('PASS v808 Family player empty alias contract');
