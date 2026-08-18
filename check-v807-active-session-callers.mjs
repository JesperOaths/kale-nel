#!/usr/bin/env node
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\d+)$/)?.[1]||0);
if(n<807) throw new Error(`Expected v807+, got ${version}`);
const analytics=fs.readFileSync('site-analytics.js','utf8');
const ui=fs.readFileSync('gejast-player-session-ui.js','utf8');
const scorer=fs.readFileSync('scorer.html','utf8');
const failures=[];
function between(text,a,b){const i=text.indexOf(a);const j=text.indexOf(b,i+a.length);if(i<0||j<0)throw new Error(`missing block ${a}`);return text.slice(i,j);}
const analyticsBlock=between(analytics,'  async function resolveProfile(){','\n  const visitorId');
const uiBlock=between(ui,'  async function fetchViewer(token){','  async function fetchCoins(token){');
const scorerBlock=between(scorer,'  async function fetchMyName(token){','  function show(');
for(const [label,block] of [['site-analytics resolveProfile',analyticsBlock],['player-session-ui fetchViewer',uiBlock],['scorer fetchMyName',scorerBlock]]){
  if(block.includes('get_public_state')) failures.push(`${label} still calls get_public_state`);
  if(block.includes('get_gejast_homepage_state')) failures.push(`${label} still calls get_gejast_homepage_state`);
  if(block.includes('get_jas_app_state')) failures.push(`${label} still calls get_jas_app_state`);
  if(!block.includes('account_public_state_v687')) failures.push(`${label} missing canonical account_public_state_v687`);
  if(!block.includes('session_token_input')) failures.push(`${label} missing canonical token payload`);
  if(!block.includes('site_scope_input')) failures.push(`${label} missing scope payload`);
}
if(failures.length){console.error('v807 active stale-session probe regression failed:');for(const f of failures)console.error('- '+f);process.exit(1);}
console.log('PASS v807 active session callers use only canonical account_public_state_v687');
