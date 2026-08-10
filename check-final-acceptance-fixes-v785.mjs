#!/usr/bin/env node
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
const failures=[];
if(versionNumber<785) failures.push('v785 final-acceptance guard requires VERSION >= v785');
const contrastFiles=['index.html','klaverjas_scorer_v596_repo_ready.html','boerenbridge_live.html','paardenrace_spectator.html','drinks_add.html','activate.html'];
for(const file of contrastFiles){const text=fs.readFileSync(file,'utf8');if(text.includes('#8a7a55')) failures.push(file+' reintroduced the audited low-contrast #8a7a55 token');}
const home=fs.readFileSync('index.html','utf8');
if(/class="ladder-open-link"[^>]*color:var\(--gold\)/.test(home)) failures.push('homepage ladder-open-link must not use decorative --gold as text on white');
const scorer=fs.readFileSync('klaverjas_scorer_v596_repo_ready.html','utf8');
for(const [id,label] of [['a1','Team A speler 1'],['a2','Team A speler 2'],['b1','Team B speler 1'],['b2','Team B speler 2'],['roemA','Roem Team A'],['roemB','Roem Team B'],['notes','Notitie']]){
  if(!scorer.includes('<label for="'+id+'">'+label+'</label>')) failures.push('standalone Klaverjas scorer label missing binding for '+id);
}
const rad=fs.readFileSync('rad.html','utf8');
for(const marker of ['.layout{grid-template-columns:minmax(0,1fr)}','.panel{min-width:0}.wheel-box{width:min(100%,460px)}','@media(max-width:640px){.page{padding:12px 8px 36px}']) if(!rad.includes(marker)) failures.push('Rad mobile containment marker missing: '+marker);
for(const path of ['V785_DIAGNOSTIC_RESULTS.json','V785_DIAGNOSTIC_SUMMARY.txt','scripts/diagnose-v785-final-findings.mjs','scripts/summarize-v785-diagnostic.mjs']) if(fs.existsSync(path)) failures.push('temporary v785 diagnostic residue remains: '+path);
if(failures.length){console.error('v785 final acceptance regression failed:');for(const f of failures) console.error('- '+f);process.exit(1);}
console.log('v785 final acceptance regression PASS: audited contrast owners are AA-safe, standalone Klaverjas fields are labelled, Rad mobile containment is retained, and diagnostic residue is absent.');
