import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = [
  'drinks_add.html',
  'gejast-drinks-workflow.js',
  'GEJAST_v755h_ice_unit_value_repair.sql',
];

for (const file of files) assert.equal(fs.existsSync(file), true, `${file} exists`);

const drinksAdd = fs.readFileSync('drinks_add.html', 'utf8');
const workflow = fs.readFileSync('gejast-drinks-workflow.js', 'utf8');
const repairSql = fs.readFileSync('GEJAST_v755h_ice_unit_value_repair.sql', 'utf8');

assert.match(drinksAdd, /key:'ice',\s*label:'Ice',\s*unit_value:2\.8/, 'drinks_add fallback keeps Ice at 2.8');
assert.doesNotMatch(drinksAdd, /key:'ice',\s*label:'Ice',\s*unit_value:3(?!\.)/, 'drinks_add fallback must not show Ice as 3.0');
assert.match(workflow, /key:'ice',\s*label:'Ice',\s*unit_value:2\.8/, 'workflow canonical type keeps Ice at 2.8');
assert.doesNotMatch(workflow, /key:'ice',\s*label:'Ice',\s*unit_value:3(?!\.)/, 'workflow canonical type must not show Ice as 3.0');
assert.match(repairSql, /where[\s\S]{0,160}lower\(coalesce\(key,\s*''\)\)\s*=\s*'ice'/i, 'Ice repair targets only the Ice type key');
assert.match(repairSql, /unit_value\s*=\s*2\.8/i, 'Ice repair sets unit_value to 2.8');
assert.doesNotMatch(repairSql, /unit_value\s*=\s*3(?!\.)/i, 'Ice repair must not set unit_value to 3.0');

console.log('Ice unit invariant regression ok. Ice stays 2.8.');
