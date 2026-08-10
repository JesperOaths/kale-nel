#!/usr/bin/env node
import fs from 'node:fs';

const TARGET='v785';
const CURRENT='v784';
const SAFE_TEXT='#827148';

function read(path){return fs.readFileSync(path,'utf8');}
function write(path,text){fs.writeFileSync(path,text,'utf8');}
function replaceAllRequired(path,needle,replacement,min=1){
  const before=read(path);
  const count=before.split(needle).length-1;
  if(count<min) throw new Error(`${path}: expected at least ${min} occurrence(s) of ${needle}, found ${count}`);
  write(path,before.split(needle).join(replacement));
  console.log(`${path}: replaced ${count} occurrence(s)`);
}
function replaceOnce(path,needle,replacement){
  const before=read(path);
  const count=before.split(needle).length-1;
  if(count!==1) throw new Error(`${path}: expected exactly one occurrence of ${needle}, found ${count}`);
  write(path,before.replace(needle,replacement));
  console.log(`${path}: replaced exact owner`);
}

const rootVersion=read('VERSION').trim();
if(rootVersion!==CURRENT) throw new Error(`v785 builder requires root VERSION ${CURRENT}, got ${rootVersion}`);

// Shared low-contrast final-acceptance owner: darken only the audited small text token.
for(const path of ['index.html','klaverjas_scorer_v596_repo_ready.html','boerenbridge_live.html','paardenrace_spectator.html','drinks_add.html','activate.html']){
  replaceAllRequired(path,'#8a7a55',SAFE_TEXT,1);
}

// Homepage Drinks headings used the decorative gold variable as text on white; keep gold backgrounds unchanged.
replaceAllRequired(
  'index.html',
  'class="ladder-open-link" style="font-size:13px;font-weight:800;color:var(--gold);text-decoration:none"',
  `class="ladder-open-link" style="font-size:13px;font-weight:800;color:${SAFE_TEXT};text-decoration:none"`,
  1
);

// Standalone Klaverjas scorer: bind every visible field label to its control.
const scorerLabels=[
  ['<label>Team A speler 1</label><select id="a1">','<label for="a1">Team A speler 1</label><select id="a1">'],
  ['<label>Team A speler 2</label><select id="a2">','<label for="a2">Team A speler 2</label><select id="a2">'],
  ['<label>Team B speler 1</label><select id="b1">','<label for="b1">Team B speler 1</label><select id="b1">'],
  ['<label>Team B speler 2</label><select id="b2">','<label for="b2">Team B speler 2</label><select id="b2">'],
  ['<label>Roem Team A</label><input id="roemA"','<label for="roemA">Roem Team A</label><input id="roemA"'],
  ['<label>Roem Team B</label><input id="roemB"','<label for="roemB">Roem Team B</label><input id="roemB"'],
  ['<label>Notitie</label><textarea id="notes"','<label for="notes">Notitie</label><textarea id="notes"']
];
for(const [from,to] of scorerLabels) replaceOnce('klaverjas_scorer_v596_repo_ready.html',from,to);

// Rad: on small screens size the grid track and wheel to their containing panel, not viewport width.
replaceOnce(
  'rad.html',
  '@media(max-width:980px){.layout{grid-template-columns:1fr}.wheel-box{width:min(88vw,460px)}}',
  '@media(max-width:980px){.layout{grid-template-columns:minmax(0,1fr)}.panel{min-width:0}.wheel-box{width:min(100%,460px)}}@media(max-width:640px){.page{padding:12px 8px 36px}.shell{padding:14px}.panel{padding:12px}.layout{gap:14px;margin-top:14px}}'
);

// Permanent regression for the exact final-acceptance owners.
const guard=`#!/usr/bin/env node
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\\d+)$/)?.[1]||0);
const failures=[];
if(versionNumber<785) failures.push('v785 final-acceptance guard requires VERSION >= v785');
const contrastFiles=['index.html','klaverjas_scorer_v596_repo_ready.html','boerenbridge_live.html','paardenrace_spectator.html','drinks_add.html','activate.html'];
for(const file of contrastFiles){const text=fs.readFileSync(file,'utf8');if(text.includes('#8a7a55')) failures.push(file+' reintroduced the audited low-contrast #8a7a55 token');}
const home=fs.readFileSync('index.html','utf8');
if(/class="ladder-open-link"[^>]*color:var\\(--gold\\)/.test(home)) failures.push('homepage ladder-open-link must not use decorative --gold as text on white');
const scorer=fs.readFileSync('klaverjas_scorer_v596_repo_ready.html','utf8');
for(const [id,label] of [['a1','Team A speler 1'],['a2','Team A speler 2'],['b1','Team B speler 1'],['b2','Team B speler 2'],['roemA','Roem Team A'],['roemB','Roem Team B'],['notes','Notitie']]){
  if(!scorer.includes('<label for="'+id+'">'+label+'</label>')) failures.push('standalone Klaverjas scorer label missing binding for '+id);
}
const rad=fs.readFileSync('rad.html','utf8');
for(const marker of ['.layout{grid-template-columns:minmax(0,1fr)}','.panel{min-width:0}.wheel-box{width:min(100%,460px)}','@media(max-width:640px){.page{padding:12px 8px 36px}']) if(!rad.includes(marker)) failures.push('Rad mobile containment marker missing: '+marker);
for(const path of ['V785_DIAGNOSTIC_RESULTS.json','V785_DIAGNOSTIC_SUMMARY.txt','scripts/diagnose-v785-final-findings.mjs','scripts/summarize-v785-diagnostic.mjs']) if(fs.existsSync(path)) failures.push('temporary v785 diagnostic residue remains: '+path);
if(failures.length){console.error('v785 final acceptance regression failed:');for(const f of failures) console.error('- '+f);process.exit(1);}
console.log('v785 final acceptance regression PASS: audited contrast owners are AA-safe, standalone Klaverjas fields are labelled, Rad mobile containment is retained, and diagnostic residue is absent.');
`;
write('check-final-acceptance-fixes-v785.mjs',guard);

// Wire the new guard into permanent static verification.
replaceOnce(
  'package.json',
  'node check-activation-deadend-v784.mjs && node check-activation-live-evidence-v784.mjs"',
  'node check-activation-deadend-v784.mjs && node check-activation-live-evidence-v784.mjs && node check-final-acceptance-fixes-v785.mjs"'
);

// Release bookkeeping remains 12/12 and zero-write; v785 is a frontend release candidate until post-merge live proof.
const checklist=JSON.parse(read('beta-live-write-checklist.json'));
checklist.site_version=TARGET;
write('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');

const readiness=JSON.parse(read('beta-readiness.json'));
readiness.site_version=`release candidate ${TARGET} / live ${CURRENT}`;
readiness.last_updated='2026-08-10';
readiness.deployment_identity=readiness.deployment_identity||{};
readiness.deployment_identity.release_candidate_version=TARGET;
const staticIntegrity=(readiness.baseline_checks||[]).find((item)=>item.id==='static_integrity');
if(staticIntegrity){
  staticIntegrity.evidence=String(staticIntegrity.evidence||'').replace('through v784','through v785');
  if(!staticIntegrity.evidence.includes('v785 final-acceptance')) staticIntegrity.evidence += ' v785 final-acceptance protects AA-safe audited text contrast, explicit standalone Klaverjas field labels/names, and Rad phone-width containment.';
}
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

write('VERSION',TARGET+'\n');
console.log(`Prepared ${TARGET} targeted final-acceptance fixes; run fix-version-drift.mjs next.`);
