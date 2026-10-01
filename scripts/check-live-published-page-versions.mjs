#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  expectedPageVersion,
  listPublishedHtml,
  pageVersionDeclarations,
  readRootVersion,
} from './published-page-inventory.mjs';

const root=process.cwd();
const base=String(process.env.GEJAST_BASE_URL||'https://kalenel.nl/').replace(/\/+$/,'')+'/';
const rootVersion=readRootVersion(root);
const pages=listPublishedHtml(root);
const concurrency=Math.max(1,Math.min(24,Number(process.env.GEJAST_LIVE_VERSION_CONCURRENCY||12)));
const timeoutMs=Math.max(3000,Number(process.env.GEJAST_LIVE_VERSION_TIMEOUT_MS||15000));
const results=new Array(pages.length);
let next=0;

function literalWatermark(body,expected){
  return new RegExp('>\\s*'+expected+'\\s*[^<]{0,24}Made by Bruis\\s*<','i').test(body);
}
function dynamicWatermark(body){
  return /data-version-watermark/i.test(body)&&/applyVersionLabel|gejast-version-sync-inline/i.test(body);
}
function cacheBustedUrl(rel,index){
  const u=new URL(rel.replace(/^\/+/,''),base);
  u.searchParams.set('__version_audit',String(Date.now())+'_'+String(index));
  return u.toString();
}
async function fetchPage(rel,index){
  const source=fs.readFileSync(path.join(root,rel),'utf8');
  const expected=expectedPageVersion(rel,rootVersion,source);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(cacheBustedUrl(rel,index),{
      redirect:'follow',
      cache:'no-store',
      signal:controller.signal,
      headers:{
        'accept':'text/html,application/xhtml+xml',
        'cache-control':'no-cache',
        'pragma':'no-cache',
        'user-agent':'Kalenel-Published-Version-Audit/1.0',
      },
    });
    const text=await res.text();
    let finalHost='';
    try{ finalHost=new URL(res.url).hostname.toLowerCase(); }catch{}
    if((res.status===401||res.status===403)&&finalHost==='admin.kalenel.nl'){
      return {rel,expected,status:res.status,final_url:res.url,state:'protected'};
    }
    if(!res.ok){
      return {rel,expected,status:res.status,final_url:res.url,state:'fail',reason:'HTTP '+res.status};
    }
    const declarations=[...new Set(pageVersionDeclarations(text))];
    if(declarations.length!==1||declarations[0]!==expected){
      return {rel,expected,status:res.status,final_url:res.url,state:'fail',reason:'declaration '+(declarations.join('|')||'missing')};
    }
    if(!literalWatermark(text,expected)&&!dynamicWatermark(text)){
      return {rel,expected,status:res.status,final_url:res.url,state:'fail',reason:'watermark owner missing/wrong'};
    }
    return {rel,expected,status:res.status,final_url:res.url,state:'pass'};
  }catch(error){
    return {rel,expected,status:0,final_url:'',state:'fail',reason:String(error?.name||error)+': '+String(error?.message||'')};
  }finally{
    clearTimeout(timer);
  }
}

async function worker(){
  for(;;){
    const index=next++;
    if(index>=pages.length) return;
    results[index]=await fetchPage(pages[index],index);
  }
}
await Promise.all(Array.from({length:Math.min(concurrency,pages.length)},()=>worker()));

const failures=results.filter(r=>r.state==='fail');
const protectedRows=results.filter(r=>r.state==='protected');
for(const row of results){
  console.log(`LIVE_PAGE_VERSION ${row.state.toUpperCase()} ${row.rel} expected=${row.expected} http=${row.status} final=${row.final_url}${row.reason?' reason='+row.reason:''}`);
}
console.log(`LIVE_PAGE_VERSION_SUMMARY pages=${pages.length} pass=${results.filter(r=>r.state==='pass').length} protected=${protectedRows.length} fail=${failures.length} root=${rootVersion}`);
if(failures.length){
  console.error('LIVE_PAGE_VERSION_FAILURES');
  for(const row of failures) console.error(`${row.rel}: ${row.reason||'unknown'} (HTTP ${row.status}, ${row.final_url||'no final URL'})`);
  process.exit(1);
}
console.log('RESULT=ALL_LIVE_PUBLISHED_PAGE_VERSION_INTEGRITY_PASS');
