import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { __test } from '../cloudflare/workers/admin-gate/src/worker.js';

const NOW=()=>Math.floor(Date.now()/1000);
const OUTER='__Secure-kalenel_security_session';
const MEDIA='__Host-kalenel_security_media';
const CAMERA_ORIGIN='https://unit-camera.trycloudflare.com';
const CAMERA_TOKEN=`${'a'.repeat(32)}.${'b'.repeat(64)}`;
const MEDIA_TOKEN=`relay-${'c'.repeat(48)}`;
const ADMIN_TOKEN=`admin-${'a'.repeat(40)}`;
const SESSION_URL='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-media?action=session';
const RELAY_URL='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-relay';

const html=fs.readFileSync(new URL('../security/index.html',import.meta.url),'utf8');
assert.match(html,/setTimeout\(\(\)=>stopLive\(camera\),120000\)/,'remote live must remain bounded to two minutes');
assert.match(html,/state\.autoStarted\[camera\]=true;startLive\(camera,true\)/,'online cameras must auto-start once after unlock');
assert.match(html,/Promise\.all\(\[api\('new','\/api\/status'\),api\('s3','\/api\/status'\)\]\)/,'live view must evaluate both camera sources independently');
assert.match(html,/source_online===true/,'UI must trust explicit source-online state rather than proxy reachability alone');
assert.doesNotMatch(html,/trycloudflare\.com|camera_token|media_token|\b192\.168\.|\b10\.\d+\.\d+\.\d+/i,'browser source must not contain private camera or relay credentials');

function env(){return {COOKIE_SECRET:`unit-${'x'.repeat(48)}`,APPROVED_GITHUB_ID:'12345',APPROVED_GITHUB_LOGIN:'bruis-approved',ASSETS:{async fetch(r){return new URL(r.url).pathname==='/security/index.html'?new Response(html,{headers:{'Content-Type':'text/html'}}):new Response('missing',{status:404});}}};}
async function req(url,options={},e=env()){return worker.fetch(new Request(url,options),e,{});}
function pair(setCookie,name){const m=String(setCookie||'').match(new RegExp(`(?:^|,\\s*)(${name}=[^;,]+)`));return m?m[1]:'';}
function cookies(...xs){return xs.filter(Boolean).join('; ');}
async function outer(e=env()){return pair(await __test.signedCookie(e,OUTER,{kind:'security-session',github:{id:'12345',login:'bruis-approved'},iat:NOW(),exp:NOW()+300,nonce:'v779-unit'},300),OUTER);}

const e=env();
const outerCookie=await outer(e);
const directCalls=[];
const relayCalls=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  const url=String(input);
  if(url==='https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/admin_login'){
    return Response.json({admin_session_token:ADMIN_TOKEN});
  }
  if(url===SESSION_URL){
    return Response.json({ok:true,camera_origin:CAMERA_ORIGIN,camera_token:CAMERA_TOKEN,media_token:MEDIA_TOKEN,expires_at:new Date(Date.now()+300000).toISOString(),camera_token_expires_at:new Date(Date.now()+240000).toISOString()});
  }
  if(url.startsWith(CAMERA_ORIGIN+'/')){
    const u=new URL(url);
    directCalls.push({pathname:u.pathname,token:u.searchParams.get('token'),headers:new Headers(init.headers||{})});
    return Response.json({ok:true,source_online:true,camera:u.pathname.split('/')[1]},{headers:{'Content-Type':'application/json','X-Private-Upstream':'strip-me'}});
  }
  if(url.startsWith(RELAY_URL)){
    const u=new URL(url);
    const headers=new Headers(init.headers||{});
    relayCalls.push({camera:u.searchParams.get('camera'),kind:u.searchParams.get('kind'),name:u.searchParams.get('name'),headers,method:init.method||'GET'});
    return new Response('mjpeg-unit-stream',{status:200,headers:{'Content-Type':'multipart/x-mixed-replace; boundary=frame','X-Private-Upstream':'strip-me'}});
  }
  throw new Error(`unexpected fetch ${url}`);
};

try{
  const login=await req('https://kalenel.nl/security/auth/login',{method:'POST',headers:{Cookie:outerCookie,'Content-Type':'application/json'},body:JSON.stringify({username:'Bruis',password:'unit-password',totp:'123456'})},e);
  assert.equal(login.status,200);
  const mediaCookie=pair(login.headers.get('Set-Cookie')||'',MEDIA);
  assert.ok(mediaCookie,'inner login must create encrypted media session');
  const auth=cookies(outerCookie,mediaCookie);

  const status=await req('https://kalenel.nl/security/new/api/status',{headers:{Cookie:auth}},e);
  assert.equal(status.status,200);
  assert.equal(status.headers.get('X-Kalenel-Security-Media-Path'),'direct');
  assert.equal(status.headers.get('X-Private-Upstream'),null,'private upstream headers must be stripped');
  assert.equal(directCalls.length,1,'short status request should prefer the direct camera tunnel');
  assert.equal(directCalls[0].pathname,'/new/api/status');
  assert.equal(directCalls[0].token,CAMERA_TOKEN);

  const live=await req('https://kalenel.nl/security/new/live.mjpg',{headers:{Cookie:auth}},e);
  assert.equal(live.status,200);
  assert.equal(live.headers.get('X-Kalenel-Security-Media-Path'),'supabase-live');
  assert.match(live.headers.get('Content-Type')||'',/^multipart\/x-mixed-replace/i);
  assert.equal(live.headers.get('X-Private-Upstream'),null,'relay response must not expose private headers');
  assert.equal(await live.text(),'mjpeg-unit-stream');
  assert.equal(relayCalls.length,1,'MJPEG must use exactly one authenticated relay request');
  assert.deepEqual({camera:relayCalls[0].camera,kind:relayCalls[0].kind,name:relayCalls[0].name},{camera:'new',kind:'live',name:null});
  assert.equal(relayCalls[0].headers.get('X-Kalenel-Media-Token'),MEDIA_TOKEN,'relay auth token must be server-side only');
  assert.equal(relayCalls[0].headers.get('Authorization'),null);
  assert.equal(directCalls.some(x=>x.pathname.endsWith('/live.mjpg')),false,'long-lived live video must never take the fragile Worker-to-Quick-Tunnel path');
}finally{
  globalThis.fetch=originalFetch;
}

console.log('RESULT=V779_SECURITY_LIVE_RELAY_AUTOSTART_PASS');
