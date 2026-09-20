#!/usr/bin/env node
import fs from 'node:fs';

const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
const action=String(process.argv[2]||'').trim();
const force=String(process.env.FORCE_RUN||'false').toLowerCase()==='true';

if(!base||!key) throw new Error('Missing Supabase runtime secrets');
if(!action) throw new Error('Missing shop operations action');

async function mint(){
  const r=await fetch(base+'/rest/v1/rpc/shop_ops_mint_scheduler_token_v847',{
    method:'POST',
    headers:{Authorization:'Bearer '+key,apikey:key,'Content-Type':'application/json'},
    body:'{}'
  });
  const raw=await r.text();
  if(!r.ok) throw new Error('Could not mint scheduler token: HTTP '+r.status+' '+raw.slice(0,180));
  let token;
  try{token=JSON.parse(raw)}catch{}
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Malformed scheduler token');
  return token;
}

async function call(){
  const token=await mint();
  const payload={action};
  if(action==='plan'||action==='run_backup') payload.force=force;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),170000);
  try{
    const r=await fetch(base+'/functions/v1/shop-ops-v847',{
      method:'POST',
      signal:controller.signal,
      headers:{apikey:key,'x-shop-ops-token':token,'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const raw=await r.text();
    let body={};try{body=JSON.parse(raw)}catch{}
    if(!r.ok||body?.ok!==true) throw new Error('shop-ops '+action+' failed: HTTP '+r.status+' '+String(body?.detail||body?.error||raw).slice(0,300));
    return body;
  }finally{
    clearTimeout(timer);
  }
}

const body=await call();
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
