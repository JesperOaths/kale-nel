#!/usr/bin/env node
import fs from 'node:fs';
import vm from 'node:vm';

const failures=[];
const context=vm.createContext({ console, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync('gejast-badges.js','utf8'),context,{filename:'gejast-badges.js'});
vm.runInContext(fs.readFileSync('gejast-badge-progress.js','utf8'),context,{filename:'gejast-badge-progress.js'});
const badges=context.GEJAST_BADGES;
const progress=context.GEJAST_BADGE_PROGRESS;
if(!badges||typeof badges.evaluateBadgeKeys!=='function') failures.push('GEJAST_BADGES.evaluateBadgeKeys unavailable');
if(!progress||typeof progress.getBadgeProgressList!=='function') failures.push('GEJAST_BADGE_PROGRESS.getBadgeProgressList unavailable');

function has(snapshot,key){return new Set(badges.evaluateBadgeKeys(snapshot)).has(key);}
function expect(value,label){if(!value) failures.push(label);}

if(badges&&progress){
  expect(!has({total_matches:0,drink_events:0,speed_record_count:0},'starter'),'starter must be locked at zero activity');
  expect(has({total_matches:1},'starter'),'starter must unlock at one match');
  expect(!has({total_matches:4,drink_events:9},'groeier'),'groeier must be locked below both thresholds');
  expect(has({total_matches:5},'groeier'),'groeier must unlock at five matches');
  expect(has({drink_events:10},'groeier'),'groeier must unlock at ten drink events');
  expect(!has({klaverjas_wins:19},'klaverkoning'),'klaverkoning must be locked at 19 wins');
  expect(has({klaverjas_wins:20},'klaverkoning'),'klaverkoning must unlock at 20 wins');
  expect(!has({ice_best_seconds:25},'ijskoud'),'ijskoud must require strictly under 25 seconds');
  expect(has({ice_best_seconds:24.9},'ijskoud'),'ijskoud must unlock below 25 seconds');
  expect(!has({verification_votes_accepted:19},'verifieermeester'),'verifieermeester must be locked at 19 accepted votes');
  expect(has({verification_votes_accepted:20},'verifieermeester'),'verifieermeester must unlock at 20 accepted votes');
  expect(!has({beerpong_matches:9,pussycup_pct:30},'pussycup_prins'),'pussycup-prins must require ten beerpong matches');
  expect(!has({beerpong_matches:10,pussycup_pct:24.9},'pussycup_prins'),'pussycup-prins must require at least 25 percent pussycup');
  expect(has({beerpong_matches:10,pussycup_pct:25},'pussycup_prins'),'pussycup-prins must unlock at both thresholds');

  const list=progress.getBadgeProgressList({total_matches:5});
  const groeier=list.find((item)=>item.key==='groeier');
  expect(!!groeier,'progress list must contain groeier');
  expect(groeier?.attained===true,'progress list must mark derived groeier attained');
  expect(Number(groeier?.progressRatio)===1,'attained groeier progress must be complete');
}

const player=fs.readFileSync('player.html','utf8');
const profiles=fs.readFileSync('profiles.html','utf8');
for(const marker of [
  './gejast-badges.js?v772',
  './gejast-badge-progress.js?v772',
  'function buildBadgeSnapshot()',
  'window.GEJAST_BADGE_PROGRESS.getBadgeProgressList(buildBadgeSnapshot())',
  'progressList.filter((badge) => badge.attained)'
]) if(!player.includes(marker)) failures.push(`player.html missing badge integration marker: ${marker}`);
for(const marker of ['./gejast-badges.js?v772','./gejast-badge-progress.js?v772','badgeGalleryPanel']) if(!profiles.includes(marker)) failures.push(`profiles.html missing badge gallery marker: ${marker}`);

const badgeSource=fs.readFileSync('gejast-badges.js','utf8');
for(const forbidden of ['award_badge','grant_badge','insert_badge','save_badge_award']) if(new RegExp(forbidden,'i').test(badgeSource)) failures.push(`badge evaluator unexpectedly contains mutation primitive ${forbidden}`);

if(failures.length){
  console.error('Derived badge contract v771b FAILED');
  failures.forEach((failure)=>console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Derived badge contract v771b PASS: thresholds, attained progress, and live profile integration are deterministic from existing stats; no badge-award mutation primitive is present.');
