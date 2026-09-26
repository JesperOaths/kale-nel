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

function mintOnce(){
  const body=curlJson([
    '--silent','--show-error','--fail-with-body','--max-time','45',
    '-X','POST',base+'/rest/v1/rpc/shop_ops_mint_scheduler_token_v858',
    '-H','Authorization: Bearer '+key,
    '-H','apikey: '+key,
    '-H','Content-Type: application/json',
    '--data',JSON.stringify({source_input:'github_actions'})
  ],50000);
  if(typeof body!=='string'||!/^[a-f0-9]{64}$/i.test(body)) throw new Error('Malformed scheduler token');
  return body;
}
function mint(){
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{return mintOnce();}
    catch(error){
      lastError=error;
      const message=String(error?.message||error);
      const transient=/curl failed \(28\)|\b(?:408|425|429|500|502|503|504|520|522|523|524)\b|timed? out|timeout|temporarily unavailable|connection reset|empty reply/i.test(message);
      if(!transient||attempt===3)throw error;
      const delaySeconds=attempt===1?2:5;
      console.warn('Transient scheduler-token mint failure; retrying',JSON.stringify({attempt,next_attempt:attempt+1,delay_seconds:delaySeconds}));
      spawnSync('sleep',[String(delaySeconds)],{encoding:'utf8',timeout:(delaySeconds+1)*1000});
    }
  }
  throw lastError||new Error('Scheduler token mint failed');
}

function exportSelfTest(){
  const token=mint();
  const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);
  const body=curlJson([
    '--silent','--show-error','--fail-with-body','--max-time','90',
    '-X','POST',base+'/functions/v1/shop-admin-export-v847',
    '-H','apikey: '+key,
    '-H','x-shop-ops-token: '+token,
    '-H','Content-Type: application/json',
    '--data',JSON.stringify({action:'self_test',month})
  ],95000);
  if(body?.ok!==true||body?.self_test!==true||body?.valid_xlsx_header!==true||!(Number(body?.byte_size)>1000)){
    throw new Error('XLSX self-test failed: '+JSON.stringify(body).slice(0,400));
  }
  console.log('xlsx-self-test',JSON.stringify({byte_size:body.byte_size,counts:body.counts}));
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

if(action==='export_self_test'){
  exportSelfTest();
  process.exit(0);
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
