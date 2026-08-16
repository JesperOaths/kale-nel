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
async function committed(page,url){return page.goto(url,{waitUntil:'commit',timeout:25000});}

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
    await committed(page,new URL(route,base).toString());
    await page.waitForURL(u=>u.pathname==='/login.html',{timeout:12000});
    assert(new URL(page.url()).pathname==='/login.html',`${route} did not end at canonical login`);
    await page.close();
  }
  assert(leaks.length===0,`logged-out protected UI became visible before redirect: ${JSON.stringify(leaks)}`);

  const family=await context.newPage();
  await committed(family,new URL('familie/index.html',base).toString());
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
  await committed(page,new URL('toepen.html',base).toString());
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
  await page.waitForTimeout(2500);
  const state=await page.evaluate(()=>({
    token:localStorage.getItem('jas_session_token_v11')||'',
    visibility:getComputedStyle(document.documentElement).visibility,
    body:(document.body.innerText||'').replace(/\s+/g,' ').trim(),
    selectable:[...document.querySelectorAll('a[href]')].filter(a=>{
      const r=a.getBoundingClientRect(); const s=getComputedStyle(a); if(r.width<=0||r.height<=0||s.display==='none'||s.visibility==='hidden') return false;
      try{const u=new URL(a.href,location.href);return u.origin===location.origin&&!['/index.html','/login.html','/request.html'].includes(u.pathname)&&!u.pathname.startsWith('/admin');}catch{return false;}
    }).length
  }));
  assert(state.token.length>=32,`${label} login stored no usable session token`);
  assert(state.visibility!=='hidden',`${label} authenticated index stayed hidden`);
  assert(state.body.length>100,`${label} authenticated main page rendered no meaningful UI`);
  assert(state.selectable>=3,`${label} main page exposes too few selectable destinations (${state.selectable})`);
  console.log(`::add-mask::${state.token}`);
  console.log(`${label}_LOGIN_TO_MAIN_PASS selectable_destinations=${state.selectable}`);
  return {context,page,token:state.token};
}

async function clickMainSelection(session){
  const {page}=session;
  await page.goto(new URL('index.html',base).toString(),{waitUntil:'domcontentloaded',timeout:25000});
  await page.waitForFunction(()=>document.documentElement.getAttribute('data-gejast-auth-state')==='authenticated',{timeout:15000});
  await page.waitForTimeout(2200);
  const target=await page.evaluate(()=>{
    const candidates=[...document.querySelectorAll('a[href]')].filter(a=>{
      const r=a.getBoundingClientRect(),s=getComputedStyle(a); if(r.width<=0||r.height<=0||s.display==='none'||s.visibility==='hidden') return false;
      try{const u=new URL(a.href,location.href);return u.origin===location.origin&&!['/index.html','/login.html','/request.html'].includes(u.pathname)&&!u.pathname.startsWith('/admin');}catch{return false;}
    });
    const a=candidates[0]; if(!a) return null; a.setAttribute('data-v798-proof-target','1'); return {href:a.href,text:(a.textContent||'').trim().slice(0,80)};
  });
  assert(target,'main index has no visible selectable internal destination');
  await page.locator('[data-v798-proof-target="1"]').click();
  await page.waitForFunction(()=>document.documentElement.getAttribute('data-gejast-auth-state')==='authenticated',{timeout:15000});
  const dest=new URL(page.url());
  assert(dest.pathname!=='/index.html'&&dest.pathname!=='/login.html',`main selection did not reach another protected destination (${target.href} -> ${dest.pathname})`);
  console.log(`MAIN_SELECTION_CLICK_PASS text=${JSON.stringify(target.text)} destination=${dest.pathname}`);
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

async function klaverjasTwoHumanRoom(token1,token2){
  let roomId='';
  try{
    const room=await rpc('klaverjas_online_create',{session_token:token1,site_scope_input:'friends',settings_input:{finish_mode:'fixed_rounds',bot_count:0,v798_phase1:true}});
    roomId=String(room?.game?.id||room?.id||'');
    const code=String(room?.game?.lobby_code||room?.lobby_code||'');
    assert(roomId&&code,'Klaverjas create returned no room id/code');
    await rpc('klaverjas_online_join',{session_token:token2,lobby_code_input:code,site_scope_input:'friends'});
    const a=await rpc('klaverjas_online_get_state',{session_token:token1,game_id_input:roomId,lobby_code_input:null,site_scope_input:'friends'});
    const b=await rpc('klaverjas_online_get_state',{session_token:token2,game_id_input:roomId,lobby_code_input:null,site_scope_input:'friends'});
    assert((a?.players||[]).length===2,`Klaverjas host view expected 2 humans, got ${(a?.players||[]).length}`);
    assert((b?.players||[]).length===2,`Klaverjas joiner view expected 2 humans, got ${(b?.players||[]).length}`);
    assert(a?.viewer?.seat!==undefined&&b?.viewer?.seat!==undefined&&a.viewer.seat!==b.viewer.seat,'Klaverjas viewers did not receive distinct seats');
    console.log(`KLAVERJAS_TWO_HUMAN_ROOM_PASS code=${code} seats=${a.viewer.seat},${b.viewer.seat}`);
  }finally{
    if(roomId){
      try{await rpc('klaverjas_online_delete_room',{session_token:token1,game_id_input:roomId,lobby_code_input:null,site_scope_input:'friends'});}
      catch(err){console.log(`Klaverjas cleanup warning: ${err.message}`);}
    }
  }
}

async function crossScopeDenial(session){
  const {page}=session;
  await committed(page,new URL('index.html?scope=family',base).toString());
  await page.waitForURL(u=>u.pathname==='/login.html'&&u.searchParams.get('scope')==='family',{timeout:15000});
  const token=await page.evaluate(()=>localStorage.getItem('jas_session_token_v11'));
  assert(!token,'friends token survived family-scope denial instead of being cleared');
  console.log('AUTH_SCOPE_ISOLATION_PASS friends_token_rejected_for_family=true');
}

try{
  await noSessionMatrix();
  await invalidTokenProof();
  const s1=await loginThroughUi(player1,pin1,'PLAYER1');
  await clickMainSelection(s1);
  await authenticatedSurfaceMatrix(s1);
  const s2=await loginThroughUi(player2,pin2,'PLAYER2');
  await klaverjasTwoHumanRoom(s1.token,s2.token);
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
