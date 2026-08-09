#!/usr/bin/env node

const base=process.env.GEJAST_LIVE_BASE_URL||'https://kalenel.nl';
const timeoutMs=Number(process.env.GEJAST_SMOKE_TIMEOUT_MS||15000);
const waitSeconds=Math.max(0,Number(process.env.GEJAST_DEPLOY_WAIT_SECONDS||120));
const failures=[];
const cb=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function fetchText(path){
  const u=new URL(path,base);u.searchParams.set('cb',cb);
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);
  try{const r=await fetch(u,{cache:'no-store',redirect:'follow',signal:c.signal});const text=await r.text();console.log(`${path} HTTP ${r.status}; bytes=${text.length}`);return{status:r.status,text,url:r.url};}
  finally{clearTimeout(t);}
}
async function waitVersion(){
  const end=Date.now()+waitSeconds*1000;let last='';
  do{try{const r=await fetchText('/VERSION');last=r.text.trim();if(r.status===200&&last==='v774')return;}catch(e){console.warn('VERSION probe:',e.message||String(e));}
    if(Date.now()>=end)break;await sleep(5000);
  }while(true);
  failures.push(`expected live VERSION v774, got ${JSON.stringify(last)}`);
}
await waitVersion();
const login=await fetchText('/login.html');
if(login.status!==200)failures.push(`login HTTP ${login.status}`);
if(!login.text.includes('Kies je naam en voer je 4-cijferige pincode in.'))failures.push('login missing concise production copy');
for(const marker of ['v689 actieve-login bron','selector-fallback','nieuwere RPC nog niet is uitgerold'])if(login.text.includes(marker))failures.push(`login still exposes ${marker}`);

const beer=await fetchText('/beerpong.html');
if(beer.status!==200)failures.push(`beerpong HTTP ${beer.status}`);
if(!beer.text.includes("Promise.resolve(sb.rpc('get_beerpong_pussycup_ranking_public')).catch("))failures.push('deployed Beerpong missing Promise.resolve optional RPC fix');
if(beer.text.includes("sb.rpc('get_beerpong_pussycup_ranking_public').catch("))failures.push('deployed Beerpong still has direct RPC-builder catch');

const analytics=await fetchText('/site-analytics.js');
if(analytics.status!==200)failures.push(`site-analytics HTTP ${analytics.status}`);
if(!analytics.text.includes('sameOrigin && navigator.sendBeacon'))failures.push('deployed analytics missing same-origin Beacon gate');
if(!analytics.text.includes('return fetch(endpoint, {'))failures.push('deployed analytics missing keepalive fetch path');
if(!analytics.text.includes('const endpoint = `${SUPABASE_URL}/rest/v1/rpc/track_site_event`;'))failures.push('deployed analytics missing canonical endpoint');

if(failures.length){console.error(`v774 public edge acceptance FAILED (${failures.length})`);failures.forEach(f=>console.error('- '+f));process.exit(1);}
console.log('v774 public edge acceptance PASS: live release, Beerpong promise handling, analytics transport, and production login copy are deployed.');
