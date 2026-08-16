#!/usr/bin/env node
import fs from 'node:fs';
import { chromium } from 'playwright';

const base=String(process.env.GEJAST_BASE_URL||'https://kalenel.nl/').replace(/\/+$/,'')+'/';
const player1=String(process.env.GEJAST_PLAYER1_NAME||'');
const player2=String(process.env.GEJAST_PLAYER2_NAME||'');
const pin1=String(process.env.GEJAST_PLAYER1_PIN||'');
const pin2=String(process.env.GEJAST_PLAYER2_PIN||'');
if(!player1||!player2||!/^\d{4}$/.test(pin1)||!/^\d{4}$/.test(pin2)) throw new Error('Controlled player credentials missing');

function readConfig(){
  const text=fs.readFileSync('gejast-config.js','utf8');
  const url=text.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
  const key=text.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
  if(!url||!key) throw new Error('Public Supabase config missing');
  return {url:url.replace(/\/+$/,''),key};
}
const cfg=readConfig();
async function rpc(name,payload={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const res=await fetch(`${cfg.url}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',apikey:cfg.key,Authorization:`Bearer ${cfg.key}`},body:JSON.stringify(payload),signal:controller.signal});
    const text=await res.text(); let data=null; try{data=text?JSON.parse(text):null}catch{data={raw:text}};
    if(!res.ok) throw new Error(`${name}: ${data?.message||data?.error||data?.details||text||res.status}`);
    return data&&data[name]!==undefined?data[name]:data;
  }finally{clearTimeout(timer);}
}

const browser=await chromium.launch({headless:true});
const failures=[];
function fail(msg){failures.push(msg);console.error('FAIL',msg);}
function assert(cond,msg){if(!cond) throw new Error(msg);}

async function noSessionMatrix(){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const leaks=[];
  await context.exposeBinding('__recordGejastLeak',(_source,data)=>{leaks.push(data);});
  await context.addInitScript(()=>{
    const excluded=new Set(['/login.html','/request.html','/activate.html']);
    let sent=false;
    const sample=()=>{
      try{
        const path=location.pathname;
        if(excluded.has(path)||sent) return;
        const body=(document.body?.innerText||'').replace(/\s+/g,' ').trim();
        const vis=getComputedStyle(document.documentElement).visibility;
        if(body.length>20 && vis!=='hidden'){
          sent=true;
          window.__recordGejastLeak({path,body:body.slice(0,160),visibility:vis,state:document.documentElement.getAttribute('data-gejast-auth-state')});
        }
      }catch(_){ }
    };
    new MutationObserver(sample).observe(document,{subtree:true,childList:true,attributes:true});
    const tick=()=>{sample();requestAnimationFrame(tick)}; requestAnimationFrame(tick);
  });
  const routes=['index.html','home.html','leaderboard.html','profiles.html','drinks.html','despimarkt.html','toepen.html','boerenbridge.html','beerpong.html','pikken.html','paardenrace.html','klaverjas_online.html','rad.html'];
  for(const route of routes){
    const page=await context.newPage();
    await page.goto(new URL(route,base).toString(),{waitUntil:'domcontentloaded',timeout:25000});
    await page.waitForURL(u=>u.pathname==='/login.html',{timeout:12000});
    assert(new URL(page.url()).pathname==='/login.html',`${route} did not end at canonical login`);
    await page.close();
  }
  assert(leaks.length===0,`logged-out protected UI became visible before redirect: ${JSON.stringify(leaks)}`);

  const family=await context.newPage();
  await family.goto(new URL('familie/index.html',base).toString(),{waitUntil:'domcontentloaded',timeout:25000});
  await family.waitForURL(u=>u.pathname==='/login.html'&&u.searchParams.get('scope')==='family',{timeout:12000});
  assert(new URL(family.url()).searchParams.get('scope')==='family','Family logged-out alias did not preserve family login scope');
  await family.close();
  await context.close();
  console.log(`AUTH_NO_SESSION_PASS routes=${routes.length} visible_leaks=0 family_scope=PASS`);
}

async function invalidTokenProof(){
  const bad='v798-invalid-session-token';
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.addInitScript(token=>{localStorage.setItem('jas_session_token_v11',token);localStorage.setItem('jas_last_activity_at_v1',String(Date.now()));},bad);
  const page=await context.newPage();
  await page.goto(new URL('toepen.html',base).toString(),{waitUntil:'domcontentloaded',timeout:25000});
  await page.waitForURL(u=>u.pathname==='/login.html',{timeout:15000});
  const remaining=await page.evaluate(()=>localStorage.getItem('jas_session_token_v11'));
  assert(!remaining,'invalid stored session token was not cleared');
  await context.close();
  console.log('AUTH_INVALID_SESSION_PASS token_cleared=true');
}

async function loginThroughUi(name,pin,label){
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage();
  await page.goto(new URL('login.html?return_to=%2Ftoepen.html',base).toString(),{waitUntil:'domcontentloaded',timeout:25000});
  await page.waitForFunction(expected=>[...document.querySelectorAll('#playerNameInput option')].some(o=>o.value===expected||o.textContent.trim()===expected),name,{timeout:15000});
  await page.selectOption('#playerNameInput',{label:name}).catch(async()=>page.selectOption('#playerNameInput',name));
  await page.fill('#pinInput',pin);
  await page.click('#loginBtn');
  await page.waitForURL(u=>u.pathname==='/index.html',{timeout:20000});
  assert(new URL(page.url()).pathname==='/index.html',`${label} login did not land on main index`);
  assert(!page.url().includes('toepen.html'),`${label} login honored forbidden deep-link return target`);
  await page.waitForFunction(()=>document.documentElement.getAttribute('data-gejast-auth-state')==='authenticated',{timeout:15000});
  const state=await page.evaluate(()=>({
    token:localStorage.getItem('jas_session_token_v11')||'',
    visibility:getComputedStyle(document.documentElement).visibility,
    body:(document.body.innerText||'').replace(/\s+/g,' ').trim(),
    gameLinks:[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')||'').filter(h=>/(toepen|boerenbridge|beerpong|pikken|paardenrace|klaverjas|rad)\.html/i.test(h))
  }));
  assert(state.token.length>=32,`${label} login stored no usable session token`);
  assert(state.visibility!=='hidden',`${label} authenticated index stayed hidden`);
  assert(state.body.length>100,`${label} authenticated main page rendered no meaningful UI`);
  assert(state.gameLinks.length>=3,`${label} main page exposes too few selectable game links (${state.gameLinks.length})`);
  console.log(`::add-mask::${state.token}`);
  console.log(`${label}_LOGIN_TO_MAIN_PASS game_links=${state.gameLinks.length}`);
  return {context,page,token:state.token};
}

async function authenticatedSurfaceMatrix(session){
  const {page}=session;
  const routes=[
    ['toepen.html',/toep|fold|ronde|speler/i],
    ['boerenbridge.html',/boerenbridge|ronde|speler/i],
    ['beerpong.html',/beerpong|team|speler|beker/i],
    ['pikken.html',/pikken|lobby|speler/i],
    ['paardenrace.html',/paardenrace|paard|lobby|speler/i],
    ['klaverjas_online.html',/klaverjas|kamer|speler|bot/i],
    ['rad.html',/rad|draaien|spin|drank/i]
  ];
  for(const [route,rx] of routes){
    await page.goto(new URL(route,base).toString(),{waitUntil:'domcontentloaded',timeout:25000});
    await page.waitForFunction(()=>document.documentElement.getAttribute('data-gejast-auth-state')==='authenticated',{timeout:15000});
    const current=new URL(page.url());
    assert(current.pathname===`/${route}`,`${route} bounced away despite valid session: ${current.pathname}`);
    const info=await page.evaluate(()=>({visibility:getComputedStyle(document.documentElement).visibility,body:(document.body.innerText||'').replace(/\s+/g,' ').trim(),interactive:[...document.querySelectorAll('button,a[href],input,select')].filter(el=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}).length}));
    assert(info.visibility!=='hidden',`${route} remained hidden after valid auth`);
    assert(info.body.length>60,`${route} rendered no meaningful body`);
    assert(rx.test(info.body),`${route} missing expected gameplay copy`);
    assert(info.interactive>0,`${route} exposes no interactive controls`);
    console.log(`GAME_SURFACE_PASS ${route} controls=${info.interactive}`);
  }
}

async function crossScopeDenial(session){
  const {page}=session;
  await page.goto(new URL('index.html?scope=family',base).toString(),{waitUntil:'domcontentloaded',timeout:25000});
  await page.waitForURL(u=>u.pathname==='/login.html'&&u.searchParams.get('scope')==='family',{timeout:15000});
  const token=await page.evaluate(()=>localStorage.getItem('jas_session_token_v11'));
  assert(!token,'friends token survived family-scope denial instead of being cleared');
  console.log('AUTH_SCOPE_ISOLATION_PASS friends_token_rejected_for_family=true');
}

try{
  await noSessionMatrix();
  await invalidTokenProof();
  const s1=await loginThroughUi(player1,pin1,'PLAYER1');
  await authenticatedSurfaceMatrix(s1);
  const s2=await loginThroughUi(player2,pin2,'PLAYER2');
  const envFile=process.env.GITHUB_ENV;
  if(!envFile) throw new Error('GITHUB_ENV missing');
  fs.appendFileSync(envFile,`GEJAST_PLAYER1_TOKEN=${s1.token}\nGEJAST_PLAYER2_TOKEN=${s2.token}\n`);
  await crossScopeDenial(s1);
  await s1.context.close();
  await s2.context.close();
  console.log('RESULT=V798_PHASE1_AUTH_AND_SURFACES_PASS');
}catch(err){
  fail(err?.stack||err?.message||String(err));
}finally{
  await browser.close();
}
if(failures.length) process.exit(1);
