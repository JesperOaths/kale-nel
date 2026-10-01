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

// Visible page versions are site-wide. Internal component/build revisions may differ,
// but no published page owns an independent visible v#.
export const INDEPENDENT_PAGE_VERSIONS = new Map();
export const INDEPENDENT_PAGE_PATHS = new Set();
export const ADMIN_WORKER_SOURCE_PATH = 'cloudflare/workers/admin-gate/src/worker.js';

export function readAdminWorkerVersion(root=process.cwd()){
  const source=fs.readFileSync(path.join(root,ADMIN_WORKER_SOURCE_PATH),'utf8');
  const build=(source.match(/const\s+ADMIN_BUILD\s*=\s*['"]([^'"]+)['"]/)||[])[1]||'';
  const pageVersion=(source.match(/const\s+ADMIN_PAGE_VERSION\s*=\s*['"](v\\d+)['"]/i)||[])[1]?.toLowerCase()||'';
  const watermarkOwners=(source.match(/\$\{ADMIN_PAGE_VERSION\}\s*-\s*Made by Bruis/g)||[]).length;
  return {build,pageVersion,watermarkOwners,source};
}

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
  void rel;
  return String(rootVersion || '').trim().toLowerCase();
}

export function isIndependentPageVersion(rel){
  void rel;
  return false;
}

export function pageRoutesForHtml(rel){
  const normalized=normalizeRepoPath(rel);
  const routes=[normalized];
  if(normalized==='index.html') {
    routes.push('/');
  } else if(normalized.endsWith('/index.html')) {
    const directory='/'+normalized.slice(0,-'index.html'.length);
    routes.push(directory);
    routes.push(directory.replace(/\/$/,''));
  }
  return [...new Set(routes)];
}

export function listPublishedRoutes(root=process.cwd()){
  return listPublishedHtml(root).flatMap(sourcePath =>
    pageRoutesForHtml(sourcePath).map(route => ({sourcePath,route}))
  );
}
