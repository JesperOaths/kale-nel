#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const files=fs.readdirSync('.').filter(f=>/\.html$/i.test(f) && !/^(?:admin|familie_admin)|_vault\.html$|^vault\.html$|(?:test|debug|diagnostic|health|runtime|audit|preview|export)|_orig\.html$|_v\d+.*\.html$|_repo.*\.html$/i.test(f)).sort();
const ignore=new Set(['login.html','request.html','activate.html']);
const findings=[];
function lineOf(text,index){return text.slice(0,index).split('\n').length;}
function inScript(text,index){return text.lastIndexOf('<script',index)>text.lastIndexOf('</script>',index);}
function attr(tag,name){const m=tag.match(new RegExp('\\b'+name+'\\s*=\\s*["\\']([^"\\']*)["\\']','i'));return m?m[1]:'';}
function hasName(text,tag,index){
  if(/\b(?:aria-label|aria-labelledby|title)\s*=\s*["'][^"']+/i.test(tag)) return true;
  const id=attr(tag,'id');
  if(id){
    const escaped=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if(new RegExp('<label\\b[^>]*for=["\\']'+escaped+'["\\']','i').test(text)) return true;
  }
  const before=text.slice(Math.max(0,index-250),index);
  const open=before.lastIndexOf('<label');
  const close=before.lastIndexOf('</label>');
  if(open>close) return true;
  return false;
}

for(const file of files){
  if(ignore.has(file)) continue;
  const text=fs.readFileSync(file,'utf8');
  const rx=/<(?:input|select|textarea)\b[^>]*>/gi;
  for(const m of text.matchAll(rx)){
    const tag=m[0]; const index=m.index||0;
    if(/\btype\s*=\s*["']hidden["']/i.test(tag)) continue;
    if(hasName(text,tag,index)) continue;
    const script=inScript(text,index);
    const id=attr(tag,'id'); const cls=attr(tag,'class'); const type=attr(tag,'type')||tag.match(/^<(input|select|textarea)/i)?.[1]||'';
    const context=text.slice(Math.max(0,index-130),Math.min(text.length,index+tag.length+170)).replace(/\s+/g,' ').trim();
    findings.push({file,line:lineOf(text,index),kind:script?'dynamic-context':'static-control',element:tag.match(/^<(input|select|textarea)/i)?.[1],id:id||null,class:cls||null,type:type||null,context});
  }
}

const staticFindings=findings.filter(x=>x.kind==='static-control');
const dynamicFindings=findings.filter(x=>x.kind==='dynamic-context');
console.log(`UNNAMED_CONTROLS_TOTAL=${findings.length}`);
console.log(`STATIC_SAFE_CANDIDATES=${staticFindings.length}`);
console.log(`DYNAMIC_CONTEXT_CANDIDATES=${dynamicFindings.length}`);
for(const f of findings) console.log(JSON.stringify(f));

const byFile={};
for(const f of findings){const k=f.file;byFile[k]??={static:0,dynamic:0};byFile[k][f.kind==='static-control'?'static':'dynamic']++;}
console.log('BY_FILE='+JSON.stringify(byFile));
