#!/usr/bin/env node
import fs from 'node:fs';

function replaceOnce(text,from,to,label){
  if(!text.includes(from)) throw new Error(`Expected source not found: ${label}`);
  return text.replace(from,to);
}

let rad=fs.readFileSync('rad.html','utf8').replace(/\r\n/g,'\n');
rad=replaceOnce(rad,'id="submitNominationBtn" type="button">Opslaan</button>','id="submitNominationBtn" type="button">Kiezen</button>','Rad nomination button');
rad=replaceOnce(rad,'Uitdeel-opdracht opgeslagen voor ${target}.','Uitdeel-opdracht gekozen voor ${target}.','Rad nomination status');
fs.writeFileSync('rad.html',rad,'utf8');

fs.writeFileSync('VERSION','v771\n','utf8');

const readinessPath='beta-readiness.json';
const readiness=JSON.parse(fs.readFileSync(readinessPath,'utf8'));
readiness.site_version='release v771 / post-merge live proof pending';
readiness.deployment_identity.live_version='v771';
readiness.deployment_identity.note='v771 frontend release candidate. The v770 production evidence remains the pre-merge baseline; after merge, hardened live health must confirm deployed /VERSION v771 before this note is finalized.';
fs.writeFileSync(readinessPath,JSON.stringify(readiness,null,2)+'\n');

const packagePath='package.json';
const pkg=JSON.parse(fs.readFileSync(packagePath,'utf8'));
const check='node check-rad-local-nomination-copy-v771.mjs';
if(!String(pkg.scripts?.['verify:static']||'').includes(check)) pkg.scripts['verify:static'] += ` && ${check}`;
fs.writeFileSync(packagePath,JSON.stringify(pkg,null,2)+'\n','utf8');
console.log('Applied v771 Rad truthful nomination copy and release metadata.');
