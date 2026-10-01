#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const rootVersion=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
const ignoredDirs=new Set(['.git','node_modules','dist','build','.next','.vercel','coverage','tmp','temp','patch_bundles','repo','mnt']);
const independent=new Map([
  ['admin_shop_analytics.html','v843'],
  ['admin_shop_connection.html','v828'],
  ['admin_shop_operations.html','v858'],
  ['admin_shop_orders.html','v874'],
  ['shop/index.html','v874'],
]);

function walk(dir,out=[]){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    if(e.isDirectory()){
      if(!ignoredDirs.has(e.name)) walk(path.join(dir,e.name),out);
    } else if(e.name.endsWith('.html')) out.push(path.join(dir,e.name));
  }
  return out;
}

const pages=walk(root);
const failures=[];
for(const file of pages){
  const rel=path.relative(root,file).replaceAll('\\','/');
  const html=fs.readFileSync(file,'utf8');
  const expected=independent.get(rel)||rootVersion;
  const decl=(html.match(/GEJAST_PAGE_VERSION\s*=\s*['"](v\d+)['"]/i)||[])[1]||'';
  const watermarkTags=[...html.matchAll(/<(?:div|span)[^>]*(?:data-version-watermark|class=["'][^"']*(?:version-watermark|watermark)[^"']*["'])[^>]*>([^<]*)</gi)];
  const literalVisible=new RegExp('>\\s*'+expected+'\\s*[^<]{0,20}Made by Bruis\\s*<','i').test(html);
  const hasEmptyWatermark=watermarkTags.some(m=>!(m[1]||'').trim());
  const dynamicWatermark=hasEmptyWatermark && /applyVersionLabel|gejast-version-sync-inline/.test(html);
  if(decl!==expected) failures.push(rel+': declaration '+(decl||'missing')+' expected '+expected);
  if(!literalVisible && !dynamicWatermark){
    failures.push(rel+': visible/runtime watermark missing or wrong; expected '+expected+' - Made by Bruis');
  }
}
assert.equal(pages.length,137,'HTML inventory changed; review the page-version audit when pages are added or removed');
assert.deepEqual(failures,[], 'page version identity failures:\n'+failures.join('\n'));
console.log('All-page version identity PASS:',pages.length,'HTML pages checked.');
console.log('RESULT=ALL_PAGE_VERSION_IDENTITY_V875_PASS');
