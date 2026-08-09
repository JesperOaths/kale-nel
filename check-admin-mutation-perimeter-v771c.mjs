#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const failures=[];
const operatorFiles=fs.readdirSync('.').filter((name)=>{
  if(!fs.statSync(name).isFile()) return false;
  if(/^admin_v\d+_orig\.html$/i.test(name)) return false;
  if(/^ADMIN_.*\.html$/i.test(name)) return false;
  return /^admin.*\.(?:html|js)$/i.test(name)
    || /^gejast-admin-.*\.js$/i.test(name)
    || ['match_control.html','match_swap.html','drinks_admin.html','vault.html','boerenbridge_vault.html','beerpong_vault.html'].includes(name);
}).sort();

const mutationRpcName=/(save|update|delete|remove|approve|reject|create|set|adjust|rebuild|swap|claim|reserve|activate|moderate|resolve|refund|settle|upload|release|archive|cancel|requeue|resend|revoke)/i;
const directRpc=/\/rest\/v1\/rpc\/([a-zA-Z0-9_]+)/g;
const strongAuth=[/GEJAST_ADMIN_RPC/,/admin-session-sync\.js/,/GEJAST_ADMIN_SESSION/,/admin_session_token/,/admin_check_session/,/requirePage\s*\(/];
let mutationFiles=0;
let guardedMutationFiles=0;

for(const file of operatorFiles){
  const text=fs.readFileSync(file,'utf8');
  const direct=[...text.matchAll(directRpc)].map((match)=>match[1]);
  const hasSecureWrite=/GEJAST_ADMIN_RPC\.secureWrite|\.secureWrite\s*\(/.test(text);
  const hasDirectMutationRpc=direct.some((name)=>mutationRpcName.test(name));
  const hasMutationFetch=/(?:method\s*:\s*['"](?:POST|PATCH|DELETE)['"])/i.test(text)
    && /\/rest\/v1\/(?:rpc\/|[a-z0-9_]+)/i.test(text);
  const hasMutationPath=hasSecureWrite||hasDirectMutationRpc||hasMutationFetch;
  if(!hasMutationPath) continue;
  mutationFiles+=1;
  const guarded=strongAuth.some((pattern)=>pattern.test(text));
  if(guarded) guardedMutationFiles+=1;
  else failures.push(`${file} has an active mutation path but no admin session/auth boundary marker`);
}

const adminRpc=fs.readFileSync('gejast-admin-rpc.js','utf8');
for(const marker of [
  "return await rpc('admin_secure_write_v356'",
  'admin_session_token: getSessionToken()',
  'site_scope_input: payload?.site_scope_input || getScope()',
  "return await rpc('admin_secure_read_v356'",
  "return await rpc('admin_check_session'",
  'async function requirePage(pageName)',
]) if(!adminRpc.includes(marker)) failures.push(`shared admin RPC layer missing ${marker}`);

const keyPages={
  'admin_claims.html':['admin_check_session','GEJAST_ADMIN_RPC','admin_session_token'],
  'admin_reserved_names.html':['admin_check_session','GEJAST_ADMIN_RPC','admin_session_token'],
  'admin_expired.html':['admin_check_session','GEJAST_ADMIN_RPC','admin_session_token'],
  'admin_push.html':['admin_check_session','GEJAST_ADMIN_RPC','admin_session_token'],
  'match_control.html':['GEJAST_ADMIN_SESSION','admin_session_token'],
  'drinks_admin.html':['admin-session-sync.js','admin_session_token'],
};
for(const [file,markers] of Object.entries(keyPages)){
  const text=fs.readFileSync(file,'utf8');
  for(const marker of markers) if(!text.includes(marker)) failures.push(`${file} missing required admin boundary marker ${marker}`);
}

const adminHub=fs.readFileSync('admin.html','utf8');
if(!adminHub.includes('admin-session-sync.js')) failures.push('admin.html must load admin-session-sync.js');
if(!adminHub.includes('admin_check_session')) failures.push('admin.html must validate the inner admin session');

if(failures.length){
  console.error('Admin mutation perimeter v771c FAILED');
  failures.forEach((failure)=>console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Admin mutation perimeter v771c PASS: mutationFiles=${mutationFiles}, guarded=${guardedMutationFiles}; shared secureWrite injects session and scope.`);
