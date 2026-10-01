#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const rootVersion = fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
assert.match(rootVersion,/^v\d+$/i,'root VERSION must be v###');

const nonRuntimePrefixes = [
  'cloudflare/','scripts/','sql/','repo/','mnt/','deployment_forensics_v761/','RELEASES/','docs/'
];

const tracked = execFileSync('git',['ls-files'],{encoding:'utf8'})
  .split(/\r?\n/)
  .filter(Boolean);

const pages = tracked
  .filter(file => file.toLowerCase().endsWith('.html'))
  .filter(file => !nonRuntimePrefixes.some(prefix => file.startsWith(prefix)))
  .sort();

function versionTokensFromVisibleOwners(body){
  const tokens = [];
  const patterns = [
    /<[^>]+class=["'][^"']*(?:site-credit-watermark|version-watermark|\bversion\b)[^"']*["'][^>]*>[\s\S]{0,260}?\b(v\d+(?:\.\d+)*)\b/gi,
    /<[^>]+data-version-watermark(?:=["'][^"']*["'])?[^>]*>[\s\S]{0,260}?\b(v\d+(?:\.\d+)*)\b/gi,
    /\b(v\d+)\s*[^\w\r\n<>]{0,12}\s*Made by Bruis\b/gi
  ];
  for(const pattern of patterns){
    for(const match of body.matchAll(pattern)) tokens.push(match[1]);
  }
  return [...new Set(tokens.map(v=>v.toLowerCase()))];
}

const independentPageVersions = new Set(['admin_shop_analytics.html','admin_shop_connection.html','admin_shop_operations.html','admin_shop_orders.html']);

const missing=[];
const ambiguous=[];
const rootDrift=[];
const gateDrift=[];
const rows=[];

for(const rel of pages){
  const body=fs.readFileSync(path.join(root,rel),'utf8');
  const visible=versionTokensFromVisibleOwners(body);
  const pageVersions=[...body.matchAll(/GEJAST_(?:PAGE|SITE)_VERSION\s*=\s*['"](v\d+)['"]/gi)].map(m=>m[1].toLowerCase());
  const gates=[...body.matchAll(/gejast-auth-gate\.js\?v(\d+)/gi)].map(m=>'v'+m[1]);
  const uniquePage=[...new Set(pageVersions)];
  const uniqueGate=[...new Set(gates)];
  const rootOwned = !independentPageVersions.has(rel) && (uniquePage.length>0 || uniqueGate.length>0);

  if(!visible.length) missing.push(rel);
  if(visible.length>1) ambiguous.push(`${rel}: ${visible.join(', ')}`);
  if(rootOwned){
    for(const value of uniquePage){
      if(value!==rootVersion.toLowerCase()) rootDrift.push(`${rel}: page=${value} root=${rootVersion}`);
    }
    for(const value of uniqueGate){
      if(value!==rootVersion.toLowerCase()) gateDrift.push(`${rel}: auth-gate=${value} root=${rootVersion}`);
    }
  }
  rows.push({
    rel,
    visible:visible.join('|')||'MISSING',
    page:uniquePage.join('|')||'-',
    gate:uniqueGate.join('|')||'-',
    owner:rootOwned?'shared-gejast':'independent'
  });
}

for(const row of rows){
  console.log(`PAGE_VERSION_AUDIT ${row.rel} visible=${row.visible} page=${row.page} gate=${row.gate} owner=${row.owner}`);
}
console.log(`PAGE_VERSION_AUDIT_SUMMARY pages=${pages.length} missing=${missing.length} ambiguous=${ambiguous.length} root_drift=${rootDrift.length} gate_drift=${gateDrift.length} root=${rootVersion}`);

assert.ok(pages.length>=100,`published HTML inventory unexpectedly small: ${pages.length}`);
assert.deepEqual(missing,[],`published pages missing a visible version watermark/footer:\n${missing.join('\n')}`);
assert.deepEqual(ambiguous,[],`published pages expose multiple conflicting visible page versions:\n${ambiguous.join('\n')}`);
assert.deepEqual(rootDrift,[],`shared GEJAST pages have page-version drift:\n${rootDrift.join('\n')}`);
assert.deepEqual(gateDrift,[],`shared GEJAST pages have auth-gate version drift:\n${gateDrift.join('\n')}`);

console.log('RESULT=ALL_PUBLISHED_PAGE_VERSION_INTEGRITY_PASS');
