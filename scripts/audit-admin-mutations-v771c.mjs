#!/usr/bin/env node
import fs from 'node:fs';

const rootFiles=fs.readdirSync('.').filter((name)=>fs.statSync(name).isFile());
const candidates=rootFiles.filter((name)=>
  /^admin.*\.(?:html|js)$/i.test(name)
  || ['match_control.html','match_swap.html','drinks_admin.html','vault.html','boerenbridge_vault.html','beerpong_vault.html'].includes(name)
  || /^gejast-admin-.*\.js$/i.test(name)
).sort();

const writeWord=/\b(save|update|delete|remove|approve|reject|create|set|adjust|rebuild|swap|claim|reserve|activate|moderate|resolve|refund|settle|upload|release|archive|cancel)[a-z0-9_]*\b/ig;
const rpcName=/\/rest\/v1\/rpc\/([a-zA-Z0-9_]+)/g;
let guardedPages=0;
let mutationFiles=0;
let suspicious=[];
let allDirectRpcs=new Set();

for(const file of candidates){
  const text=fs.readFileSync(file,'utf8');
  const secureWriteCount=(text.match(/GEJAST_ADMIN_RPC\.secureWrite|\.secureWrite\s*\(/g)||[]).length;
  const secureReadCount=(text.match(/GEJAST_ADMIN_RPC\.secureRead|\.secureRead\s*\(/g)||[]).length;
  const direct=[...text.matchAll(rpcName)].map((m)=>m[1]);
  direct.forEach((name)=>allDirectRpcs.add(name));
  const words=[...new Set((text.match(writeWord)||[]).map((x)=>x.toLowerCase()))];
  const hasMutationSignal=secureWriteCount>0 || direct.some((name)=>/(save|update|delete|approve|reject|create|set|adjust|rebuild|swap|claim|reserve|activate|moderate|resolve|refund|settle|upload|release|archive|cancel)/i.test(name)) || /method\s*:\s*['"](?:POST|PATCH|DELETE)['"]/i.test(text);
  const authMarkers={
    commonRpc:/GEJAST_ADMIN_RPC/.test(text),
    sessionSync:/admin-session-sync\.js/.test(text),
    sessionApi:/GEJAST_ADMIN_SESSION/.test(text),
    token:/admin_session_token/.test(text),
    check:/admin_check_session/.test(text),
    requirePage:/requirePage\s*\(/.test(text),
  };
  const guarded=Object.values(authMarkers).some(Boolean);
  if(guarded) guardedPages+=1;
  if(hasMutationSignal) mutationFiles+=1;
  if(hasMutationSignal && !guarded) suspicious.push(file);
  console.log(JSON.stringify({file,hasMutationSignal,secureWriteCount,secureReadCount,directRpcs:direct,writeWords:words.slice(0,20),authMarkers}));
}

console.log(`ADMIN_AUDIT_SUMMARY candidates=${candidates.length} guarded=${guardedPages} mutationFiles=${mutationFiles} suspicious=${suspicious.length}`);
console.log(`ADMIN_DIRECT_RPCS ${[...allDirectRpcs].sort().join(',')||'(none)'}`);
console.log(`ADMIN_SUSPICIOUS ${suspicious.join(',')||'(none)'}`);
