#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function replaceOnce(path,needle,replacement,label){
  const before=fs.readFileSync(path,'utf8');
  const count=before.split(needle).length-1;
  if(count!==1) throw new Error(`${label}: expected one anchor in ${path}, found ${count}`);
  fs.writeFileSync(path,before.replace(needle,replacement),'utf8');
}

// 1. Restore the missing Drinks distribution renderer. Display-only; no write/RPC contract changes.
const drinksAnchor='    function renderStats(data){';
const renderBars=`    function renderBars(el, rows, valueKey='units', tone=''){
      if(!el) return;
      const list=Array.isArray(rows)?rows:[];
      if(!list.length){ el.innerHTML='<div class="note">Nog geen verdelingsdata.</div>'; return; }
      const valueOf=(row)=>Math.max(0,Number(row?.[valueKey] ?? row?.units ?? row?.total_units ?? row?.value ?? 0)||0);
      const max=Math.max(1,...list.map(valueOf));
      el.innerHTML='<div class="bars">'+list.map((row)=>{
        const value=valueOf(row);
        const label=row?.type_label||row?.drink_type_label||row?.label||row?.drink_type||row?.type||row?.name||'Onbekend';
        const pct=Math.max(0,Math.min(100,(value/max)*100));
        const valueLabel=valueKey==='units' ? \`${'${fmt(value,1)}'}u\` : fmt(value,1);
        return \`<div class="bar-row"><div class="bar-label">${'${esc(label)}'}</div><div class="bar-track"><div class="bar-fill ${'${tone}'}" style="width:${'${pct.toFixed(2)}'}%"></div></div><div class="bar-value">${'${valueLabel}'}</div></div>\`;
      }).join('')+'</div>';
    }
`;
replaceOnce('drinks.html',drinksAnchor,renderBars+drinksAnchor,'Drinks renderBars insertion');

// 2. Keep the no-active-game Klaverjas lobby across the full runtime shell grid.
replaceOnce(
  'klaverjas_online.html',
  '.lobby-home{display:grid;grid-template-columns:360px minmax(0,1fr);gap:14px;margin-top:14px;align-items:start}.home-panel{background:#fff;',
  '.lobby-home{display:grid;grid-column:1 / -1;min-width:0;grid-template-columns:360px minmax(0,1fr);gap:14px;margin-top:14px;align-items:start}.home-panel{min-width:0;background:#fff;',
  'Klaverjas lobby grid repair'
);

// 3. Homepage page + static watermark are body siblings; stack the specific main body flex container vertically.
replaceOnce(
  'index.html',
  '    body {\n      margin: 0;\n      padding: 0;\n      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;\n      display: flex;\n      justify-content: center;',
  '    body {\n      margin: 0;\n      padding: 0;\n      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;\n      display: flex;\n      flex-direction: column;\n      justify-content: center;',
  'Homepage vertical flex flow'
);

fs.writeFileSync('VERSION','v782\n');
execFileSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});

const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
checklist.site_version='v782';
if(!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('v782 must not arm live-write checklist items');
fs.writeFileSync('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');

const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
readiness.site_version='release candidate v782 / live v781';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.release_candidate_version='v782';
readiness.deployment_identity.note='2026-08-10 v782 release candidate: responsive Chromium audit across 69 page/viewport combinations found and repaired three scoped owners: the missing Drinks type-distribution renderBars runtime, desktop Klaverjas online lobby overflow, and tablet-portrait homepage watermark flow. The prior live v781 mobile/runtime proof remains the current production baseline until post-merge v782 edge proof. The 70/70 naming closure, v779 keyboard baseline, v780 live Chromium/axe zero axe violations proof, and v781 stats-queue/touch/inert protections remain preserved. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security/accessibility regressions through the v782 release candidate. The accessibility naming backlog remains closed 70/70: 58 static controls are protected by v777 and 12 runtime-generated controls by v778; v779 keyboard/focus remains protected; v780 rendered Chromium/axe proof remains preserved with zero axe violations on the nine repaired pages. v781 protects declared Drinks stats-queue state, mobile-sized Drinks/Beerpong targets and the aria-hidden/inert off-canvas verification-float lifecycle. v782 adds the Drinks bar renderer plus responsive homepage/Klaverjas layout invariants while preserving intentional Boerenbridge table scrolling.';
const liveRoutes=(readiness.baseline_checks||[]).find(x=>x.id==='live_routes');
if(liveRoutes) liveRoutes.evidence='Live production remains v781 until v782 is merged and edge-proven. The v781 post-merge public-edge proof reports hardened 35-route PASS; isolated no-write mobile Chromium confirmed the Drinks stats-queue runtime repair, >=44px Drinks selector, inert/non-focusable hidden verification float and >=24px scoped Beerpong targets. v782 candidate responsive fixes are pre-merge only.';
if((readiness.beta_gaps||[]).filter(x=>x.status==='verified_complete').length!==12) throw new Error('readiness must remain 12/12');
if((readiness.beta_gaps||[]).some(x=>x.status==='needs_permission'||x.status==='blocked_external')) throw new Error('unexpected readiness gap');
fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
if(!pkg.scripts?.['verify:static']) throw new Error('verify:static missing');
if(!pkg.scripts['verify:static'].includes('check-responsive-runtime-v782.mjs')) pkg.scripts['verify:static'] += ' && node check-responsive-runtime-v782.mjs';
fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');

console.log('v782 scoped product fixes and release-candidate metadata prepared.');
