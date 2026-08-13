#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rad=fs.readFileSync('rad.html','utf8');
const segmentBlock=rad.match(/const SEGMENTS = \[([\s\S]*?)\n  \];/);
assert.ok(segmentBlock,'Rad SEGMENTS owner missing');
const weights=[...segmentBlock[1].matchAll(/chance:(\d+)/g)].map((m)=>Number(m[1]));
assert.ok(weights.length>=2,'Rad probability weights missing');
const total=weights.reduce((sum,n)=>sum+n,0);
assert.equal(total,100,`Rad labels each weight as a percentage, but displayed weights total ${total}% instead of 100%`);
console.log(`v791 game validity matrix PASS: Rad displayed probabilities total ${total}%.`);
