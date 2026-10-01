#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  expectedPageVersion,
  listPublishedRoutes,
  pageVersionDeclarations,
  readAdminWorkerVersion,
  readRootVersion,
} from './published-page-inventory.mjs';

const root=process.cwd();
const base=String(process.env.GEJAST_BASE_URL||'https://kalenel.nl/').replace(/\/+$/,'')+'/';
const rootVersion=readRootVersion(root);
const adminWorker=readAdminWorkerVersion(root);
if(!/^v\d+$/i.test(adminWorker.pageVersion)||!adminWorker.build){
  throw new Error('Could not resolve admin Worker visible page version/build');
}
if(adminWorker.pageVersion!==rootVersion){
  throw new Error(`Admin Worker visible page version ${adminWorker.pageVersion} must equal root VERSION ${rootVersion}`);
}
const routes=listPublishedRoutes(root);
const concurrency=Math.max(1,Math.min(24,Number(process.env.GEJAST_LIVE_VERSION_CONCURRENCY||12)));
const timeoutMs=Math.max(3000,Number(process.env.GEJAST_LIVE_VERSION_TIMEOUT_MS||15000));
const maxRedirects=8;
const results=new Array(routes.length);
let next=0;

function literalWatermark(body,expected){
  return new RegExp('>\\s*'+expected+'\\s*[^<]{0,24}Made by Bruis\\s*<','i').test(body);
}
function dynamicWatermark(body){
  return /data-version-watermark/i.test(body)&&/applyVersionLabel|gejast-version-sync-inline/i.test(body);
}
function cacheBustedUrl(route,index){
  const normalized=String(route||'/');
  const u=normalized==='/' ? new URL(base) : new URL(normalized.replace(/^\/+/,''),base);
  u.searchParams.set('__version_audit',String(Date.now())+'_'+String(index));
  return u.toString();
}
function hostOf(value){
  try{return new URL(value).hostname.toLowerCase();}catch{return '';}
}
function deeplyDecoded(value){
  let text=String(value||'');
  for(let i=0;i<4;i++){
    try{
      const next=decodeURIComponent(text);
      if(next===text) break;
      text=next;
    }catch{break;}
  }
  return text;
}
function isAdminOAuthTarget(value){
  if(hostOf(value)!=='github.com') return false;
  const decoded=deeplyDecoded(value).toLowerCase();
  return decoded.includes('admin.kalenel.nl/oauth/callback')
    && (decoded.includes('/login/oauth/authorize')||decoded.includes('github.com/login'));
}
async function requestRoute(startUrl,signal){
  let current=startUrl;
  const trace=[];
  for(let hop=0;hop<=maxRedirects;hop++){
    const res=await fetch(current,{
      redirect:'manual',
      cache:'no-store',
      signal,
      headers:{
        'accept':'text/html,application/xhtml+xml',
        'cache-control':'no-cache',
        'pragma':'no-cache',
        'user-agent':'Kalenel-Published-Version-Audit/1.1',
      },
    });
    const status=res.status;
    const currentUrl=res.url||current;
    const currentHost=hostOf(currentUrl);
    const location=res.headers.get('location')||'';
    const nextUrl=location?new URL(location,currentUrl).toString():'';
    trace.push({url:currentUrl,status,location:nextUrl});

    if((status===401||status===403)&&currentHost==='admin.kalenel.nl'){
      const text=await res.text();
      return {
        kind:'protected',
        status,
        finalUrl:currentUrl,
        text,
        adminBuild:String(res.headers.get('x-kalenel-admin-build')||''),
        trace,
      };
    }
    if(nextUrl&&isAdminOAuthTarget(nextUrl)){
      return {kind:'protected-oauth',status,finalUrl:nextUrl,text:'',trace};
    }
    if(status>=300&&status<400&&nextUrl){
      current=nextUrl;
      continue;
    }
    return {kind:'response',status,finalUrl:currentUrl,text:await res.text(),trace};
  }
  return {kind:'error',status:0,finalUrl:current,text:'',trace,reason:`more than ${maxRedirects} redirects`};
}
async function fetchPage(entry,index){
  const rel=entry.sourcePath;
  const route=entry.route;
  const source=fs.readFileSync(path.join(root,rel),'utf8');
  const expected=expectedPageVersion(rel,rootVersion,source);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const outcome=await requestRoute(cacheBustedUrl(route,index),controller.signal);
    const traceText=outcome.trace.map(x=>`${x.status}:${x.url}`).join(' -> ');
    if(outcome.kind==='protected-oauth'){
      return {rel,route,expected,status:outcome.status,final_url:outcome.finalUrl,state:'protected',protection:'oauth',redirect_trace:traceText};
    }
    if(outcome.kind==='protected'){
      const workerWatermark=literalWatermark(outcome.text,adminWorker.pageVersion);
      if(outcome.adminBuild!==adminWorker.build){
        return {rel,route,expected,status:outcome.status,final_url:outcome.finalUrl,state:'fail',reason:'admin Worker build '+(outcome.adminBuild||'missing')+' expected '+adminWorker.build,redirect_trace:traceText};
      }
      if(!workerWatermark){
        return {rel,route,expected,status:outcome.status,final_url:outcome.finalUrl,state:'fail',reason:'admin Worker watermark missing/wrong; expected '+adminWorker.pageVersion,redirect_trace:traceText};
      }
      return {rel,route,expected,status:outcome.status,final_url:outcome.finalUrl,state:'protected',protection:'worker-login',admin_build:outcome.adminBuild,admin_page_version:adminWorker.pageVersion,redirect_trace:traceText};
    }
    if(outcome.kind==='error'){
      return {rel,route,expected,status:outcome.status,final_url:outcome.finalUrl,state:'fail',reason:outcome.reason,redirect_trace:traceText};
    }
    if(outcome.status<200||outcome.status>=300){
      return {rel,route,expected,status:outcome.status,final_url:outcome.finalUrl,state:'fail',reason:'HTTP '+outcome.status,redirect_trace:traceText};
    }
    const declarations=[...new Set(pageVersionDeclarations(outcome.text))];
    if(declarations.length!==1||declarations[0]!==expected){
      return {rel,route,expected,status:outcome.status,final_url:outcome.finalUrl,state:'fail',reason:'declaration '+(declarations.join('|')||'missing'),redirect_trace:traceText};
    }
    if(!literalWatermark(outcome.text,expected)&&!dynamicWatermark(outcome.text)){
      return {rel,route,expected,status:outcome.status,final_url:outcome.finalUrl,state:'fail',reason:'watermark owner missing/wrong',redirect_trace:traceText};
    }
    return {rel,route,expected,status:outcome.status,final_url:outcome.finalUrl,state:'pass',redirect_trace:traceText};
  }catch(error){
    return {rel,route,expected,status:0,final_url:'',state:'fail',reason:String(error?.name||error)+': '+String(error?.message||'')};
  }finally{
    clearTimeout(timer);
  }
}

async function worker(){
  for(;;){
    const index=next++;
    if(index>=routes.length) return;
    results[index]=await fetchPage(routes[index],index);
  }
}
await Promise.all(Array.from({length:Math.min(concurrency,routes.length)},()=>worker()));

const failures=results.filter(r=>r.state==='fail');
const protectedRows=results.filter(r=>r.state==='protected');
const oauthProtectedRows=protectedRows.filter(r=>r.protection==='oauth');
const workerProtectedRows=protectedRows.filter(r=>r.protection==='worker-login');
for(const row of results){
  console.log(`LIVE_PAGE_VERSION ${row.state.toUpperCase()} route=${row.route} source=${row.rel} expected=${row.expected} http=${row.status} final=${row.final_url}${row.reason?' reason='+row.reason:''}`);
}
console.log(`LIVE_PAGE_VERSION_SUMMARY source_pages=${new Set(routes.map(x=>x.sourcePath)).size} routes=${routes.length} pass=${results.filter(r=>r.state==='pass').length} protected=${protectedRows.length} protected_worker_verified=${workerProtectedRows.length} protected_oauth_boundary=${oauthProtectedRows.length} fail=${failures.length} root=${rootVersion} worker_page=${adminWorker.pageVersion}`);
if(failures.length){
  console.error('LIVE_PAGE_VERSION_FAILURES');
  for(const row of failures) console.error(`${row.route} [${row.rel}]: ${row.reason||'unknown'} (HTTP ${row.status}, ${row.final_url||'no final URL'}) trace=${row.redirect_trace||'n/a'}`);
  process.exit(1);
}
console.log('RESULT=ALL_LIVE_PUBLISHED_PAGE_VERSION_INTEGRITY_PASS');
