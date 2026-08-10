#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const excludeBasename = /(?:^admin(?:[_-]|\.html$)|_vault\.html$|^vault\.html$|(?:^|[_-])(?:test|debug|diagnostic|health|runtime|audit|preview|export)(?:[_-]|\.html$)|_orig\.html$|_v\d+.*\.html$|_repo.*\.html$)/i;
const includeDirs = ['.', 'familie'];
const files=[];
for(const dir of includeDirs){
  for(const name of fs.readdirSync(dir)){
    const file=dir==='.'?name:path.join(dir,name);
    if(!/\.html$/i.test(name) || excludeBasename.test(name)) continue;
    if(fs.statSync(file).isFile()) files.push(file.replaceAll('\\','/'));
  }
}
files.sort();

function stripNonVisible(html){
  return html
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ')
    .trim();
}
function snippets(text,rx){
  const out=[];
  for(const m of text.matchAll(rx)){
    const i=m.index||0;
    out.push(text.slice(Math.max(0,i-55),Math.min(text.length,i+String(m[0]).length+80)).trim());
    if(out.length>=4) break;
  }
  return out;
}
const devPatterns=[
  ['phase',/\bphase\s*\d+/ig],
  ['proof',/\b(?:proof|regression|smoke\s*test|test\s*console)\b/ig],
  ['backend-jargon',/\b(?:RPC|SQL|Supabase schema cache|runtime owner|fallback RPC)\b/ig],
  ['release-jargon',/\bv\d{3,}\b/ig],
  ['unfinished',/\b(?:TODO|FIXME|WIP|placeholder|coming soon|nog implementeren|nog niet geimplementeerd|nog niet geïmplementeerd)\b/ig]
];

const findings=[];
const summaries=[];
for(const file of files){
  const html=fs.readFileSync(file,'utf8');
  const visible=stripNonVisible(html);
  const item={file,issues:[]};
  if(!/<html\b[^>]*\blang=["'][^"']+["']/i.test(html)) item.issues.push({kind:'missing-lang'});
  if(!/<title>\s*[^<\s][\s\S]*?<\/title>/i.test(html)) item.issues.push({kind:'missing-title'});
  if(!/<meta\b[^>]*name=["']viewport["']/i.test(html)) item.issues.push({kind:'missing-viewport'});
  const images=[...html.matchAll(/<img\b[^>]*>/gi)].map(m=>m[0]);
  const missingAlt=images.filter(tag=>!(/\balt\s*=/.test(tag)));
  if(missingAlt.length) item.issues.push({kind:'images-missing-alt',count:missingAlt.length,samples:missingAlt.slice(0,3)});
  const buttons=[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  const unlabeledButtons=buttons.filter(([,attrs,body])=>{
    const text=stripNonVisible(body);
    return !text && !/\b(?:aria-label|title)\s*=\s*["'][^"']+/i.test(attrs);
  });
  if(unlabeledButtons.length) item.issues.push({kind:'unlabeled-buttons',count:unlabeledButtons.length,samples:unlabeledButtons.slice(0,3).map(m=>m[0].slice(0,180))});
  const anchors=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const deadAnchors=anchors.filter(([,attrs])=>/\bhref\s*=\s*["'](?:\s*|#|javascript:void\(0\);?)["']/i.test(attrs) && !/\bonclick\s*=/.test(attrs));
  if(deadAnchors.length) item.issues.push({kind:'dead-anchors',count:deadAnchors.length,samples:deadAnchors.slice(0,3).map(m=>m[0].slice(0,180))});
  for(const [kind,rx] of devPatterns){
    const hits=snippets(visible,rx);
    if(hits.length) item.issues.push({kind:`visible-${kind}`,count:hits.length,samples:hits});
  }
  if(item.issues.length) findings.push(item);
  summaries.push({file,visibleChars:visible.length,images:images.length,buttons:buttons.length,anchors:anchors.length,issues:item.issues.length});
}

console.log(`PUBLIC_USER_HTML=${files.length}`);
console.log(`FILES_WITH_FINDINGS=${findings.length}`);
for(const f of findings) console.log(JSON.stringify(f));
console.log('SUMMARY='+JSON.stringify(summaries));
