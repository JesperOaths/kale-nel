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
    const start=Math.max(0,match.index-500), end=Math.min(text.length,match.index+1200);
    const context=text.slice(start,end);
    const usedAsCurrentExpectation =
      new RegExp(`GEJAST_PAGE_VERSION[^;\\n]{0,160}(?:===|==)[^;\\n]{0,80}${name}`).test(context) ||
      new RegExp(`${name}[^;\\n]{0,80}(?:===|==)[^;\\n]{0,160}GEJAST_PAGE_VERSION`).test(context) ||
      new RegExp(`GEJAST_CONFIG[^;\\n]{0,180}(?:===|==)[^;\\n]{0,80}${name}`).test(context) ||
      new RegExp(`${name}[^;\\n]{0,80}(?:===|==)[^;\\n]{0,180}GEJAST_CONFIG`).test(context) ||
      (name==='want' && /__bust/.test(context));
    if(usedAsCurrentExpectation && value!==rootVersion){
      findings.push({file,name,value,rootVersion,pageVersion,kind:name==='want'?'cache_bust_expectation':'current_version_expectation'});
    }
  }
}

console.log(`ROOT_VERSION=${rootVersion}`);
console.log(`STALE_CURRENT_VERSION_EXPECTATIONS=${findings.length}`);
for(const finding of findings) console.log(JSON.stringify(finding));

if(!findings.length) console.log('No stale current-version expectations found.');
