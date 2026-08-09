#!/usr/bin/env node
import fs from 'node:fs';

const failures=[];
const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number((version.match(/v(\d+)/i)||[])[1]||0);
if(n<774) failures.push('production-acceptance v774 guard requires VERSION >= v774, got '+version);
const beer=fs.readFileSync('beerpong.html','utf8');
if(beer.includes("sb.rpc('get_beerpong_pussycup_ranking_public').catch(")) failures.push('Beerpong still calls .catch directly on the Supabase RPC builder');
if(!beer.includes("Promise.resolve(sb.rpc('get_beerpong_pussycup_ranking_public')).catch(")) failures.push('Beerpong optional Pussycup RPC must be assimilated through Promise.resolve');
const analytics=fs.readFileSync('site-analytics.js','utf8');
if(!analytics.includes('const endpoint = `${SUPABASE_URL}/rest/v1/rpc/track_site_event`;')) failures.push('analytics must define the track_site_event endpoint once');
if(!analytics.includes('sameOrigin && navigator.sendBeacon')) failures.push('analytics sendBeacon must be restricted to same-origin endpoints');
if(!analytics.includes('return fetch(endpoint, {')) failures.push('analytics must retain keepalive fetch for cross-origin Supabase delivery');
const login=fs.readFileSync('login.html','utf8');
for(const marker of ['v689 actieve-login bron','selector-fallback','nieuwere RPC nog niet is uitgerold']) if(login.includes(marker)) failures.push('login still exposes implementation copy: '+marker);
if(!login.includes('<p>Kies je naam en voer je 4-cijferige pincode in.</p>')) failures.push('login must retain concise user-facing instruction');
for(const temp of ['scripts/audit-live-browser-v774.mjs','scripts/audit-live-browser-v774-focus.mjs','.github/workflows/v774-production-browser-audit.yml','scripts/apply-v774-production-acceptance.mjs','.github/workflows/v774-apply-production-acceptance.yml']) if(fs.existsSync(temp)) failures.push('temporary v774 audit/builder residue remains: '+temp);
if(failures.length){ console.error('Production acceptance v774 FAILED'); failures.forEach(f=>console.error('- '+f)); process.exit(1); }
console.log('Production acceptance v774 PASS: Beerpong runtime, analytics transport, and login copy are production-clean.');
