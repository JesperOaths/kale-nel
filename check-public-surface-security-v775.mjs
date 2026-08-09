#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const failures=[];
const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number((version.match(/v(\d+)/i)||[])[1]||0);
if(n<775) failures.push('public-surface security v775 guard requires VERSION >= v775, got '+version);
for(const removed of ['geo_diagnostics.html','push_beta_test.html']) if(fs.existsSync(removed)) failures.push('removed public operational residue returned: '+removed);

const targeted=fs.readFileSync('admin_push_targeted_test.html','utf8');
if(targeted.includes('push_beta_test.html')) failures.push('admin targeted push tool still references removed public beta-test console');
if(!targeted.includes("const TARGET_URL = './drinks_pending.html?push_test=targeted';")) failures.push('admin targeted push tool must use normal Drinks verification destination');
if(!/admin-session-sync\.js\?v\d+/.test(targeted)) failures.push('admin targeted push tool must load the inner admin-session helper');
if(!targeted.includes('window.GEJAST_ADMIN_SESSION.requirePage')) failures.push('admin targeted push tool must require the inner admin page session');
if(!targeted.includes('window.GEJAST_ADMIN_SESSION.validate')) failures.push('admin targeted push tool must validate the inner admin session before queueing');
if(!targeted.includes("const RPC_NAME = 'admin_queue_targeted_web_push_test_v763';")) failures.push('admin targeted push tool must retain the bounded targeted queue RPC');
if(!targeted.includes('dry_run: !!dryRun')) failures.push('admin targeted push tool must retain validate-only dry-run semantics');
if(!targeted.includes('confirmInput.value.trim() !== String(TARGET_SUBSCRIPTION_ID)')) failures.push('admin targeted push tool must retain typed target confirmation');

const targetedCheck=fs.readFileSync('check-admin-push-targeted-test-page.mjs','utf8');
if(!targetedCheck.includes("notIncludes('push_beta_test.html'")) failures.push('targeted push regression must forbid removed beta-test console');
const redirect=fs.readFileSync('despimarkt_force.html','utf8');
if(!redirect.includes("target.searchParams.set('focus', 'nomination')")) failures.push('Despimarkt compatibility redirect must remain a non-mutating nomination redirect');
if(/\.rpc\s*\(|rest\/v1\/rpc\//i.test(redirect)) failures.push('Despimarkt compatibility redirect must not acquire a backend RPC owner');

const listed=spawnSync('git',['ls-files','-z'],{encoding:'utf8'});
if(listed.status!==0) failures.push('git ls-files failed during current secret exposure scan');
else {
  const tracked=listed.stdout.split('\0').filter(Boolean);
  for(const removed of ['geo_diagnostics.html','push_beta_test.html']) if(tracked.includes(removed)) failures.push('removed public operational residue is still tracked: '+removed);
  const files=tracked.filter((file)=>file!=='check-public-surface-security-v775.mjs' && /\.(?:html|js|mjs|json|yml|yaml|toml|txt|md|sql|ps1|sh)$/i.test(file));
  const patterns=[
    ['private_key_block',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['github_pat',/\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
    ['github_classic_pat',/\bghp_[A-Za-z0-9]{30,}\b/],
    ['aws_access_key',/\bAKIA[0-9A-Z]{16}\b/],
    ['literal_service_role',/(?:SUPABASE_SERVICE_ROLE_KEY|service_role_key)\s*[:=]\s*['"][^'"\s]{20,}['"]/i],
    ['literal_private_secret',/(?:GITHUB_CLIENT_SECRET|COOKIE_SECRET|VAPID_PRIVATE_KEY|PRIVATE_KEY)\s*[:=]\s*['"][^'"\s]{16,}['"]/i]
  ];
  function serviceRoleJwt(text){for(const token of String(text).match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]){try{const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));if(String(payload?.role||'').toLowerCase()==='service_role')return true;}catch(_){}}return false;}
  for(const file of files){let text='';try{text=fs.readFileSync(file,'utf8');}catch(_){continue;}for(const [kind,re] of patterns)if(re.test(text))failures.push('high-confidence current-tree secret finding: '+kind+' in '+file);if(serviceRoleJwt(text))failures.push('high-confidence current-tree service-role JWT in '+file);}
}
if(failures.length){console.error('Public-surface security v775 FAILED');failures.forEach(f=>console.error('- '+f));process.exit(1);}
console.log(`Public-surface security v775 PASS at ${version}: public diagnostic/test consoles are absent, targeted push remains admin-session bounded with a normal verification destination, compatibility redirect stays non-mutating, and current tree has no high-confidence private secrets.`);