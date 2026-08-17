#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version = fs.readFileSync('VERSION','utf8').trim();
const versionNumber = Number(version.match(/^v(\d+)$/)?.[1] || 0);
assert(versionNumber >= 804, `v804 idempotent-boot regression requires v804+, got ${version}`);

const source = fs.readFileSync('gejast-v725-repair.js','utf8');
assert(source.includes('if(window.__gejastV725PikkenPagePatched) return; window.__gejastV725PikkenPagePatched=true;'), 'Pikken page compatibility patch must be one-shot');
assert(source.includes('if(window.__gejastV725PaardenracePagePatched) return; window.__gejastV725PaardenracePagePatched=true;'), 'Paardenrace page compatibility patch must be one-shot');
assert(source.includes('let booted=false;'), 'v725 compatibility boot must have a local one-shot state');
assert(/function boot\(\)\{ if\(booted\) return; booted=true;/.test(source), 'v725 compatibility boot must return after first initialization');
assert(source.includes('ready(boot);'), 'v725 compatibility boot must still initialize when DOM is ready');
assert(!/setInterval\(\(\)=>\{\s*boot\(\)/.test(source), 'v725 compatibility boot must not be re-run by an interval');
assert(source.includes('window.__gejastV725PaardenraceMonitorTimer=setInterval'), 'Paardenrace compatibility monitor must have one global timer owner');
assert(/__gejastV725PaardenraceMonitorTimer=setInterval\(\(\)=>\{ if\(!document\.hidden\) monitorPaardenraceLive\(\); \},2500\)/.test(source), 'Paardenrace compatibility monitor cadence must remain 2500ms');
assert(/__gejastV725PikkenFeedTimer[^\n]*setInterval\(\(\)=>\{ if\(!document\.hidden\) refreshPikkenFeeds\(\);\},2500\)/.test(source), 'Pikken compatibility feed cadence must remain 2500ms');
assert(!/ready\(boot\);\s*setInterval\(\(\)=>\{ boot\(\);/.test(source), 'legacy one-second boot loop must stay removed');

console.log(`PASS v804 v725 idempotent boot contract at ${version}`);
