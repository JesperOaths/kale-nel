#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const targets = [
  'get_live_match_summary_public_scoped',
  'get_live_match_summary_public',
  'get_homepage_live_state_public_scoped',
  'get_homepage_live_state_public'
];

function walk(dir, out=[]){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(entry.name==='.git'||entry.name==='node_modules') continue;
    const p=path.join(dir,entry.name);
    if(entry.isDirectory()) walk(p,out); else out.push(p);
  }
  return out;
}
const sqlFiles=walk('.').filter((file)=>/\.sql$/i.test(file));

for(const target of targets){
  console.log(`\n### ${target}`);
  let count=0;
  for(const file of sqlFiles){
    const text=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
    const lower=text.toLowerCase();
    const needle=`create or replace function public.${target.toLowerCase()}`;
    let from=0;
    while(true){
      const idx=lower.indexOf(needle,from);
      if(idx<0) break;
      count+=1;
      const rel=file.replace(/^\.\//,'').replaceAll('\\','/');
      const snippet=text.slice(idx,Math.min(text.length,idx+4500));
      console.log(`-- SOURCE ${rel} OCCURRENCE ${count}`);
      console.log(snippet);
      console.log('-- END SNIPPET');
      from=idx+needle.length;
    }
  }
  console.log(`DEFINITION_COUNT ${target}=${count}`);
}

const liveSummary=fs.readFileSync('gejast-live-summary.js','utf8');
for(const target of targets){
  const lines=liveSummary.split(/\r?\n/).filter((line)=>line.includes(target));
  console.log(`\nFRONTEND_CALLS ${target}=${lines.length}`);
  lines.forEach((line)=>console.log(line.trim()));
}

console.log('\n### game_match_summaries site-scope references');
let scopeRefs=0;
for(const file of sqlFiles){
  const text=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
  if(!/game_match_summaries/i.test(text)||!/site_scope/i.test(text)) continue;
  const rel=file.replace(/^\.\//,'').replaceAll('\\','/');
  const lines=text.split('\n');
  const interesting=lines.filter((line)=>/game_match_summaries|site_scope/i.test(line));
  console.log(`-- ${rel}`);
  interesting.slice(0,100).forEach((line)=>console.log(line.trim()));
  scopeRefs+=1;
}
console.log(`GAME_MATCH_SUMMARY_SCOPE_FILES=${scopeRefs}`);
