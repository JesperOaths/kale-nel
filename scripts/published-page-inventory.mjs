#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const NON_RUNTIME_HTML_PREFIXES = Object.freeze([
  'cloudflare/',
  'scripts/',
  'sql/',
  'repo/',
  'mnt/',
  'deployment_forensics_v761/',
  'RELEASES/',
  'docs/',
]);

export const INDEPENDENT_PAGE_PATHS = new Set([
  'admin_shop_analytics.html',
  'admin_shop_connection.html',
  'admin_shop_operations.html',
  'admin_shop_orders.html',
  'shop/index.html',
]);

export function normalizeRepoPath(value){
  return String(value || '').replaceAll('\\','/').replace(/^\.\//,'').replace(/^\/+/, '');
}

export function readRootVersion(root=process.cwd()){
  const value=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
  if(!/^v\d+$/i.test(value)) throw new Error('root VERSION must be v###');
  return value.toLowerCase();
}

export function listTrackedFiles(root=process.cwd()){
  return execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'})
    .split('\0')
    .map(normalizeRepoPath)
    .filter(Boolean);
}

export function isPublishedHtmlPath(file){
  const rel=normalizeRepoPath(file);
  return rel.toLowerCase().endsWith('.html') &&
    !NON_RUNTIME_HTML_PREFIXES.some(prefix => rel.startsWith(prefix));
}

export function listPublishedHtml(root=process.cwd()){
  return listTrackedFiles(root).filter(isPublishedHtmlPath).sort((a,b)=>a.localeCompare(b));
}

export function pageVersionDeclarations(body){
  return [...String(body || '').matchAll(/GEJAST_(?:PAGE|SITE)_VERSION\s*=\s*['"](v\d+)['"]/gi)]
    .map(m=>m[1].toLowerCase());
}

export function expectedPageVersion(rel, rootVersion, body=''){
  const normalized=normalizeRepoPath(rel);
  const root=String(rootVersion || '').trim().toLowerCase();
  if(!INDEPENDENT_PAGE_PATHS.has(normalized)) return root;
  const values=[...new Set(pageVersionDeclarations(body))];
  if(values.length!==1){
    throw new Error(`${normalized}: independent page must declare exactly one GEJAST page/site version; found ${values.join(', ') || 'none'}`);
  }
  return values[0];
}

export function isIndependentPageVersion(rel){
  return INDEPENDENT_PAGE_PATHS.has(normalizeRepoPath(rel));
}
