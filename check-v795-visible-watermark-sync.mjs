#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const version = fs.readFileSync('VERSION','utf8').trim();
const currentVersion=Number((version.match(/\d+/)||['0'])[0]);
assert.ok(currentVersion>=795,'v795 watermark repair contract requires VERSION v795 or newer');

const checker = fs.readFileSync('check-version-drift.mjs','utf8');
const fixer = fs.readFileSync('fix-version-drift.mjs','utf8');
const supportsMiddleDot = body => body.includes('[-–—.·]?') || body.includes('[^\\w\\r\\n<>]{0,12}');
assert(supportsMiddleDot(checker),'version drift checker must recognize the middle-dot watermark separator');
assert(supportsMiddleDot(fixer),'version drift fixer must recognize the middle-dot watermark separator');

const representative = ['home.html','login.html','leaderboard.html','beerpong.html','boerenbridge.html','klaverjas_quick_stats_v596_repo.html','klaverjas_scorer_v596_repo_ready.html','pikken_spectator.html'];
for (const file of representative) {
  const body = fs.readFileSync(file,'utf8');
  assert(body.includes(`${version}  -  Made by Bruis`),`${file} must expose the synchronized current visible watermark`);
}

const activeExt = new Set(['.html','.js','.mjs','.css']);
const ignoredDirs = new Set(['.git','node_modules','dist','build','.next','.vercel','coverage','tmp','temp','patch_bundles','repo','mnt']);
const ignoredFiles = new Set(['check-version-drift.mjs','fix-version-drift.mjs','check-v795-visible-watermark-sync.mjs']);
function walk(dir,out=[]){ for(const entry of fs.readdirSync(dir,{withFileTypes:true})){ if(entry.isDirectory()){ if(!ignoredDirs.has(entry.name)) walk(path.join(dir,entry.name),out); } else out.push(path.join(dir,entry.name)); } return out; }
function isArchivedFile(rel){ const base=path.basename(rel); if(/^gejast-v\d+-repair\.js$/i.test(base)&&!base.toLowerCase().includes(version.toLowerCase())) return true; if(/^README_v\d+/i.test(base)||/^PATCH_NOTES_v\d+/i.test(base)||/^GEJAST_v\d+/i.test(base)) return true; return false; }
const stale=[];
for(const file of walk(process.cwd())){ const rel=path.relative(process.cwd(),file).replaceAll('\\','/'); if(isArchivedFile(rel)||ignoredFiles.has(path.basename(file))||!activeExt.has(path.extname(file).toLowerCase())) continue; const body=fs.readFileSync(file,'utf8'); for(const match of body.matchAll(/v(\d+)\s*·\s*Made by Bruis/gi)) stale.push(`${rel}: ${match[0]}`); }
assert.deepEqual(stale,[],`active middle-dot watermarks must be fully eliminated:\n${stale.join('\n')}`);
console.log('v795 visible watermark synchronization ok.');
