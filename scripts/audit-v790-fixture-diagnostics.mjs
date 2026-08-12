#!/usr/bin/env node
import { chromium } from 'playwright';

const BASE=process.env.AUDIT_BASE_URL||'http://127.0.0.1:4173';
const NAMES=['Ada','Bram','Caro','Daan','Evi','Fons','Gijs','Hugo'];
const rows=NAMES.map((name,i)=>({player_id:`p${i+1}`,id:`p${i+1}`,display_name:name,player_name:name,public_display_name:name,login_active:true,active:true,site_scope:'friends'}));
function rpcName(url){try{return decodeURIComponent(new URL(url).pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/)?.[1]||'');}catch{return '';}}
function mock(name){
  if(/^(get_login_active_names_v687|get_login_names_scoped|get_login_names|get_player_selector_source_v1|get_game_player_names_fast_v687)$/.test(name)) return rows;
  if(/^(get_public_state|get_gejast_homepage_state|get_jas_app_state|account_public_state_v687)$/.test(name)) return {session_valid:true,is_logged_in:true,my_name:'Ada',display_name:'Ada',player_name:'Ada',viewer:{player_id:'p1',display_name:'Ada',player_name:'Ada'}};
  if(name==='get_beerpong_leaderboard_public') return {leaderboard:[],recent_matches:[]};
  if(name==='get_beerpong_pussycup_ranking_public') return {ranking:[]};
  if(name==='save_beerpong_match') return {ok:true,match_id:'bp-diag'};
  return [];
}
async function makeContext(browser){
  const calls=[];
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('jas_session_token_v11','diag-session-123456789');sessionStorage.setItem('jas_session_token_v11','diag-session-123456789');window.alert=()=>{};window.confirm=()=>true;});
  await context.route('**/*',async route=>{
    const req=route.request();let u;try{u=new URL(req.url());}catch{return route.continue();}
    if(u.hostname.includes('supabase.co')){
      if(u.pathname.includes('/rest/v1/rpc/')){const name=rpcName(req.url());let body={};try{body=req.postDataJSON()||{};}catch{}calls.push({kind:'rpc',name,method:req.method(),path:u.pathname,body});return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(mock(name))});}
      calls.push({kind:'non-rpc',method:req.method(),path:u.pathname,search:u.search});
      return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','content-range':'0-0/0'},body:'[]'});
    }
    if(u.pathname==='/favicon.ico') return route.fulfill({status:204,body:''});
    return route.continue();
  });
  return {context,calls};
}

const browser=await chromium.launch({headless:true});
{
  const {context,calls}=await makeContext(browser);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e?.message||e)));
  await page.goto(`${BASE}/boerenbridge.html?auditdiag=1`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(2500);
  const diag=await page.evaluate(()=>({
    path:location.pathname,
    scope:(()=>{try{return window.GEJAST_SCOPE_UTILS?.getScope?.()||null}catch{return null}})(),
    overlay:document.querySelector('#setupOverlay')?.className||null,
    selects:[...document.querySelectorAll('#playerFields select')].map(s=>({value:s.value,options:[...s.options].map(o=>o.textContent.trim())})),
    status:document.querySelector('#message')?.textContent||document.querySelector('#status')?.textContent||''
  }));
  console.log('BOERENBRIDGE_DIAG='+JSON.stringify(diag));
  console.log('BOERENBRIDGE_CALLS='+JSON.stringify(calls));
  console.log('BOERENBRIDGE_ERRORS='+JSON.stringify(errors));
  await context.close();
}
{
  const {context,calls}=await makeContext(browser);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e?.message||e)));
  await page.goto(`${BASE}/beerpong.html?auditdiag=1`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(1500);
  for(const [sel,name] of [['#teamA1','Ada'],['#teamA2','Bram'],['#teamB1','Caro'],['#teamB2','Daan']]){
    await page.waitForFunction(({sel,name})=>[...document.querySelectorAll(`${sel} option`)].some(o=>o.textContent.trim()===name),{sel,name},{timeout:7000});
    await page.locator(sel).selectOption({label:name});
  }
  await page.locator('#cupsA').fill('10');await page.locator('#cupsB').fill('6');await page.locator('#pussycupA').check();await page.locator('#notesInput').fill('diagnostic');await page.locator('#saveBtn').click();
  await page.waitForTimeout(1200);
  console.log('BEERPONG_CALLS='+JSON.stringify(calls));
  console.log('BEERPONG_NON_RPC='+JSON.stringify(calls.filter(c=>c.kind==='non-rpc')));
  console.log('BEERPONG_ERRORS='+JSON.stringify(errors));
  await context.close();
}
await browser.close();
console.log('AUDIT_V790_FIXTURE_DIAGNOSTICS=COMPLETE');
