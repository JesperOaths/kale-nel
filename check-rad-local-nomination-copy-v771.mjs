#!/usr/bin/env node
import fs from 'node:fs';

const rad = fs.readFileSync('rad.html','utf8');
const failures=[];

for(const required of [
  'id="submitNominationBtn" type="button">Kiezen</button>',
  'Uitdeel-opdracht gekozen voor ${target}.',
  "const target=nomineeSelect.value||'';",
  "nomDlg.close();"
]) if(!rad.includes(required)) failures.push(`missing Rad nomination marker: ${required}`);

for(const forbidden of [
  'id="submitNominationBtn" type="button">Opslaan</button>',
  'Uitdeel-opdracht opgeslagen voor ${target}.',
  'rad_log_spin_scoped',
  'rad_log_target_nomination_scoped'
]) if(rad.includes(forbidden)) failures.push(`misleading or inactive persistence marker remains: ${forbidden}`);

if(!rad.includes('window.GEJAST_DRINKS_WORKFLOW.createDrinkEvent')) failures.push('Rad self-drink outcomes must continue using the Drinks workflow');

if(failures.length){
  console.error('Rad local nomination copy v771 failed:');
  failures.forEach((failure)=>console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Rad local nomination copy v771 PASS: target selection is described as local selection, not persisted save.');
