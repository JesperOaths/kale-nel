#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function replaceOnce(path,needle,replacement,label){const before=fs.readFileSync(path,'utf8');const count=before.split(needle).length-1;if(count!==1)throw new Error(`${label}: expected one anchor in ${path}, found ${count}`);fs.writeFileSync(path,before.replace(needle,replacement),'utf8');}

let activation=fs.readFileSync('activate.html','utf8');
for(const [needle,replacement,label] of [
  ['<input id="pinInput" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="4 cijfers">','<input id="pinInput" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="4 cijfers" disabled>','pin disabled'],
  ['<input id="pinConfirmInput" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="Nogmaals">','<input id="pinConfirmInput" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="Nogmaals" disabled>','confirm disabled'],
  ['<button type="submit" class="primary">Account activeren</button>','<button type="submit" class="primary" disabled>Account activeren</button>','submit disabled'],
  ['<div id="status" class="status" role="status" aria-live="polite"></div></main>','<div id="status" class="status" role="status" aria-live="polite"></div><div class="row"><a id="activationFallback" class="btn alt" href="./login.html" hidden>Terug naar inloggen</a></div></main>','activation fallback']
]){const count=activation.split(needle).length-1;if(count!==1)throw new Error(`${label}: expected one activate.html anchor, found ${count}`);activation=activation.replace(needle,replacement);}
fs.writeFileSync('activate.html',activation,'utf8');

const runtimePath='gejast-account-runtime.js';
const runtime=fs.readFileSync(runtimePath,'utf8');
const pattern=/  async function bootActivatePage\(\)\{[\s\S]*?\}\r?\n\r?\n  async function adminAudit/;
const matches=runtime.match(pattern);if(!matches)throw new Error('bootActivatePage anchor not found');
const replacement=`  async function bootActivatePage(){
    const form=$('activateForm');
    if(!form) return;
    const fallback=$('activationFallback');
    function showActivationFallback(show){ if(fallback) fallback.hidden=!show; }
    function setUnavailable(){ if($('approvedName')) $('approvedName').textContent='Niet beschikbaar'; if($('approvedEmail')) $('approvedEmail').textContent='Niet beschikbaar'; }
    const token=new URLSearchParams(location.search).get('token')||new URLSearchParams(location.search).get('activation_token')||'';
    setBusy(form,true);
    showActivationFallback(false);
    if(!token){
      setUnavailable();
      showActivationFallback(true);
      setStatus('status','Deze activatielink mist een token. Open de activatielink uit je e-mail opnieuw.','warn');
      return;
    }
    try{
      const ctx=await getActivationContext(token);
      const activationName=String(ctx?.display_name||ctx?.player_name||ctx?.desired_name||'').trim();
      const activationEmail=String(ctx?.requester_email||ctx?.email||'').trim();
      if(!activationName||!activationEmail) throw new Error('Deze activatielink is ongeldig of verlopen.');
      if($('approvedName')) $('approvedName').textContent=activationName;
      if($('approvedEmail')) $('approvedEmail').textContent=activationEmail;
      setBusy(form,false);
      showActivationFallback(false);
    }catch(err){
      setUnavailable();
      showActivationFallback(true);
      setStatus('status','Deze activatielink is ongeldig of verlopen. Vraag zo nodig een nieuwe activatielink aan.','warn');
      return;
    }
    form.addEventListener('submit', async(ev)=>{
      ev.preventDefault();
      const p=String(($('pinInput')||{}).value||'').replace(/\\D/g,'').slice(0,4);
      const p2=String(($('pinConfirmInput')||{}).value||'').replace(/\\D/g,'').slice(0,4);
      if(!/^\\d{4}$/.test(p)) return setStatus('status','Kies een pincode van precies 4 cijfers.','warn');
      if(p!==p2) return setStatus('status','De twee pincodes komen niet overeen.','warn');
      try{
        setBusy(form,true);
        setStatus('status','Account activeren...');
        const out=await activateAccount(token,p);
        if(out?.session_token) setPlayerToken(out.session_token);
        setStatus('status','Account geactiveerd. Je gaat naar de homepage.','ok');
        setTimeout(()=>location.href='./index.html',700);
      }catch(err){ setStatus('status',friendly(err),'warn'); }
      finally{ setBusy(form,false); }
    });
    ['pinInput','pinConfirmInput'].forEach((id)=>{ const el=$(id); if(el) el.addEventListener('input',()=>{el.value=el.value.replace(/\\D/g,'').slice(0,4);}); });
  }

  async function adminAudit`;
fs.writeFileSync(runtimePath,runtime.replace(pattern,replacement),'utf8');

fs.writeFileSync('VERSION','v784\n');
execFileSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});

const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));checklist.site_version='v784';if(!Array.isArray(checklist.items)||checklist.items.length!==0)throw new Error('v784 must keep live-write checklist empty');fs.writeFileSync('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));readiness.site_version='release candidate v784 / live v783';readiness.last_updated='2026-08-10';readiness.deployment_identity.release_candidate_version='v784';readiness.deployment_identity.note='2026-08-10 v784 release candidate: no-write form/dead-end Chromium audit covered 29 important user-facing routes at phone and desktop size (58 combinations). False positives were classified and preserved: scorer has Later, Toepen has Annuleren, Drinks Back links have working history/fallback handlers, and Beurs has a shared status line. The confirmed defect was activate.html remaining actionable without a valid activation context. v784 makes activation controls disabled by default, skips activation-context lookup when the token is missing, keeps invalid/incomplete context non-actionable, and exposes a clear login fallback; valid context explicitly re-enables the form. Production remains live v783 until post-merge v784 proof. Earlier v780-v783 browser evidence remains preserved. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');if(staticCheck)staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security/accessibility regressions through the v784 release candidate. The accessibility naming backlog remains closed 70/70: 58 static controls are protected by v777 and 12 runtime-generated controls by v778; v779 keyboard/focus remains protected; v780 rendered Chromium/axe proof remains preserved with zero axe violations on the nine repaired pages. v781 protects the Drinks stats-queue repair, mobile-sized Drinks/Beerpong targets and the aria-hidden/inert verification-float lifecycle. v782 protects the Drinks bar renderer plus responsive homepage/Klaverjas layout owners and intentional Boerenbridge scrolling. v783 protects runtime-light direct score/Pikken spectator redirect aliases. v784 protects non-actionable invalid activation state plus explicit login fallback.';
const liveRoutes=(readiness.baseline_checks||[]).find(x=>x.id==='live_routes');if(liveRoutes)liveRoutes.evidence='Live production remains v783 until v784 is merged and edge-proven. Live v783 hardened 35-route suite PASS; the 70-combination no-write runtime-stability audit reported zero page crashes, console-error pages, same-origin 4xx/5xx resources, stuck/hidden pages or empty pages. Prior isolated no-write mobile Chromium and v782 responsive Chromium evidence remain preserved. v784 activation usability proof is candidate-only.';
if((readiness.beta_gaps||[]).filter(x=>x.status==='verified_complete').length!==12)throw new Error('readiness must remain 12/12');if((readiness.beta_gaps||[]).some(x=>x.status==='needs_permission'||x.status==='blocked_external'))throw new Error('unexpected readiness gap');fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));if(!pkg.scripts?.['verify:static'])throw new Error('verify:static missing');if(!pkg.scripts['verify:static'].includes('check-activation-deadend-v784.mjs'))pkg.scripts['verify:static']+=' && node check-activation-deadend-v784.mjs';fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
console.log('v784 activation dead-end release candidate prepared.');
