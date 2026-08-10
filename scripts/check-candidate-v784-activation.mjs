#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base=process.env.V784_CANDIDATE_BASE||'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true});

async function inspect(query,mode){
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL',serviceWorkers:'block'});
  let contextCalls=0,writes=0;
  await context.route('**/*',async route=>{
    const req=route.request();
    let u;try{u=new URL(req.url());}catch{return route.continue();}
    if(!['GET','HEAD'].includes(req.method())){
      if(/\/rest\/v1\/rpc\/(?:account_get_activation_context_v687|get_activation_link_context)$/i.test(u.pathname)){
        contextCalls++;
        if(mode==='valid') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({display_name:'Testspeler',requester_email:'test@example.invalid'})});
        return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'invalid activation token'})});
      }
      writes++;
      return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    }
    return route.continue();
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e?.message||e)));
  await page.goto(`${base}/activate.html${query}`,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(700);
  const state=await page.evaluate(()=>({
    name:document.getElementById('approvedName')?.textContent?.trim(),
    email:document.getElementById('approvedEmail')?.textContent?.trim(),
    status:document.getElementById('status')?.textContent?.trim(),
    fallbackHidden:document.getElementById('activationFallback')?.hidden,
    disabled:[...document.querySelectorAll('#activateForm input,#activateForm button')].every(el=>el.disabled)
  }));
  await context.close();
  return{state,contextCalls,writes,errors};
}

const missing=await inspect('','missing');
assert.deepEqual(missing.errors,[],'missing-token page must not throw');
assert.equal(missing.contextCalls,0,'missing token must not call activation-context RPC');
assert.equal(missing.writes,0,'missing token must not attempt writes');
assert.equal(missing.state.disabled,true,'missing token must keep activation form disabled');
assert.equal(missing.state.fallbackHidden,false,'missing token must reveal login fallback');
assert.match(missing.state.status,/mist een token/i,'missing token must explain the problem');
assert.equal(missing.state.name,'Niet beschikbaar');
assert.equal(missing.state.email,'Niet beschikbaar');

const valid=await inspect('?token=test-valid-token','valid');
assert.deepEqual(valid.errors,[],'valid-context page must not throw');
assert.ok(valid.contextCalls>=1,'valid token must request activation context');
assert.equal(valid.writes,0,'context-only proof must not attempt account activation');
assert.equal(valid.state.disabled,false,'valid activation context must enable the form');
assert.equal(valid.state.fallbackHidden,true,'valid activation context must hide login fallback');
assert.equal(valid.state.name,'Testspeler');
assert.equal(valid.state.email,'test@example.invalid');

console.log(`V784_ACTIVATION_BROWSER=PASS missingContextCalls=${missing.contextCalls} validContextCalls=${valid.contextCalls} writes=0`);
await browser.close();
