#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base='https://kalenel.nl';
const proof=`proof=${Date.now()}`;
async function text(path){const r=await fetch(`${base}${path}?${proof}`,{headers:{'cache-control':'no-cache'}});assert.equal(r.status,200,`${path} HTTP ${r.status}`);return r.text();}

assert.equal((await text('/VERSION')).trim(),'v784','public VERSION must be v784');
const pageSource=await text('/activate.html');
const runtimeSource=await text('/gejast-account-runtime.js');
for(const id of ['pinInput','pinConfirmInput']) assert.match(pageSource,new RegExp(`id="${id}"[^>]*\\bdisabled\\b`),`live ${id} must ship disabled`);
assert.match(pageSource,/<button[^>]*type="submit"[^>]*\bdisabled\b[^>]*>Account activeren<\/button>/i,'live activation submit must ship disabled');
assert.match(pageSource,/id="activationFallback"[^>]*hidden/i,'live activation fallback must exist hidden by default');
assert.match(pageSource,/href="\.\/login\.html"/,'live activation fallback must lead to login');
assert.match(runtimeSource,/if\(!token\)\{[^]*?Deze activatielink mist een token\.[^]*?return;/,'live runtime must stop missing-token activation early');
assert.match(runtimeSource,/setBusy\(form,false\);\s*showActivationFallback\(false\);/,'live runtime must only enable after valid context');

const browser=await chromium.launch({headless:true});
const activationWritePattern=/\/rest\/v1\/rpc\/(?:account_activate_v687|activate_player_from_email_link)$/i;
const contextPattern=/\/rest\/v1\/rpc\/(?:account_get_activation_context_v687|get_activation_link_context)$/i;

async function inspect(query,mode){
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL',serviceWorkers:'block'});
  let contextCalls=0;
  const blockedNonGet=[];
  const activationWrites=[];
  await context.route('**/*',async route=>{
    const req=route.request(); let u; try{u=new URL(req.url());}catch{return route.continue();}
    if(!['GET','HEAD'].includes(req.method())){
      const item=`${req.method()} ${u.pathname}`;
      if(contextPattern.test(u.pathname)){
        contextCalls++;
        if(mode==='expired') return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'invalid activation token'})});
        return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'unexpected context lookup'})});
      }
      blockedNonGet.push(item);
      if(activationWritePattern.test(u.pathname)) activationWrites.push(item);
      return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    }
    return route.continue();
  });
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(String(e?.message||e)));
  await page.goto(`${base}/activate.html${query}`,{waitUntil:'domcontentloaded',timeout:30000}); await page.waitForTimeout(900);
  const state=await page.evaluate(()=>({
    name:document.getElementById('approvedName')?.textContent?.trim(),
    email:document.getElementById('approvedEmail')?.textContent?.trim(),
    status:document.getElementById('status')?.textContent?.trim(),
    fallbackHidden:document.getElementById('activationFallback')?.hidden,
    disabled:[...document.querySelectorAll('#activateForm input,#activateForm button')].every(el=>el.disabled),
    fallbackHref:document.getElementById('activationFallback')?.getAttribute('href')
  }));
  await context.close();
  return{state,contextCalls,blockedNonGet:[...new Set(blockedNonGet)],activationWrites:[...new Set(activationWrites)],errors};
}

const missing=await inspect('','missing');
assert.deepEqual(missing.errors,[],'live missing-token activation page must not throw');
assert.equal(missing.contextCalls,0,'live missing token must not call activation-context RPC');
assert.deepEqual(missing.activationWrites,[],'live missing token must not attempt account activation');
assert.equal(missing.state.disabled,true,'live missing token must keep activation controls disabled');
assert.equal(missing.state.fallbackHidden,false,'live missing token must show login fallback');
assert.equal(missing.state.fallbackHref,'./login.html');
assert.match(missing.state.status,/mist een token/i,'live missing token must explain the missing link token');
assert.equal(missing.state.name,'Niet beschikbaar');
assert.equal(missing.state.email,'Niet beschikbaar');

const expired=await inspect('?token=v784-expired-proof','expired');
assert.deepEqual(expired.errors,[],'live expired-token activation page must not throw');
assert.ok(expired.contextCalls>=1,'live expired token must perform only its activation-context lookup');
assert.deepEqual(expired.activationWrites,[],'live expired token must not attempt account activation');
assert.equal(expired.state.disabled,true,'live expired token must keep activation controls disabled');
assert.equal(expired.state.fallbackHidden,false,'live expired token must show login fallback');
assert.match(expired.state.status,/ongeldig|verlopen/i,'live expired token must explain that the activation link is unusable');
assert.equal(expired.state.name,'Niet beschikbaar');
assert.equal(expired.state.email,'Niet beschikbaar');

console.log('LIVE_V784_ACTIVATION=PASS '+JSON.stringify({missingContextCalls:missing.contextCalls,expiredContextCalls:expired.contextCalls,missingBlocked:missing.blockedNonGet,expiredBlocked:expired.blockedNonGet,activationWrites:0}));
await browser.close();
