#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const config = fs.readFileSync('gejast-config.js','utf8');
const url = config.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
const key = config.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
if (!url || !key) throw new Error('Could not resolve public Supabase config.');
const headers = { apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', Accept:'application/json' };

function walk(dir, out=[]){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(entry.name==='.git'||entry.name==='node_modules') continue;
    const p=path.join(dir,entry.name);
    if(entry.isDirectory()) walk(p,out); else out.push(p);
  }
  return out;
}
const allFiles = walk('.');

const rpcNames = [
  'get_live_match_summary_public_scoped',
  'get_live_match_summary_public',
  'get_homepage_live_state_public_scoped',
  'get_homepage_live_state_public',
  'get_ballroom_state_safe',
  'get_ballroom_public_state_safe',
  'get_ballroom_state',
  'get_ballroom_public_state',
  'ballroom_claim_king_safe',
  'ballroom_request_entry_safe',
  'ballroom_resolve_request_safe',
  'ballroom_abdicate_safe',
  'ballroom_claim_king',
  'ballroom_request_entry',
  'ballroom_resolve_request',
  'ballroom_abdicate',
];

console.log('## Local SQL definition tracing');
for(const name of rpcNames){
  const defs=[];
  for(const file of allFiles){
    const rel=file.replace(/^\.\//,'').replaceAll('\\','/');
    if(!/\.sql$/i.test(rel)) continue;
    const text=fs.readFileSync(file,'utf8');
    if(text.includes(name)) defs.push(rel);
  }
  console.log(`${name}=${defs.length ? defs.join(',') : 'NO_SQL_REFERENCE'}`);
}

async function readProbe(name, body){
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method:'POST', headers, body:JSON.stringify(body||{}) });
  const text = await res.text();
  const concise = text.replace(/\s+/g,' ').slice(0,360);
  const missing = res.status===404 || /could not find the function|function .* does not exist|schema cache/i.test(concise);
  console.log(`READ_PROBE ${name} HTTP=${res.status} MISSING=${missing} BODY=${concise}`);
  return {status:res.status,missing,text};
}

console.log('\n## Read-only production RPC probes');
await readProbe('get_live_match_summary_public_scoped', {
  game_type_input:'klaverjas',
  match_ref_input:'__v770_missing_probe__',
  client_match_id_input:'__v770_missing_probe__',
  site_scope_input:'friends'
});
await readProbe('get_live_match_summary_public', {
  game_type_input:'klaverjas',
  match_ref_input:'__v770_missing_probe__',
  client_match_id_input:'__v770_missing_probe__'
});
await readProbe('get_homepage_live_state_public_scoped', { session_token:null, site_scope_input:'friends' });
await readProbe('get_homepage_live_state_public', { session_token:null });
let ballroomRead = await readProbe('get_ballroom_state_safe', { session_token:null, session_token_input:null });
if(ballroomRead.missing || ballroomRead.status===400){
  ballroomRead = await readProbe('get_ballroom_state_safe', { session_token_input:null });
}
if(ballroomRead.missing){
  await readProbe('get_ballroom_public_state_safe', { session_token_input:null });
}

const refNeedle='gejast-beurs.js';
const refs=[];
for(const file of allFiles){
  const rel=file.replace(/^\.\//,'').replaceAll('\\','/');
  if(rel==='gejast-beurs.js'||rel.startsWith('scripts/')||rel.startsWith('.github/')) continue;
  if(!/\.(?:html|js|css|json|md)$/i.test(rel)) continue;
  const text=fs.readFileSync(file,'utf8');
  if(text.includes(refNeedle)) refs.push(rel);
}
console.log(`\nGEJAST_BEURS_REFERENCE_COUNT=${refs.length}`);
refs.forEach((ref)=>console.log(`GEJAST_BEURS_REF=${ref}`));

const beurs = fs.readFileSync('beurs.html','utf8');
const marketRuntime = fs.readFileSync('gejast-despimarkt.js','utf8');
console.log(`BEURS_USES_DESPIMARKT_RUNTIME=${beurs.includes('gejast-despimarkt.js')}`);
console.log(`DESPIMARKT_HAS_CREATE_MARKET=${marketRuntime.includes('async function createMarket')}`);
console.log(`DESPIMARKT_HAS_BUY_POSITION=${marketRuntime.includes('async function buyPosition')}`);
console.log(`DESPIMARKT_HAS_ADMIN_RESOLVE=${marketRuntime.includes('async function adminResolve')}`);

const ballroom=fs.readFileSync('ballroom.html','utf8');
const legacyNameOccurrences=(ballroom.match(/legacyName/g)||[]).length;
console.log(`\nBALLROOM_LEGACY_NAME_OCCURRENCES=${legacyNameOccurrences}`);
console.log(`BALLROOM_REPAIR_SQL_COPY=${ballroom.includes('Run eerst de balzaal-repair SQL.')}`);
console.log(`LIVE_SUMMARY_V488_COPY=${fs.readFileSync('gejast-live-summary.js','utf8').includes('Draai eerst de v488 compat SQL.')}`);
