#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const version=fs.readFileSync('VERSION','utf8').trim();
const currentVersion=Number((version.match(/\d+/)||['0'])[0]);
assert.ok(currentVersion>=796,'v796 legacy public-route repair contract requires VERSION v796 or newer');
for(const owner of ['check-version-drift.mjs','fix-version-drift.mjs']){const body=fs.readFileSync(owner,'utf8');assert(!body.includes('/_(?:v\\d+|orig)\\.html$/i'),`${owner} must not classify publicly shipped versioned HTML as archived by filename`);}
const ignoredDirs=new Set(['.git','node_modules','dist','build','.next','.vercel','coverage','tmp','temp','patch_bundles','repo','mnt','cloudflare']);
function walk(dir,out=[]){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.isDirectory()){if(!ignoredDirs.has(entry.name))walk(path.join(dir,entry.name),out);}else out.push(path.join(dir,entry.name));}return out;}
const versioned=walk(process.cwd()).map(file=>path.relative(process.cwd(),file).replaceAll('\\','/')).filter(rel=>/_(?:v\d+)\.html$/i.test(path.basename(rel)));
assert.deepEqual(versioned,['klaverjas_live_v596.html'],'the sole published exact-version HTML compatibility route must remain explicit');
const alias=fs.readFileSync('klaverjas_live_v596.html','utf8');
assert(alias.length<1800,'legacy Klaverjas live compatibility route must remain redirect-only and small');
assert(alias.includes("new URL('./klaverjas_live.html'"),'legacy route must hand off to canonical Klaverjas live');
assert(alias.includes("source.get('match_id')")&&alias.includes("url.searchParams.set('client_match_id',legacy)"),'legacy match_id must translate to client_match_id');
assert(alias.includes('location.replace(url.toString())'),'legacy route must replace itself with canonical route');
for(const forbidden of ['supabase','<form','<button','fetch(','get_public_state'])assert(!alias.toLowerCase().includes(forbidden.toLowerCase()),`legacy alias retained obsolete owner: ${forbidden}`);
assert(alias.includes(`${version}  -  Made by Bruis`),'legacy alias must expose current watermark fallback');
console.log('v796 published versioned HTML compatibility boundary ok for',version);
