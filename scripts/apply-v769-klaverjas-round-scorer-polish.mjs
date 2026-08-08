#!/usr/bin/env node
import fs from 'node:fs';

function mustReplace(text, from, to, label){
  if(!text.includes(from)) throw new Error(`Expected source not found: ${label}`);
  return text.replace(from,to);
}

const scorerPath='scorer.html';
let scorer=fs.readFileSync(scorerPath,'utf8').replace(/\r\n/g,'\n');
scorer=mustReplace(
  scorer,
  '<div class="compact-divider">?</div>',
  '<div class="compact-divider">–</div>',
  'compact row separator'
);
scorer=mustReplace(
  scorer,
  "          empty.textContent = 'Kies de bieding om ronde 1 te starten.';",
  "          empty.textContent = `Kies de bieding om ronde ${currentRoundIndex()} te starten.`;",
  'dynamic empty round copy'
);
fs.writeFileSync(scorerPath,scorer,'utf8');

const packagePath='package.json';
const pkg=JSON.parse(fs.readFileSync(packagePath,'utf8'));
const check='node check-klaverjas-round-scorer-polish-v769.mjs';
if(!String(pkg.scripts?.['verify:static']||'').includes(check)) pkg.scripts['verify:static'] += ` && ${check}`;
fs.writeFileSync(packagePath,JSON.stringify(pkg,null,2)+'\n','utf8');
fs.writeFileSync('VERSION','v769\n','utf8');
console.log('Applied v769 Klaverjas round scorer polish and release bump.');
