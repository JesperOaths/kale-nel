#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  expectedPageVersion,
  INDEPENDENT_PAGE_VERSIONS,
  isIndependentPageVersion,
  listPublishedHtml,
  listPublishedRoutes,
  pageVersionDeclarations,
  readAdminWorkerVersion,
  readRootVersion,
} from './scripts/published-page-inventory.mjs';

const root=process.cwd();
const rootVersion=readRootVersion(root);
const pages=listPublishedHtml(root);
const routes=listPublishedRoutes(root);
const routeNames=routes.map(x=>x.route);
const duplicateRoutes=routeNames.filter((route,index)=>routeNames.indexOf(route)!==index);
const orphanIndependentOwners=[...INDEPENDENT_PAGE_VERSIONS.keys()].filter(rel=>!pages.includes(rel));
const adminWorker=readAdminWorkerVersion(root);
const adminBuild=adminWorker.build;
const adminPageVersion=adminWorker.pageVersion;
const dynamicWorkerWatermarks=adminWorker.watermarkOwners;
const versionWorkflow=fs.readFileSync(path.join(root,'.github/workflows/page-version-integrity.yml'),'utf8');

function versionTokensFromVisibleOwners(body){
  const tokens=[];
  const patterns=[
    /<[^>]+class=["\'][^"\']*(?:site-credit-watermark|version-watermark)[^"\']*["\'][^>]*>[\s\S]{0,260}?\b(v\d+(?:\.\d+)*)\b/gi,
    /<[^>]+data-version-watermark(?:=["'][^"']*["'])?[^>]*>[\s\S]{0,260}?\b(v\d+(?:\.\d+)*)\b/gi,
    /\b(v\d+)\s*[^\w\r\n<>]{0,12}\s*Made by Bruis\b/gi,
  ];
  for(const pattern of patterns){
    for(const match of body.matchAll(pattern)) tokens.push(match[1]);
  }
  return [...new Set(tokens.map(v=>v.toLowerCase()))];
}

const missing=[];
const ambiguous=[];
const declarationDrift=[];
const watermarkDrift=[];
const gateDrift=[];
const rows=[];

for(const rel of pages){
  const body=fs.readFileSync(path.join(root,rel),'utf8');
  const expected=expectedPageVersion(rel,rootVersion,body);
  const visible=versionTokensFromVisibleOwners(body);
  const dynamicWatermark=/data-version-watermark/i.test(body)&&/applyVersionLabel|gejast-version-sync-inline/i.test(body);
  const pageVersions=[...new Set(pageVersionDeclarations(body))];
  const gates=[...body.matchAll(/gejast-auth-gate\.js\?v(\d+)/gi)].map(m=>'v'+m[1].toLowerCase());
  const uniqueGate=[...new Set(gates)];
  const independent=isIndependentPageVersion(rel);

  if(!visible.length&&!dynamicWatermark) missing.push(rel);
  if(visible.length>1) ambiguous.push(`${rel}: ${visible.join(', ')}`);
  if(pageVersions.length!==1 || pageVersions[0]!==expected){
    declarationDrift.push(`${rel}: declaration=${pageVersions.join('|')||'missing'} expected=${expected}`);
  }
  if(visible.length && (visible.length!==1 || visible[0]!==expected)){
    watermarkDrift.push(`${rel}: visible=${visible.join('|')} expected=${expected}`);
  }
  if(!independent){
    for(const value of uniqueGate){
      if(value!==rootVersion) gateDrift.push(`${rel}: auth-gate=${value} root=${rootVersion}`);
    }
  }

  rows.push({
    rel,
    visible:visible.join('|')||(dynamicWatermark?'DYNAMIC':'MISSING'),
    page:pageVersions.join('|')||'-',
    gate:uniqueGate.join('|')||'-',
    owner:independent?'independent':'shared-gejast',
    expected,
  });
}

for(const row of rows){
  console.log(`PAGE_VERSION_AUDIT ${row.rel} visible=${row.visible} page=${row.page} gate=${row.gate} owner=${row.owner} expected=${row.expected}`);
}
console.log(`PAGE_VERSION_AUDIT_SUMMARY pages=${pages.length} routes=${routes.length} independent_owners=${INDEPENDENT_PAGE_VERSIONS.size} dynamic_worker_pages=2 worker_page=${adminPageVersion||'missing'} missing=${missing.length} ambiguous=${ambiguous.length} declaration_drift=${declarationDrift.length} watermark_drift=${watermarkDrift.length} gate_drift=${gateDrift.length} root=${rootVersion}`);

assert.ok(pages.length>=100,`published HTML inventory unexpectedly small: ${pages.length}`);
assert.ok(routes.length>pages.length,`published route inventory must include index aliases: pages=${pages.length} routes=${routes.length}`);
assert.deepEqual(duplicateRoutes,[],`duplicate published routes detected:\n${duplicateRoutes.join('\n')}`);
assert.deepEqual(orphanIndependentOwners,[],`independent page version owners are not published HTML pages:\n${orphanIndependentOwners.join('\n')}`);
assert.match(adminBuild,/^v\d+-[a-z0-9-]+$/i,'admin Worker build must expose a versioned page owner');
assert.match(adminPageVersion,/^v\d+$/i,'admin Worker dynamic HTML page version must be explicit');
assert.equal(adminPageVersion,rootVersion,'admin Worker dynamic HTML must display the root site VERSION');
assert.ok(dynamicWorkerWatermarks>=2,`admin Worker must watermark both generated HTML pages; found ${dynamicWorkerWatermarks}`);
assert.doesNotMatch(versionWorkflow,/['"]\*\*\/\*\.mjs['"]/, 'page-version integrity must not be restarted by unrelated repository-wide .mjs checker churn');
assert.match(versionWorkflow,/scripts\/wait-for-exact-pages-deployment\.mjs/, 'page-version integrity must retain active Pages surface verification');
assert.match(versionWorkflow,/scripts\/check-live-published-page-versions\.mjs/, 'page-version integrity must retain exhaustive deployed route verification');
assert.deepEqual(missing,[],`published pages missing a visible version watermark/footer:\n${missing.join('\n')}`);
assert.deepEqual(ambiguous,[],`published pages expose multiple conflicting visible page versions:\n${ambiguous.join('\n')}`);
assert.deepEqual(declarationDrift,[],`published pages have source declaration drift:\n${declarationDrift.join('\n')}`);
assert.deepEqual(watermarkDrift,[],`published pages have visible watermark drift:\n${watermarkDrift.join('\n')}`);
assert.deepEqual(gateDrift,[],`published pages have auth-gate version drift from root VERSION:\n${gateDrift.join('\n')}`);

assert.equal(INDEPENDENT_PAGE_VERSIONS.size,0,'independent visible page versions are forbidden');
console.log('RESULT=ALL_PUBLISHED_PAGE_VERSION_INTEGRITY_PASS');
