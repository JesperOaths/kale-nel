#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
const action=String(process.argv[2]||'').trim();
const force=String(process.env.FORCE_RUN||'false').toLowerCase()==='true';

if(!base||!key) throw new Error('Missing Supabase runtime secrets');
if(!action) throw new Error('Missing shop operations action');

function curlJson(args,timeoutMs){
  const r=spawnSync('curl',args,{encoding:'utf8',timeout:timeoutMs,maxBuffer:16*1024*1024});
  if(r.error) throw r.error;
  if(r.status!==0) throw new Error('curl failed ('+r.status+'): '+String(r.stderr||'').slice(0,300));
  let body={};try{body=JSON.parse(r.stdout)}catch{}
  return body;
}

function mint(){
  const body=curlJson([
    '--silent','--show-error','--fail-with-body','--max-time','45',
    '-X','POST',base+'/rest/v1/rpc/shop_ops_mint_scheduler_token_v847',
    '-H','Authorization: Bearer '+key,
    '-H','apikey: '+key,
    '-H','Content-Type: application/json',
    '--data','{}'
  ],50000);
  if(typeof body!=='string'||!/^[a-f0-9]{64}$/i.test(body)) throw new Error('Malformed scheduler token');
  return body;
}

function call(){
  const token=mint();
  const payload={action};
  if(action==='plan'||action==='run_backup') payload.force=force;
  const body=curlJson([
    '--silent','--show-error','--fail-with-body','--max-time','165',
    '-X','POST',base+'/functions/v1/shop-ops-v847',
    '-H','apikey: '+key,
    '-H','x-shop-ops-token: '+token,
    '-H','Content-Type: application/json',
    '--data',JSON.stringify(payload)
  ],170000);
  if(body?.ok!==true) throw new Error('shop-ops '+action+' failed: '+String(body?.detail||body?.error||'unknown').slice(0,300));
  return body;
}

const body=call();
const result=body?.result||{};
const safe={action,ok:true};
if(action==='plan'){
  for(const k of ['costs','catalog','orders','backup','daily_brief','weekly_brief']) safe[k]=result[k]===true;
  safe.local_hour=result.local_hour??null;
  safe.local_date=result.local_date??null;
  if(process.env.GITHUB_OUTPUT){
    for(const k of ['costs','catalog','orders','backup','daily_brief','weekly_brief']) fs.appendFileSync(process.env.GITHUB_OUTPUT,k+'='+(result[k]===true?'true':'false')+'\n');
  }
}else if(action==='run_backup'){
  safe.backup_id=result?.id||null;
  safe.created_at=result?.created_at||null;
  if(process.env.GITHUB_OUTPUT&&safe.backup_id) fs.appendFileSync(process.env.GITHUB_OUTPUT,'backup_id='+safe.backup_id+'\n');
}else if(action==='run_costs'){
  safe.duration_ms=result?.refresh?.duration_ms??null;
  safe.new_alerts=(result?.new_alerts||[]).length;
}else if(action==='run_catalog'){
  safe.products=result?.products??null;
  safe.changes=result?.changes??null;
  safe.new_alerts=(result?.new_alerts||[]).length;
}else if(action==='run_orders'){
  safe.orders_checked=result?.orders_checked??null;
  safe.new_alerts=(result?.new_alerts||[]).length;
}else{
  safe.generated_at=result?.generated_at||null;
}
console.log('shop-ops-v847',JSON.stringify(safe));
