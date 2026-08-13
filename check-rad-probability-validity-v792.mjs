#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rad=fs.readFileSync('rad.html','utf8');
const block=rad.match(/const SEGMENTS = \[([\s\S]*?)\n  \];/);
assert.ok(block,'Rad SEGMENTS owner missing');
const weights=[...block[1].matchAll(/chance:(\d+)/g)].map((m)=>Number(m[1]));
assert.ok(weights.length>=2,'Rad weights missing');
const total=weights.reduce((sum,n)=>sum+n,0);
assert.ok(total>0,'Rad total weight must be positive');
assert.match(rad,/function chancePct\(seg\)\{ return \(Number\(seg\?\.chance\|\|0\)\/totalChance\(\)\)\*100; \}/,'Rad must calculate displayed probability from normalized wheel weight');
assert.match(rad,/function chanceLabel\(seg\)\{ return chancePct\(seg\)\.toLocaleString\('nl-NL',\{minimumFractionDigits:1,maximumFractionDigits:1\}\)\+'%'; \}/,'Rad must use the normalized Dutch probability label');
assert.doesNotMatch(rad,/` \(\$\{seg\.chance\}%\)`/,'Rad canvas must not label raw weights as percentages');
assert.doesNotMatch(rad,/Kans: \$\{seg\.chance\}%/,'Rad result must not label raw weights as percentages');
assert.doesNotMatch(rad,/<strong>\$\{seg\.chance\}%<\/strong>/,'Rad legend must not label raw weights as percentages');
assert.match(rad,/chanceLabel\(seg\)/,'Rad must surface normalized probability labels');
const normalized=weights.map((w)=>w/total*100);
const sum=normalized.reduce((a,b)=>a+b,0);
assert.ok(Math.abs(sum-100)<1e-9,`Rad normalized probabilities must sum to 100%, got ${sum}`);
console.log(`Rad probability validity PASS: ${weights.length} segments, raw weight total ${total}, displayed probabilities normalized to 100%.`);
