#!/usr/bin/env node
import fs from 'node:fs';

const rootVersion = fs.readFileSync('VERSION','utf8').trim();
const files = fs.readdirSync('.').filter((f)=>/\.(?:html|js|mjs)$/i.test(f)).sort();
const findings=[];

for(const file of files){
  const text=fs.readFileSync(file,'utf8');
  const pageVersion=(text.match(/GEJAST_PAGE_VERSION\s*=\s*['"](v\d+)['"]/i)||[])[1]||'';
  for(const match of text.matchAll(/\b(?:const|let|var)\s+(VERSION|TARGET|want)\s*=\s*['"](v\d+)['"]/g)){
    const [,name,value]=match;
    const usedAsCurrentExpectation =
      new RegExp(`GEJAST_PAGE_VERSION[\\s\\S]{0,4000}(?:===|==)[^;\\n]{0,120}${name}`).test(text) ||
      new RegExp(`${name}[^;\\n]{0,120}(?:===|==)[\\s\\S]{0,4000}GEJAST_PAGE_VERSION`).test(text) ||
      new RegExp(`GEJAST_CONFIG[\\s\\S]{0,4000}(?:===|==)[^;\\n]{0,120}${name}`).test(text) ||
      new RegExp(`${name}[^;\\n]{0,120}(?:===|==)[\\s\\S]{0,4000}GEJAST_CONFIG`).test(text) ||
      (name==='want' && /__bust/.test(text));
    if(usedAsCurrentExpectation && value!==rootVersion){
      findings.push({file,name,value,rootVersion,pageVersion,kind:name==='want'?'cache_bust_expectation':'current_version_expectation'});
    }
  }
}

console.log(`ROOT_VERSION=${rootVersion}`);
console.log(`STALE_CURRENT_VERSION_EXPECTATIONS=${findings.length}`);
for(const finding of findings) console.log(JSON.stringify(finding));

if(!findings.length) console.log('No stale current-version expectations found.');
