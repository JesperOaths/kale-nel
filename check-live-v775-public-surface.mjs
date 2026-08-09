#!/usr/bin/env node

const base=process.env.GEJAST_LIVE_BASE_URL||'https://kalenel.nl';
const adminBase=process.env.GEJAST_ADMIN_BASE_URL||'https://admin.kalenel.nl';
const timeoutMs=Number(process.env.GEJAST_SMOKE_TIMEOUT_MS||15000);
const waitSeconds=Math.max(0,Number(process.env.GEJAST_DEPLOY_WAIT_SECONDS||120));
const cb=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const failures=[];
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function get(path,redirect='manual'){
  const u=new URL(path,base);u.searchParams.set('cb',cb);
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);
  try{const r=await fetch(u,{cache:'no-store',redirect,signal:c.signal});const text=await r.text();return{status:r.status,text,url:u.toString(),location:r.headers.get('location')||''};}finally{clearTimeout(t);}
}
async function waitVersion(){const end=Date.now()+waitSeconds*1000;let last='';do{try{const r=await get('/VERSION','follow');last=r.text.trim();console.log(`/VERSION HTTP ${r.status}; body=${JSON.stringify(last)}`);if(r.status===200&&last==='v775')return;}catch(e){console.warn(String(e?.message||e));}if(Date.now()>=end)break;await sleep(5000);}while(true);failures.push(`expected live v775, got ${JSON.stringify(last)}`);}
async function chain(path){let url=new URL(path,base);url.searchParams.set('cb',cb);const out=[];for(let i=0;i<5;i++){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{cache:'no-store',redirect:'manual',signal:c.signal});out.push({status:r.status,url:url.toString()});const loc=r.headers.get('location');if(r.status>=300&&r.status<400&&loc){url=new URL(loc,url);continue;}return{terminal:r.status,url:url.toString(),chain:out};}finally{clearTimeout(t);}}return{terminal:0,url:url.toString(),chain:out};}
await waitVersion();
for(const path of ['/geo_diagnostics.html','/push_beta_test.html']){
  const r=await get(path,'follow');console.log(`${path} terminal HTTP ${r.status}`);if(r.status<400)failures.push(`${path} still publicly serves HTTP ${r.status}`);
}
const admin=await chain('/admin_push_targeted_test.html');
console.log(`admin targeted chain=${admin.chain.map(x=>x.status+' '+x.url).join(' -> ')}`);
if(admin.chain[0]?.status!==302)failures.push(`admin targeted apex expected 302, got ${admin.chain[0]?.status}`);
if(!admin.chain.some(x=>x.url.startsWith(adminBase)))failures.push('admin targeted tool did not route into admin host');
if(admin.terminal!==401)failures.push(`admin targeted unauthenticated terminal expected 401, got ${admin.terminal}`);
const drinks=await get('/drinks_pending.html?push_test=targeted','follow');
console.log(`/drinks_pending.html?push_test=targeted HTTP ${drinks.status}; bytes=${drinks.text.length}`);
if(drinks.status!==200)failures.push(`normal Drinks verification target expected HTTP 200, got ${drinks.status}`);
const compat=await get('/despimarkt_force.html','follow');
console.log(`/despimarkt_force.html HTTP ${compat.status}; bytes=${compat.text.length}`);
if(compat.status!==200||!compat.text.includes("target.searchParams.set('focus', 'nomination')"))failures.push('Despimarkt nomination compatibility redirect is not deployed intact');
if(failures.length){console.error(`v775 public surface edge proof FAILED (${failures.length})`);failures.forEach(f=>console.error('- '+f));process.exit(1);}
console.log('v775 public surface edge proof PASS: removed consoles are unavailable, targeted push stays admin-gated, normal Drinks target is healthy, and nomination compatibility redirect remains intact.');
