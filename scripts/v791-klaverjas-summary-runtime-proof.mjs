#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE=process.env.PROOF_BASE_URL||'http://127.0.0.1:4173';
const engines=[['chromium',chromium],['firefox',firefox],['webkit',webkit]];
const viewports=[['mobile',{width:390,height:844}],['desktop',{width:1366,height:768}]];
const failures=[]; const passes=[];
const NAMES=['Ada','Bram','Caro','Daan','Evi','Fons','Gijs','Hugo'];

function rpcName(url){try{return decodeURIComponent(new URL(url).pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/)?.[1]||'');}catch{return '';}}
function playerRows(){return NAMES.map((name,i)=>({player_id:`p${i+1}`,id:`p${i+1}`,display_name:name,player_name:name,public_display_name:name,login_active:true,active:true,site_scope:'friends'}));}
function mockRpc(name){
  if(/^(get_login_active_names_v687|get_login_names_scoped|get_login_names|get_player_selector_source_v1|get_game_player_names_fast_v687)$/.test(name)) return playerRows();
  if(/^(get_public_state|get_gejast_homepage_state|get_jas_app_state|account_public_state_v687)$/.test(name)) return {session_valid:true,is_logged_in:true,my_name:'Ada',display_name:'Ada',player_name:'Ada',viewer:{player_id:'p1',display_name:'Ada',player_name:'Ada'}};
  if(name==='save_game_match_summary_scoped'||name==='save_game_match_summary') return {ok:true,data:{ok:true}};
  if(/^(get_homepage|get_beta|get_live|get_shared|get_recent|get_.*leaderboard|get_.*stats|get_.*matches)/.test(name)) return [];
  return {ok:true};
}
async function selectByText(page,selector,text){
  await page.waitForFunction(({selector,text})=>[...document.querySelectorAll(`${selector} option`)].some(o=>o.textContent.trim()===text),{selector,text},{timeout:8000});
  await page.locator(selector).selectOption({label:text});
}

async function runCase(browser,engine,viewportName,viewport){
  const calls=[]; const errors=[];
  const context=await browser.newContext({viewport,locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
  await context.addInitScript(()=>{
    localStorage.setItem('jas_session_token_v11','v791-proof-session-123456789');
    sessionStorage.setItem('jas_session_token_v11','v791-proof-session-123456789');
    localStorage.removeItem('klaverjas_scorer_v596_game');
    sessionStorage.removeItem('klaverjas_scorer_v596_game');
    window.alert=()=>{}; window.confirm=()=>true;
  });
  await context.route('**/*',async route=>{
    const req=route.request(); let u; try{u=new URL(req.url());}catch{return route.continue();}
    if(u.hostname.includes('supabase.co')){
      if(u.pathname.includes('/rest/v1/rpc/')){
        const name=rpcName(req.url()); let body={}; try{body=req.postDataJSON()||{};}catch{}
        calls.push({name,method:req.method(),body});
        return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(mockRpc(name,body))});
      }
      calls.push({name:`ESCAPE:${req.method()}:${u.pathname}`,method:req.method()});
      return route.abort('blockedbyclient');
    }
    if(u.pathname==='/favicon.ico') return route.fulfill({status:204,body:''});
    return route.continue();
  });

  try{
    const page=await context.newPage(); page.on('pageerror',e=>errors.push(String(e?.message||e)));
    const res=await page.goto(`${BASE}/scorer.html?proof=v791`,{waitUntil:'domcontentloaded',timeout:30000});
    assert.ok(res&&res.status()<400,`scorer HTTP ${res?.status()}`);
    assert.equal(new URL(page.url()).pathname,'/scorer.html','scorer redirected unexpectedly');
    await page.locator('#setupOverlay.show').waitFor({timeout:8000});
    for(const [sel,name] of [['#playerW1','Ada'],['#playerZ1','Bram'],['#playerW2','Caro'],['#playerZ2','Daan']]) await selectByText(page,sel,name);
    await page.getByRole('button',{name:'Opslaan en bieding kiezen'}).click();

    for(let round=1;round<=16;round++){
      await page.locator('#bidOverlay.show').waitFor({timeout:6000});
      await page.locator('[data-team-choice="W"]').click();
      await page.locator('[data-suit="♠"]').click();
      await page.getByRole('button',{name:'Bieding bewaren'}).click();
      await page.locator('#inputW').fill('90');
      await page.locator('#saveRoundBtn').click();
      if(round<16) await page.waitForFunction(expected=>document.querySelector('#bidOverlay')?.classList.contains('show')&&document.querySelector('#bidRoundNo')?.textContent===String(expected),round+1,{timeout:6000});
    }

    await page.locator('#matchSummaryOverlay.show').waitFor({timeout:7000});
    const summary=await page.locator('#matchSummaryCard').innerText();
    assert.match(summary,/Winnaar/i,'finished summary must show winner section');
    assert.match(summary,/Ada/i,'finished summary must include winning team names');
    assert.match(summary,/Wij[\s\S]*Zij/i,'finished summary must show both totals');
    assert.ok(Number(await page.locator('#totalW').textContent())>0,'Klaverjas final total must be positive');
    await page.waitForFunction(()=>document.querySelector('#saveMatchBtn')&&!document.querySelector('#saveMatchBtn').hidden,{timeout:5000});
    await page.waitForTimeout(350);
    assert.ok(calls.some(c=>c.name==='save_game_match_summary_scoped'||c.name==='save_game_match_summary'),'finished summary did not attempt established match-summary sync');

    const summaryClose=page.locator('#matchSummaryOverlay button').filter({hasText:'Sluiten'});
    await summaryClose.click();
    await page.waitForFunction(()=>!document.querySelector('#matchSummaryOverlay')?.classList.contains('show'),{timeout:4000});
    assert.deepEqual(errors,[],`page errors before handoff: ${errors.join(' | ')}`);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=6,`scorer horizontal overflow ${overflow}px`);

    await page.locator('#saveMatchBtn').click();
    await page.waitForURL(/klaverjas_scorer_v596_repo_ready\.html.*handoff=1/,{timeout:9000});
    await page.waitForFunction(()=>document.querySelector('#a1')?.value==='Ada'&&document.querySelector('#b1')?.value==='Bram'&&Number(document.querySelector('#scoreA')?.value||0)>0,null,{timeout:8000});
    assert.equal(await page.locator('#a1').inputValue(),'Ada');
    assert.equal(await page.locator('#b1').inputValue(),'Bram');
    assert.ok(Number(await page.locator('#scoreA').inputValue())>Number(await page.locator('#scoreB').inputValue()),'handoff totals must preserve winning side');
    assert.ok(calls.every(c=>!String(c.name).startsWith('ESCAPE:')),`unexpected Supabase escape: ${JSON.stringify(calls.filter(c=>String(c.name).startsWith('ESCAPE:')))}`);
    assert.deepEqual(errors,[],`page errors after handoff: ${errors.join(' | ')}`);
    passes.push(`${engine}:${viewportName}`); console.log(`PROOF_PASS ${engine} ${viewportName}`);
    await page.close();
  } finally { await context.close(); }
}

for(const [engineName,engine] of engines){
  const browser=await engine.launch({headless:true});
  for(const [viewportName,viewport] of viewports){
    try{await runCase(browser,engineName,viewportName,viewport);}catch(err){failures.push(`${engineName}:${viewportName}: ${err?.stack||err}`);console.error(`PROOF_FAIL ${engineName} ${viewportName}\n${err?.stack||err}`);}
  }
  await browser.close();
}
console.log(`V791_KLAVERJAS_PROOF_PASSES=${passes.length}`);
console.log(`V791_KLAVERJAS_PROOF_FAILURES=${failures.length}`);
if(failures.length){failures.forEach(f=>console.error(`- ${f}`));process.exit(1);}console.log('V791_KLAVERJAS_SUMMARY_RUNTIME_PROOF=PASS');
