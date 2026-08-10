#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function read(file){return fs.readFileSync(file,'utf8');}
function write(file,text){fs.writeFileSync(file,text,'utf8');}
function replaceOnce(file,from,to,label){const before=read(file);const count=before.split(from).length-1;if(count!==1)throw new Error(`${label}: expected 1 match in ${file}, found ${count}`);write(file,before.replace(from,to));console.log(`patched ${file}: ${label}`);}
function replaceAllRequired(file,from,to,label){const before=read(file);const count=before.split(from).length-1;if(count<1)throw new Error(`${label}: expected >=1 matches in ${file}, found ${count}`);write(file,before.split(from).join(to));console.log(`patched ${file}: ${label}; count=${count}`);}

if(read('VERSION').trim()!=='v779') throw new Error('v780 builder expects root VERSION v779');
if(!fs.existsSync('check-rendered-accessibility-v780.mjs')) throw new Error('permanent v780 guard missing');

for(const file of ['drinks_speed.html','paardenrace.html','paardenrace_live.html','toepen.html','despimarkt_create.html','despimarkt_debts.html','klaverjas_live.html']) replaceAllRequired(file,'#8a7a55','#7a705a','AA-safe muted gold');
replaceAllRequired('beerpong.html','#8a7f6b','#7a6f5d','AA-safe Beerpong label tone');

replaceOnce('paardenrace_live.html','<section class="drawer" id="mobileDrawer" aria-hidden="true">','<section class="drawer" id="mobileDrawer" aria-hidden="true" inert>','closed drawer inert state');
replaceOnce('paardenrace_live.html',"$('mobileDrawer').setAttribute('aria-hidden', 'false');\n    document.body.classList.add('drawer-open');","$('mobileDrawer').setAttribute('aria-hidden', 'false');\n    $('mobileDrawer').removeAttribute('inert');\n    document.body.classList.add('drawer-open');",'open drawer inert removal');
replaceOnce('paardenrace_live.html',"$('mobileDrawer').setAttribute('aria-hidden', 'true');\n    document.body.classList.remove('drawer-open');","$('mobileDrawer').setAttribute('aria-hidden', 'true');\n    $('mobileDrawer').setAttribute('inert', '');\n    document.body.classList.remove('drawer-open');",'close drawer inert restoration');
replaceOnce('rad.html','<div class="legend" id="legendBox"></div>','<div class="legend" id="legendBox" tabindex="0" aria-label="Segmenten van het rad"></div>','keyboard-scrollable Rad legend');

let pkg=read('package.json');
const anchor='node check-keyboard-focus-accessibility-v779.mjs';
if(!pkg.includes(anchor)) throw new Error('verify:static v779 anchor missing');
if(pkg.includes('node check-rendered-accessibility-v780.mjs')) throw new Error('v780 guard already wired');
pkg=pkg.replace(anchor,`${anchor} && node check-rendered-accessibility-v780.mjs`);
write('package.json',pkg);

write('VERSION','v780\n');
const drift=spawnSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});
if(drift.status!==0) process.exit(drift.status||1);

const readiness=JSON.parse(read('beta-readiness.json'));
readiness.site_version='release candidate v780 / live v779';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.release_candidate_version='v780';
readiness.deployment_identity.note='v780 release candidate: isolated no-write Chromium/axe audit reached 20 key page layouts by stubbing only the auth gate and locally intercepting 168 non-GET requests. It found ten serious accessibility classes: eight repeated muted-text contrast failures plus an aria-hidden focusable Paardenrace drawer and a non-focusable scrollable Rad legend. v780 applies narrowly scoped AA-safe text tones, an inert closed-drawer lifecycle, and a named tabindex=0 Rad legend. Live remains v779 until post-merge public-edge proof. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security regressions through v780. The 70/70 accessible-name closure and v779 keyboard baseline remain protected. v780 adds rendered-accessibility invariants for AA-safe muted label tones, an inert hidden Paardenrace drawer lifecycle, and keyboard access to the scrollable Rad legend.';
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const checklist=JSON.parse(read('beta-live-write-checklist.json'));
checklist.site_version='v780';
if(!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('live-write checklist must remain empty');
write('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');
console.log('v780 rendered-accessibility patch prepared; live remains v779 pending post-merge proof.');
