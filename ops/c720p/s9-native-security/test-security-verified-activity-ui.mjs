#!/usr/bin/env node
// Verified Security report contract and data-only Evidence & Analytics rendering.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('./security-review-v8.html',import.meta.url),'utf8');
assert.match(source,/r\.fetch\('\/new\/api\/security-recording-activity',\{cache:'no-store'\}\)/);
assert.match(source,/verifiedDayBars/);
assert.match(source,/06:00/);
assert.match(source,/v817 - Made by Bruis/);
const begin=source.indexOf('function validateVerifiedActivity(raw){');
const end=source.indexOf('function selectedAnalyticsClips(){',begin);
assert.ok(begin>0&&end>begin,'verified renderer must be embedded in deployed source');
class Element{
 constructor(){this.style={};this.children=[];this.textContent='';this.classList={toggle:()=>{}};}
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.children=nodes}
 setAttribute(k,v){this[k]=v}
}
const elements={};const $=id=>elements[id]||(elements[id]=new Element());
const text=(tag,value='',className='')=>{const x=new Element();x.tag=tag;x.className=className;x.textContent=value;return x};
const state={all:[]};
const {validateVerifiedActivity,drawVerifiedActivity}=new Function('text','$','state',
 source.slice(begin,end)+'\nreturn {validateVerifiedActivity,drawVerifiedActivity};')(text,$,state);
function report(){
 const hours={},days={};
 for(let i=0;i<24;i++)hours[String(i).padStart(2,'0')]={
  s9_microSD:i===5?178:0,historical_drive:i===5?94:0,combined:i===5?272:0};
 for(let i=1;i<=28;i++)days['2026-09-'+String(i).padStart(2,'0')]={
  s9_microSD:i===1?178:0,historical_drive:i===1?94:0,combined:i===1?272:0};
 return {ok:true,schema_version:'security_s9_drive_activity_v1',timezone:'Europe/Amsterdam',
  operating_day_start_local:'06:00',s3_included:false,recordings_not_people:true,
  media_decoded:false,video_bytes_transferred:false,
  source_recordings:{s9_microSD:178,historical_drive_verified_new:94},
  total_recordings:272,historical_drive_timestamp_unknown:0,
  local_wall_clock_hours:hours,operating_days:days};
}
const valid=validateVerifiedActivity(report());
drawVerifiedActivity(valid);
assert.deepEqual([valid.total,valid.sd,valid.drive,valid.days.length],[272,178,94,28]);
assert.deepEqual([elements.verifiedTotal.textContent,elements.verifiedSd.textContent,
 elements.verifiedDrive.textContent,elements.verifiedDays.textContent],['272','178','94','28']);
assert.equal(elements.verifiedHours.children.length,24);
assert.equal(elements.verifiedDayBars.children.length,28);
function reject(mutate,label){
 const row=report();mutate(row);
 assert.throws(()=>validateVerifiedActivity(row),undefined,label);
}
reject(x=>x.s3_included=true,'S3 must be excluded');
reject(x=>x.recordings_not_people=false,'recording-not-person contract');
reject(x=>x.total_recordings=272.5,'no fractional totals');
reject(x=>x.total_recordings=273,'source reconciliation');
reject(x=>delete x.local_wall_clock_hours['07'],'all 24 local hours');
reject(x=>x.local_wall_clock_hours['05'].combined=273,'hourly source sums');
reject(x=>x.operating_days['2026-09-01'].historical_drive=90,'daily source sums');
reject(x=>x.historical_drive_timestamp_unknown=95,'unknown timestamps bounded');
reject(x=>x.operating_days['2026-09-35']=x.operating_days['2026-09-01'],'invalid calendar day');
const uncertain=report();
uncertain.historical_drive_timestamp_unknown=2;
uncertain.local_wall_clock_hours['05']={s9_microSD:178,historical_drive:92,combined:270};
uncertain.operating_days['2026-09-01']={s9_microSD:178,historical_drive:92,combined:270};
drawVerifiedActivity(validateVerifiedActivity(uncertain));
assert.match(elements.verifiedNote.textContent,/2 historical Drive recordings/);
state.all=Array.from({length:2},()=>({source:'sd'}));
drawVerifiedActivity(valid);
assert.match(elements.verifiedNote.textContent,/Clip-index coverage differs/);
drawVerifiedActivity(null,'offline');
assert.equal(elements.verifiedTotal.textContent,'—');
assert.equal(elements.verifiedHours.children.length,0);
assert.match(elements.verifiedStatus.textContent,/unavailable/);
console.log('SECURITY_VERIFIED_ACTIVITY_UI_10_CASES_PASS');
