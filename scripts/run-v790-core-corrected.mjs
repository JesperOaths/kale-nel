#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const sourcePath='scripts/audit-v789-core-gameplay.mjs';
const tempPath='scripts/.audit-v790-core-runtime.mjs';
let source=fs.readFileSync(sourcePath,'utf8');

function replaceOnce(oldText,newText,label){
  const count=source.split(oldText).length-1;
  if(count!==1) throw new Error(`${label}: expected exactly one owner, got ${count}`);
  source=source.replace(oldText,newText);
}

replaceOnce(
  "      calls.push({name:`ESCAPE:${req.method()}:${u.pathname}`,method:req.method(),payload:{}});return route.abort('blockedbyclient');",
  "      if(req.method()==='GET'&&u.pathname==='/rest/v1/allowed_usernames'){calls.push({name:`READ:${req.method()}:${u.pathname}`,method:req.method(),payload:{}});const allowed=playerRows().map(r=>({...r,status:'active',has_pin:true,pin_is_set:true,activated:true,is_active:true}));return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','content-range':`0-${Math.max(0,allowed.length-1)}/${allowed.length}`},body:JSON.stringify(allowed)});}\n      calls.push({name:`ESCAPE:${req.method()}:${u.pathname}`,method:req.method(),payload:{}});return route.abort('blockedbyclient');",
  'readonly allowed_usernames fixture'
);
replaceOnce(
  "function noEscapes(calls,label){assert.ok(calls.every(c=>!String(c.name).startsWith('ESCAPE:')),`${label} emitted unexpected non-RPC Supabase traffic`);}",
  "function noEscapes(calls,label){const escapes=calls.filter(c=>String(c.name).startsWith('ESCAPE:'));assert.deepEqual(escapes,[],`${label} emitted unexpected Supabase traffic: ${JSON.stringify(escapes)}`);}",
  'escape diagnostics'
);
replaceOnce(
  "for(const [i,name] of ['Ada','Bram','Caro','Daan'].entries())await selectByText(page,`#playerFields select[data-player-index=\"${i}\"]`,name);",
  "for(const [i,name] of ['Ada','Bram','Daan','Fons'].entries())await selectByText(page,`#playerFields select[data-player-index=\"${i}\"]`,name);",
  'Boerenbridge scoped fixture names'
);
replaceOnce(
  "if(await page.locator('#bidOverlay.show').count())await page.locator('#bidCancelBtn').click();await page.locator('#undoBtn').click();",
  "await page.waitForTimeout(450);await page.evaluate(()=>{const overlay=document.querySelector('#bidOverlay');if(overlay?.classList.contains('show'))document.querySelector('#bidCancelBtn')?.click();});await page.waitForFunction(()=>!document.querySelector('#bidOverlay')?.classList.contains('show'),null,{timeout:3000});await page.locator('#undoBtn').click();",
  'Boerenbridge next-round overlay cleanup before physical undo'
);
replaceOnce("{timeout:16000}","{timeout:35000}",'Rad deliberate-animation ceiling');
replaceOnce(
  "const SURFACES=['/leaderboard.html','/boerenbridge_spectator.html','/boerenbridge_vault.html','/beerpong_vault.html','/toepen_vault.html','/paardenrace_stats.html','/paardenrace_ladder.html','/pikken_stats.html','/pikken_ladder.html','/beurs.html','/despimarkt.html','/ballroom.html','/drinks_speed.html','/drinks.html'];",
  "const SURFACES=['/leaderboard.html','/beerpong_vault.html','/toepen_vault.html','/paardenrace_stats.html','/paardenrace_ladder.html','/pikken_stats.html','/pikken_ladder.html','/beurs.html','/despimarkt.html','/ballroom.html','/drinks_speed.html','/drinks.html'];",
  'protected and redirect surfaces separated from public smoke'
);
replaceOnce(
  "async function secondary(context){for(const path of SURFACES){const {page,errors}=await openPage(context,`${path}?auditplay=core`);const st=await page.evaluate(()=>({title:document.title.trim(),text:(document.body?.innerText||'').trim(),width:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(st.title,`${path} missing title`);assert.ok(st.text.length>8,`${path} empty`);assert.ok(st.width<=st.viewport+6,`${path} overflow ${st.width-st.viewport}px`);noErrors(errors,path);await page.close();}}",
  "async function secondary(context){for(const path of SURFACES){const {page,errors}=await openPage(context,`${path}?auditplay=core`);const st=await page.evaluate(()=>({title:document.title.trim(),text:(document.body?.innerText||'').trim(),width:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(st.title,`${path} missing title`);assert.ok(st.text.length>8,`${path} empty`);assert.ok(st.width<=st.viewport+6,`${path} overflow ${st.width-st.viewport}px`);noErrors(errors,path);await page.close();}const alias=await context.newPage();const aliasErrors=[];alias.on('pageerror',e=>aliasErrors.push(String(e?.message||e)));let res=await alias.goto(`${BASE}/boerenbridge_spectator.html?auditplay=core`,{waitUntil:'domcontentloaded',timeout:30000});assert.ok(res&&res.status()<400,`spectator alias HTTP ${res?.status()}`);await alias.waitForTimeout(500);let u=new URL(alias.url());assert.equal(u.pathname,'/boerenbridge_live.html','Boerenbridge spectator alias must land on live spectator surface');assert.equal(u.searchParams.get('spectator'),'1','Boerenbridge spectator alias must preserve spectator=1');assert.ok(!/login\\.html$/i.test(u.pathname),'spectator alias landed on login');let x=await alias.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(x<=6,`spectator alias overflow ${x}px`);noErrors(aliasErrors,'boerenbridge-spectator-alias');await alias.close();const vault=await context.newPage();const vaultErrors=[];vault.on('pageerror',e=>vaultErrors.push(String(e?.message||e)));res=await vault.goto(`${BASE}/boerenbridge_vault.html?auditplay=core`,{waitUntil:'domcontentloaded',timeout:30000});assert.ok(res&&res.status()<400,`vault entry HTTP ${res?.status()}`);await vault.waitForURL(url=>new URL(url).pathname==='/admin.html',{timeout:7000});u=new URL(vault.url());assert.equal(u.pathname,'/admin.html','Boerenbridge vault must enforce admin perimeter');assert.equal(u.searchParams.get('return_to'),'boerenbridge_vault.html','Boerenbridge vault must preserve protected return target');assert.match(u.searchParams.get('reason')||'',/^session_(?:required|invalid)$/,'Boerenbridge vault must redirect for missing/invalid admin session');noErrors(vaultErrors,'boerenbridge-vault-perimeter');await vault.close();}",
  'explicit spectator alias and vault perimeter acceptance'
);

const roundLoop="for(let round=1;round<=16;round++){await page.locator('#bidOverlay.show').waitFor({timeout:5000});await page.locator('[data-team-choice=\"W\"]').click();await page.locator('[data-suit=\"♠\"]').click();await page.getByRole('button',{name:'Bieding bewaren'}).click();await page.locator('#inputW').fill('90');await page.locator('#saveRoundBtn').click();}";
replaceOnce(
  roundLoop,
  roundLoop+"await page.locator('#matchSummaryOverlay.show').waitFor({timeout:7000});assert.match(await page.locator('#matchSummaryCard').innerText(),/Winnaar/i,'Klaverjas finished summary must render');await page.locator('#matchSummaryOverlay button').filter({hasText:'Sluiten'}).click();await page.waitForFunction(()=>!document.querySelector('#matchSummaryOverlay')?.classList.contains('show'),{timeout:4000});",
  'Klaverjas finished-summary acceptance'
);

source=source.replaceAll('AUDIT_V789_CORE','AUDIT_V790_CORE');
fs.writeFileSync(tempPath,source,'utf8');
try{
  const result=spawnSync(process.execPath,[tempPath],{stdio:'inherit',env:process.env});
  process.exitCode=result.status??1;
} finally {
  try{fs.unlinkSync(tempPath);}catch{}
}
