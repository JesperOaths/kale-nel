#!/usr/bin/env node
/* GEJAST version drift checker.
   Fails when active frontend files contain a hardcoded visible/cache-buster v### that
   differs from the single site-wide root VERSION. Internal API/build identifiers may
   remain independently versioned only when they are not page-version owners. */
import fs from 'node:fs';
import path from 'node:path';
import {
  listTrackedFiles,
  readRootVersion,
} from './scripts/published-page-inventory.mjs';

const root=process.cwd();
const rootVersion=readRootVersion(root);
const activeExt=new Set(['.html','.js','.mjs','.css']);
const ignoredFiles=new Set(['check-version-drift.mjs','fix-version-drift.mjs']);
const ignoredPrefixes=['node_modules/','dist/','build/','.next/','.vercel/','coverage/','tmp/','temp/','patch_bundles/','repo/','mnt/'];
const versionPattern=/(?:\?v\d+|GEJAST_(?:PAGE|SITE)_VERSION\s*=\s*['"]v\d+['"]|VERSION\s*:\s*['"]v\d+['"]|v\d+\s*[^\w\r\n<>]{0,12}\s*Made by Bruis)/gi;

function normalizeVersion(value){
  const match=String(value||'').match(/v?\s*(\d+)/i);
  return match ? `v${match[1]}` : '';
}
function isArchivedFile(rel){
  const base=path.basename(rel);
  if(/^gejast-v\d+-repair\.js$/i.test(base)&&!base.toLowerCase().includes(rootVersion.toLowerCase())) return true;
  if(/^README_v\d+/i.test(base)||/^PATCH_NOTES_v\d+/i.test(base)||/^GEJAST_v\d+/i.test(base)) return true;
  return false;
}
function isAllowedLegacyReference(rel,found){
  // Narrow compatibility/test exception; never applies to a page watermark/declaration.
  return found==='v827'&&rel==='scripts/test-shop-production-connection-v827.mjs';
}

const offenders=[];
let scannedFiles=0;
for(const rel of listTrackedFiles(root)){
  if(ignoredPrefixes.some(prefix=>rel.startsWith(prefix))) continue;
  if(isArchivedFile(rel)) continue;
  if(rel.startsWith('check-')) continue;
  if(ignoredFiles.has(path.basename(rel))) continue;
  if(!activeExt.has(path.extname(rel).toLowerCase())) continue;
  const file=path.join(root,rel);
  if(!fs.existsSync(file)) continue;
  const text=fs.readFileSync(file,'utf8');
  const expected=rootVersion;
  scannedFiles++;
  for(const match of text.matchAll(versionPattern)){
    const found=normalizeVersion(match[0]);
    if(found&&found!==expected&&!isAllowedLegacyReference(rel,found)){
      offenders.push({file:rel,found,expected,text:match[0]});
    }
  }
}

if(offenders.length){
  console.error(`Version drift found. Shared root VERSION is ${rootVersion}.`);
  for(const item of offenders) console.error(`- ${item.file}: ${item.text} -> ${item.found}; expected ${item.expected}`);
  process.exit(1);
}
console.log(`No version drift found across ${scannedFiles} tracked runtime source files. Every visible/cache-buster page version follows root VERSION ${rootVersion}.`);
console.log('RESULT=VERSION_DRIFT_SITEWIDE_PASS');
