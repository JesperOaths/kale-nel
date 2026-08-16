#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const version=fs.readFileSync('VERSION','utf8').trim();
const current=Number((version.match(/\d+/)||['0'])[0]);
assert.ok(current>=797,'v797 watermark separator contract requires VERSION v797 or newer');
for(const owner of ['check-version-drift.mjs','fix-version-drift.mjs']){const body=fs.readFileSync(owner,'utf8');assert(body.includes('[^\\w\\r\\n<>]{0,12}'),`${owner} must recognize arbitrary short punctuation/encoding-damaged watermark separators`);}
const activeExt=new Set(['.html','.js','.mjs','.css']);
const ignoredDirs=new Set(['.git','node_modules','dist','build','.next','.vercel','coverage','tmp','temp','patch_bundles','repo','mnt']);
const ignoredFiles=new Set(['check-version-drift.mjs','fix-version-drift.mjs','check-v797-watermark-separator-hardening.mjs']);
function walk(dir,out=[]){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.isDirectory()){if(!ignoredDirs.has(entry.name))walk(path.join(dir,entry.name),out);}else out.push(path.join(dir,entry.name));}return out;}
function archived(rel){const base=path.basename(rel);return (/^gejast-v\d+-repair\.js$/i.test(base)&&!base.toLowerCase().includes(version.toLowerCase()))||/^README_v\d+/i.test(base)||/^PATCH_NOTES_v\d+/i.test(base)||/^GEJAST_v\d+/i.test(base);}
const stale=[]; const damaged=[];
for(const file of walk(process.cwd())){const rel=path.relative(process.cwd(),file).replaceAll('\\','/');if(archived(rel)||ignoredFiles.has(path.basename(file))||!activeExt.has(path.extname(file).toLowerCase()))continue;const text=fs.readFileSync(file,'utf8');for(const m of text.matchAll(/v(\d+)\s*([^\w\r\n<>]{0,12})\s*Made by Bruis/gi)){if(`v${m[1]}`!==version && !(m[1]==='762' && ['admin.html','cloudflare/workers/admin-gate/static/admin.html','scripts/test-admin-static-assets-html-handling.mjs','scripts/test-admin-worker-gate.mjs'].includes(rel)))stale.push(`${rel}: ${m[0]}`);if(/[?�]/.test(m[2]))damaged.push(`${rel}: ${m[0]}`);}}
assert.deepEqual(stale,[],`stale active visible watermarks remain:\n${stale.join('\n')}`);
assert.deepEqual(damaged,[],`encoding-damaged watermark separators remain:\n${damaged.join('\n')}`);
for(const file of ['despimarkt.html','paardenrace.html','paardenrace_live.html','scorer.html','toepen.html','drinks_speed.html']){const body=fs.readFileSync(file,'utf8');assert(body.includes(`${version}  -  Made by Bruis`),`${file} must carry normalized current fallback watermark`);}
console.log('v797 watermark separator hardening ok for',version);
