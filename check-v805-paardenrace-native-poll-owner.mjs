#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert(n>=805,`v805 Paardenrace native poll regression requires v805+, got ${version}`);
const compat=fs.readFileSync('gejast-v725-repair.js','utf8');
const live=fs.readFileSync('paardenrace_live.html','utf8');
assert(!compat.includes('monitorPaardenraceLive'),'legacy v725 Paardenrace room-state monitor must stay removed');
assert(!compat.includes('__gejastV725PaardenraceMonitorTimer'),'legacy v725 Paardenrace monitor timer must stay removed');
assert(live.includes('loadState({ noAutoClose:true }).then(()=>{'),'native Paardenrace live page must retain its immediate state load');
assert(/statePollTimer = setInterval\(async \(\)=>\{[\s\S]*?\}, 1800\);/.test(live),'native Paardenrace live page must retain its 1800ms state poll');
assert(live.includes("['countdown','race','nominations','live','active'].includes(liveStage) && livePlayers.length < 2"),'native live-page insufficient-player guard must stay present');
assert(live.includes("bounceToLobby('Deze race heeft te weinig actieve spelers en is gesloten. Je gaat terug naar de lobby.');"),'native live-page stale/undersized race recovery must stay present');
console.log(`PASS v805 Paardenrace native state-poll ownership at ${version}`);
