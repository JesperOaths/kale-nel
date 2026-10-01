#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  expectedPageVersion,
  listPublishedHtml,
  pageVersionDeclarations,
  readRootVersion,
} from './scripts/published-page-inventory.mjs';

const root=process.cwd();
const rootVersion=readRootVersion(root);
const pages=listPublishedHtml(root);
const failures=[];

for(const rel of pages){
  const file=path.join(root,rel);
  const html=fs.readFileSync(file,'utf8');
  const expected=expectedPageVersion(rel,rootVersion,html);
  const declarations=[...new Set(pageVersionDeclarations(html))];
  const watermarkTags=[...html.matchAll(/<(?:div|span)[^>]*(?:data-version-watermark|class=["'][^"']*(?:version-watermark|watermark)[^"']*["'])[^>]*>([^<]*)</gi)];
  const versionFooters=[...html.matchAll(/<footer[^>]*class=["'][^"']*\bversion\b[^"']*["'][^>]*>([^<]*)</gi)];
  const visibleVersionOwners=[...watermarkTags,...versionFooters];
  const literalVisible=new RegExp('>\\s*'+expected+'\\s*[^<]{0,20}Made by Bruis\\s*<','i').test(html);
  const hasEmptyWatermark=watermarkTags.some(m=>!(m[1]||'').trim());
  const dynamicWatermark=hasEmptyWatermark && /applyVersionLabel|gejast-version-sync-inline/.test(html);
  const watermarkVersions=[...new Set(visibleVersionOwners.flatMap(m =>
    [...String(m[1]||'').matchAll(/\bv\d+(?:\.\d+)*(?:[a-z]+\d*)?\b/gi)].map(x=>x[0].toLowerCase())
  ))];
  const staleVisibleVersions=watermarkVersions.filter(v=>v!==expected.toLowerCase());

  if(declarations.length!==1 || declarations[0]!==expected){
    failures.push(rel+': declaration '+(declarations.join('|')||'missing')+' expected '+expected);
  }
  if(!literalVisible && !dynamicWatermark){
    failures.push(rel+': visible/runtime watermark missing or wrong; expected '+expected+' - Made by Bruis');
  }
  if(staleVisibleVersions.length){
    failures.push(rel+': stale/conflicting visible watermark version(s) '+staleVisibleVersions.join('|')+' expected '+expected);
  }
}

assert.ok(pages.length>=100,'HTML inventory unexpectedly small: '+pages.length);
assert.deepEqual(failures,[], 'page version identity failures:\n'+failures.join('\n'));
console.log('All-page version identity PASS:',pages.length,'published HTML pages checked.');
console.log('RESULT=ALL_PAGE_VERSION_IDENTITY_SITE_WIDE_PASS');
