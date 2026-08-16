#!/usr/bin/env node
import fs from 'node:fs';
const root=fs.readFileSync('VERSION','utf8').trim();
const rootN=Number(root.match(/^v(\d+)$/)?.[1]||0);
const failures=[];
if(rootN<787) failures.push('v787 Family alias guard requires VERSION >= v787');
const aliases=[
  ['familie/index.html','../index.html?scope=family'],
  ['familie/login.html','../login.html?scope=family'],
  ['familie/scorer.html','../scorer.html?scope=family'],
  ['familie/leaderboard.html','../leaderboard.html?scope=family']
];
for(const [path,target] of aliases){
  const text=fs.readFileSync(path,'utf8');
  const bytes=Buffer.byteLength(text,'utf8');
  if(bytes>1800) failures.push(path+' redirect wrapper must stay lightweight (<=1800 bytes)');
  if(/<script\s+[^>]*src=/i.test(text)) failures.push(path+' must not load external scripts');
  if(/<link\s+[^>]*href=/i.test(text)) failures.push(path+' must not load external styles/resources');
  if(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|navigator\.serviceWorker/i.test(text)) failures.push(path+' must not start network/runtime work before redirect');
  if((text.match(/<script(?:\s[^>]*)?>/gi)||[]).length!==1) failures.push(path+' must contain exactly one inline redirect script');
  if(!text.includes("location.replace('"+target+"')")) failures.push(path+' must preserve JS redirect to '+target);
  if(!text.includes('http-equiv="refresh" content="0; url='+target+'"')) failures.push(path+' must preserve non-JS redirect fallback to '+target);
  if(!text.includes('href="'+target+'"')) failures.push(path+' must preserve visible fallback link to '+target);
  if(/gejast-config\.js|gejast-scope-hardening\.js|gejast-v725-repair\.js|gejast-site-announcements\.js/i.test(text)) failures.push(path+' must not bootstrap normal runtime before redirect');
}

const playerPath='familie/player.html';
const player=fs.readFileSync(playerPath,'utf8');
if(Buffer.byteLength(player,'utf8')>1800) failures.push(playerPath+' redirect wrapper must stay lightweight (<=1800 bytes)');
if(/<script\s+[^>]*src=/i.test(player)) failures.push(playerPath+' must not load external scripts before redirect');
if(/<link\s+[^>]*href=/i.test(player)) failures.push(playerPath+' must not load external styles/resources before redirect');
if(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|navigator\.serviceWorker/i.test(player)) failures.push(playerPath+' must not start network/runtime work before redirect');
if((player.match(/<script(?:\s[^>]*)?>/gi)||[]).length!==1) failures.push(playerPath+' must contain exactly one inline redirect script');
if(!player.includes('new URLSearchParams(location.search)')) failures.push(playerPath+' must preserve incoming player/game query parameters');
if(!player.includes("q.set('scope','family')")) failures.push(playerPath+' must force family scope');
if(!player.includes("location.replace('../player.html?'+q.toString())")) failures.push(playerPath+' must redirect the preserved query to the canonical player page');
if(/gejast-auth-gate\.js|gejast-config\.js|gejast-scope-hardening\.js|gejast-v725-repair\.js|gejast-site-announcements\.js/i.test(player)) failures.push(playerPath+' must not bootstrap normal runtime before redirect');
if(!player.includes('http-equiv="refresh" content="0; url=../profiles.html?scope=family"')) failures.push(playerPath+' must retain a safe no-JS family-profile fallback');
if(!player.includes('href="../profiles.html?scope=family"')) failures.push(playerPath+' must retain a visible family-profile fallback');

for(const path of ['scripts/build-v787-family-alias-cleanup.mjs','.github/workflows/v787-family-alias-cleanup.yml']) if(fs.existsSync(path)) failures.push('temporary v787 builder residue remains: '+path);
if(failures.length){console.error('v787 Family redirect alias regression failed:');for(const f of failures) console.error('- '+f);process.exit(1);}
console.log('v787 Family redirect aliases PASS: static wrappers remain lightweight and external-runtime-free; familie/player.html preserves its requested player/game query while forcing family scope.');
