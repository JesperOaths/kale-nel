#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const base=process.env.GEJAST_LIVE_BASE_URL||'https://kalenel.nl';
const adminBase=process.env.GEJAST_ADMIN_BASE_URL||'https://admin.kalenel.nl';
const timeoutMs=Number(process.env.GEJAST_SMOKE_TIMEOUT_MS||12000);
const root=process.cwd();
const suspiciousName=/(?:admin|vault|diagnostic|health|test|control|debug|audit|runtime|phase|implementation|security|observability|push_beta|match_swap|force|repair)/i;
const mutationWord=/(?:\.rpc\s*\(|rest\/v1\/rpc\/)(?:[^\n]{0,160})(?:create|update|delete|save|write|rebuild|reset|force|approve|reject|grant|revoke|queue|send|action|mutation)/i;
const authWord=/(?:admin-session-sync|GEJAST_ADMIN_SESSION|requireAdmin|admin_session_token|requirePlayerSessionOrRedirect|getPlayerSessionToken|jas_session_token|playerSession)/i;

function walk(dir){
  const out=[];
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(['.git','node_modules'].includes(ent.name))continue;
    const p=path.join(dir,ent.name);
    if(ent.isDirectory())out.push(...walk(p)); else out.push(p);
  }
  return out;
}
const all=walk(root);
const rel=(p)=>path.relative(root,p).replaceAll('\\','/');
const runtimeSources=all.filter(p=>/\.(?:html|js|css)$/i.test(p)&&!/(?:^|\/)(?:archive|ci|scripts)\//i.test(rel(p))&&!/^check-/i.test(path.basename(p)));
const rootHtml=fs.readdirSync(root).filter(f=>f.endsWith('.html')).sort();

function refsTo(name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp(`(?:\\./|/)?${escaped}(?:[?#'\"\\s]|$)`,'i');
  const refs=[];
  for(const p of runtimeSources){
    if(path.basename(p)===name&&path.dirname(p)===root)continue;
    const text=fs.readFileSync(p,'utf8');
    if(re.test(text))refs.push(rel(p));
  }
  return refs;
}
async function request(url,redirect='manual'){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);
  try{return await fetch(url,{cache:'no-store',redirect,signal:c.signal});}finally{clearTimeout(t);}
}
async function liveChain(name){
  let url=new URL('/'+name,base).toString();const chain=[];
  for(let i=0;i<5;i++){
    try{
      const r=await request(url,'manual');chain.push({status:r.status,url});
      if(r.status>=300&&r.status<400&&r.headers.get('location')){url=new URL(r.headers.get('location'),url).toString();continue;}
      return{chain,terminal:r.status,terminalUrl:url};
    }catch(e){return{chain,terminal:0,terminalUrl:url,error:String(e?.message||e)};}
  }
  return{chain,terminal:0,terminalUrl:url,error:'redirect limit'};
}

const rows=[];
for(const name of rootHtml.filter(f=>suspiciousName.test(f))){
  const text=fs.readFileSync(name,'utf8');
  const refs=refsTo(name);
  const live=await liveChain(name);
  rows.push({
    name,refs:refs.slice(0,20),refCount:refs.length,terminal:live.terminal,chain:live.chain,
    adminRouted:live.chain.some(x=>x.url.startsWith(adminBase)),
    mutationLike:mutationWord.test(text),authLike:authWord.test(text),
    noindex:/noindex/i.test(text),title:(text.match(/<title>([^<]*)<\/title>/i)||[])[1]||''
  });
}

const highRisk=rows.filter(r=>r.terminal===200&&r.mutationLike&&!r.authLike);
const publicOperator=rows.filter(r=>r.terminal===200&&!r.adminRouted&&r.refCount===0);
console.log(`SUSPICIOUS_ROOT_SURFACES=${rows.length}`);
console.log(`HIGH_RISK_PUBLIC_MUTATION_WITHOUT_AUTH_MARKER=${highRisk.length}`);
console.log(`UNREFERENCED_PUBLIC_OPERATOR_SURFACES=${publicOperator.length}`);
for(const r of rows)console.log('SURFACE '+JSON.stringify(r));

// High-confidence secret patterns only. Public Supabase publishable/anon keys are intentionally not treated as secrets.
const secretFindings=[];
const textFiles=all.filter(p=>/\.(?:html|js|mjs|json|yml|yaml|toml|txt|md|sql|ps1|sh)$/i.test(p));
const secretPatterns=[
  ['private_key_block',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github_pat',/\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['github_classic_pat',/\bghp_[A-Za-z0-9]{30,}\b/],
  ['aws_access_key',/\bAKIA[0-9A-Z]{16}\b/],
  ['literal_service_role',/(?:SUPABASE_SERVICE_ROLE_KEY|service_role_key)\s*[:=]\s*['\"][^'\"\s]{20,}['\"]/i],
  ['literal_private_secret',/(?:GITHUB_CLIENT_SECRET|COOKIE_SECRET|VAPID_PRIVATE_KEY|PRIVATE_KEY)\s*[:=]\s*['\"][^'\"\s]{16,}['\"]/i]
];
for(const p of textFiles){
  const text=fs.readFileSync(p,'utf8');
  for(const [kind,re] of secretPatterns){if(re.test(text))secretFindings.push({file:rel(p),kind});}
}
console.log(`HIGH_CONFIDENCE_SECRET_FINDINGS=${secretFindings.length}`);
for(const f of secretFindings)console.log('SECRET '+JSON.stringify(f));

async function headerProbe(url,label){
  try{
    const r=await request(url,'manual');
    const wanted=['strict-transport-security','content-security-policy','x-content-type-options','referrer-policy','permissions-policy','x-frame-options','cross-origin-opener-policy','cross-origin-resource-policy'];
    const headers=Object.fromEntries(wanted.map(k=>[k,r.headers.get(k)]));
    console.log('HEADERS '+JSON.stringify({label,url,status:r.status,headers}));
  }catch(e){console.log('HEADERS '+JSON.stringify({label,url,status:0,error:String(e?.message||e)}));}
}
await headerProbe(base+'/','public_root');
await headerProbe(base+'/login.html','public_login');
await headerProbe(base+'/admin.html','public_admin_redirect');
await headerProbe(adminBase+'/admin.html','admin_unauthenticated');

console.log('AUDIT_SUMMARY '+JSON.stringify({suspiciousSurfaces:rows.length,highRiskPublicMutationWithoutAuth:highRisk.map(r=>r.name),unreferencedPublicOperator:publicOperator.map(r=>r.name),secretFindings}));
