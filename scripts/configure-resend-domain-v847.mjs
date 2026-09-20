import fs from 'node:fs';

const SUPABASE_URL=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
const CF=String(process.env.CLOUDFLARE_API_TOKEN||'');
const DOMAIN='kalenel.nl';
if(!SUPABASE_URL||!SERVICE||!CF) throw new Error('Missing required runtime secret');

async function jfetch(url,init={}){
  const r=await fetch(url,init);
  const raw=await r.text();
  let body=null;try{body=raw?JSON.parse(raw):null}catch{body={raw}};
  return {r,body,raw};
}
async function mint(){
  let lastStatus=0,lastBody=null;
  for(let attempt=1;attempt<=6;attempt++){
    const {r,body}=await jfetch(SUPABASE_URL+'/rest/v1/rpc/shop_ops_mint_scheduler_token_v847',{
      method:'POST',headers:{Authorization:'Bearer '+SERVICE,apikey:SERVICE,'Content-Type':'application/json'},body:'{}'
    });
    lastStatus=r.status;lastBody=body;
    if(r.ok&&typeof body==='string'&&/^[a-f0-9]{64}$/i.test(body))return body;
    if(attempt<6)await new Promise(resolve=>setTimeout(resolve,attempt*2500));
  }
  throw new Error('Could not mint scheduler token after retries: HTTP '+lastStatus+' '+String(lastBody?.message||lastBody?.error||'').slice(0,300));
}
async function resendAction(action){
  const token=await mint();
  const {r,body}=await jfetch(SUPABASE_URL+'/functions/v1/resend-domain-v847',{
    method:'POST',headers:{apikey:SERVICE,'x-shop-ops-token':token,'Content-Type':'application/json'},body:JSON.stringify({action})
  });
  if(!r.ok||body?.ok!==true)throw new Error('Resend helper '+action+' failed: '+String(body?.error||r.status).slice(0,700));
  return body.domain||null;
}
function fqdn(name){
  let n=String(name||'').trim().replace(/\.$/,'');
  if(!n||n==='@')return DOMAIN;
  return n.toLowerCase().endsWith('.'+DOMAIN)||n.toLowerCase()===DOMAIN?n:n+'.'+DOMAIN;
}
async function cf(path,init={}){
  const {r,body}=await jfetch('https://api.cloudflare.com/client/v4'+path,{
    ...init,headers:{Authorization:'Bearer '+CF,'Content-Type':'application/json',...(init.headers||{})}
  });
  if(!r.ok||body?.success!==true)throw new Error('Cloudflare API failed '+r.status+': '+JSON.stringify(body?.errors||[]).slice(0,500));
  return body;
}
async function zoneId(){
  const j=await cf('/zones?name='+encodeURIComponent(DOMAIN)+'&status=active&per_page=50');
  const rows=(j.result||[]).filter(x=>String(x?.name||'').toLowerCase()===DOMAIN);
  if(rows.length!==1||!/^[a-f0-9]{32}$/i.test(String(rows[0]?.id||'')))throw new Error('Could not uniquely resolve active Cloudflare zone');
  return rows[0].id;
}
async function installRecords(domain){
  const records=Array.isArray(domain?.records)?domain.records:[];
  if(!records.length)throw new Error('Resend returned no DNS verification records');
  const zone=await zoneId();
  for(const record of records){
    const type=String(record.type||'').toUpperCase(),name=fqdn(record.name),content=String(record.value||'').trim();
    if(!['TXT','MX','CNAME'].includes(type)||!name||!content)throw new Error('Unsupported Resend DNS record '+type+' '+name);
    const list=await cf('/zones/'+zone+'/dns_records?type='+encodeURIComponent(type)+'&name='+encodeURIComponent(name)+'&per_page=100');
    const existing=Array.isArray(list.result)?list.result:[];
    const exact=existing.find(x=>String(x.content||'').replace(/\.$/,'')===content.replace(/\.$/,'')&&(type!=='MX'||Number(x.priority||0)===Number(record.priority||0)));
    if(exact){console.log('DNS already correct:',type,name);continue;}
    if(type==='CNAME'&&existing.length)throw new Error('CNAME conflict at '+name+'; refusing to overwrite existing DNS');
    const payload={type,name,content,ttl:1,comment:'Resend transactional email'};
    if(type==='MX')payload.priority=Number.isFinite(Number(record.priority))?Number(record.priority):10;
    if(type==='CNAME')payload.proxied=false;
    await cf('/zones/'+zone+'/dns_records',{method:'POST',body:JSON.stringify(payload)});
    console.log('Added DNS:',type,name);
  }
}
async function main(){
  let domain=await resendAction('ensure');
  console.log('Resend domain:',domain?.name,'status:',domain?.status,'records:',domain?.records?.length||0);
  if(domain?.status!=='verified'){
    await installRecords(domain);
    domain=await resendAction('verify');
    console.log('Verification requested; status:',domain?.status);
    for(let i=0;i<18;i++){
      if(domain?.status==='verified')break;
      await new Promise(r=>setTimeout(r,10000));
      domain=await resendAction('status');
      console.log('Resend verification state:',domain?.status||'missing');
    }
  }else{
    console.log('Resend already verifies kalenel.nl; Cloudflare DNS changes are unnecessary.');
  }
  if(domain?.status!=='verified'){
    fs.writeFileSync(process.env.GITHUB_OUTPUT||'/tmp/resend-output','status='+(domain?.status||'missing')+'\n');
    console.log('DNS records are installed; verification is still propagating.');
    process.exitCode=2;
    return;
  }
  const test=await resendAction('test_send');
  if(test===null)throw new Error('Verified-domain test send returned no result');
  fs.writeFileSync(process.env.GITHUB_OUTPUT||'/tmp/resend-output','status=verified\n');
  console.log('Resend domain verified and transactional sender test passed.');
}
await main();