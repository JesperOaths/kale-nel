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

export const INDEPENDENT_PAGE_VERSIONS = new Map([
  ['admin_shop_analytics.html','v843'],
  ['admin_shop_connection.html','v828'],
  ['admin_shop_operations.html','v858'],
  ['admin_shop_orders.html','v874'],
  ['shop/index.html','v874'],
]);

export const INDEPENDENT_PAGE_PATHS = new Set(INDEPENDENT_PAGE_VERSIONS.keys());

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

export function expectedPageVersion(rel, rootVersion){
  const normalized=normalizeRepoPath(rel);
  const root=String(rootVersion || '').trim().toLowerCase();
  return INDEPENDENT_PAGE_VERSIONS.get(normalized) || root;
}

export function isIndependentPageVersion(rel){
  return INDEPENDENT_PAGE_PATHS.has(normalizeRepoPath(rel));
}

export function pageRoutesForHtml(rel){
  const normalized=normalizeRepoPath(rel);
  const routes=[normalized];
  if(normalized==='index.html') routes.push('/');
  else if(normalized.endsWith('/index.html')) routes.push('/'+normalized.slice(0,-'index.html'.length));
  return [...new Set(routes)];
}

export function listPublishedRoutes(root=process.cwd()){
  return listPublishedHtml(root).flatMap(sourcePath =>
    pageRoutesForHtml(sourcePath).map(route => ({sourcePath,route}))
  );
}
