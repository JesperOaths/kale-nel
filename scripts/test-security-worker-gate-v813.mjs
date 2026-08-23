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

function env(){return {COOKIE_SECRET:`unit-${'x'.repeat(48)}`,APPROVED_GITHUB_ID:'12345',APPROVED_GITHUB_LOGIN:'bruis-approved',ASSETS:{async fetch(r){return new URL(r.url).pathname==='/security/index.html'?new Response('<!doctype html><title>Security</title>',{headers:{'Content-Type':'text/html'}}):new Response('missing',{status:404});}}};}
async function req(url,options={},e=env()){return worker.fetch(new Request(url,options),e,{});}
function pair(setCookie,name){const m=String(setCookie||'').match(new RegExp(`(?:^|,\\s*)(${name}=[^;,]+)`));return m?m[1]:'';}
function cookies(...xs){return xs.filter(Boolean).join('; ');}
async function outer(e=env(),github={id:'12345',login:'bruis-approved'},ttl=300){return pair(await __test.signedCookie(e,OUTER,{kind:'security-session',github,iat:NOW(),exp:NOW()+ttl,nonce:`u-${github.login}`},Math.max(1,ttl)),OUTER);}

const html=fs.readFileSync(new URL('../security/index.html',import.meta.url),'utf8');
assert.doesNotMatch(html,/trycloudflare\.com|camera_token|media_token|\b192\.168\.|\b10\.\d+\.\d+\.\d+/i);
assert.match(html,/\/security\/\$\{camera\}\/live\.mjpg/);
assert.match(html,/\/security\/\$\{clipCamera\}\/clip\//);
assert.match(html,/\/api\/controls/);
assert.match(html,/\/api\/control/);

const canonical=await req('https://kalenel.nl/security',{redirect:'manual'});
assert.equal(canonical.status,302); assert.equal(canonical.headers.get('Location'),'/security/');
const anonymous=await req('https://kalenel.nl/security/',{redirect:'manual'});
assert.equal(anonymous.status,302); assert.match(anonymous.headers.get('Location')||'',/^https:\/\/admin\.kalenel\.nl\/login\?/);
assert.equal(anonymous.headers.get('Cache-Control'),'no-store');
const anonMutation=await req('https://kalenel.nl/security/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
assert.equal(anonMutation.status,401); assert.deepEqual(await anonMutation.json(),{ok:false,error:'github_session_required'});

const e=env(); const outerCookie=await outer(e);
const page=await req('https://kalenel.nl/security/',{headers:{Cookie:outerCookie}},e);
assert.equal(page.status,200); assert.equal(page.headers.get('X-Kalenel-Security-Gate'),'github+totp');
assert.equal(page.headers.get('X-Frame-Options'),'DENY'); assert.match(page.headers.get('Content-Security-Policy')||'',/connect-src 'self'/);
const locked=await req('https://kalenel.nl/security/new/api/status',{headers:{Cookie:outerCookie}},e);
assert.equal(locked.status,401); assert.deepEqual(await locked.json(),{ok:false,error:'security_unlock_required'});
const badTotp=await req('https://kalenel.nl/security/auth/login',{method:'POST',headers:{Cookie:outerCookie,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'pw',totp:'12345'})},e);
assert.equal(badTotp.status,400);

const calls=[]; const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  const url=String(input);
  if(url==='https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/admin_login'){
    assert.deepEqual(JSON.parse(String(init.body||'{}')),{input_username:'admin',input_password:'pw',input_totp_code:'123456'});
    return Response.json({admin_session_token:ADMIN_TOKEN});
  }
  if(url===SESSION_URL){
    assert.equal(init.method,'POST'); assert.equal(init.headers?.Origin,'https://kalenel.nl');
    return Response.json({ok:true,camera_origin:CAMERA_ORIGIN,camera_token:CAMERA_TOKEN,media_token:MEDIA_TOKEN,expires_at:new Date(Date.now()+300000).toISOString(),camera_token_expires_at:new Date(Date.now()+240000).toISOString()});
  }
  if(url.startsWith(CAMERA_ORIGIN+'/')){
    const u=new URL(url),h=new Headers(init.headers||{});
    assert.equal(u.searchParams.get('token'),CAMERA_TOKEN);
    assert.equal(h.get('X-Kalenel-Media-Token'),null);
    assert.equal(h.get('Authorization'),null);
    assert.equal(init.redirect,'error');
    const m=u.pathname.match(/^\/(new|s3)\/(api\/(status|events|controls|control)|live\.mjpg|snap\/([^/]+)|clip\/([^/]+))$/);
    assert.ok(m,`unexpected camera path ${u.pathname}`);
    const camera=m[1],kind=m[3]|| (m[2]==='live.mjpg'?'live':m[4]?'snap':m[5]?'clip':'');
    const name=m[4]||m[5]||'';
    if(kind==='control'){
      assert.equal(init.method,'POST');
      assert.equal(h.get('Content-Type'),'application/json');
      assert.deepEqual(JSON.parse(String(init.body||'{}')),{action:'torch',value:true});
    }
    calls.push({camera,kind,name,range:h.get('Range')||'',method:init.method||'GET'});
    if(camera==='s3'&&kind==='events') return new Response('expired',{status:401});
    return Response.json({ok:true,path:u.pathname},{headers:{ETag:'unit-etag','X-Upstream-Secret':'no'}});
  }
  throw new Error(`unexpected fetch ${url}`);
};

try{
  const login=await req('https://kalenel.nl/security/auth/login',{method:'POST',headers:{Cookie:outerCookie,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'pw',totp:'123456'})},e);
  assert.equal(login.status,200); const body=await login.json(); assert.equal(body.ok,true); assert.equal(Object.hasOwn(body,'camera_token'),false); assert.equal(Object.hasOwn(body,'camera_origin'),false); assert.equal(Object.hasOwn(body,'media_token'),false);
  const setCookie=login.headers.get('Set-Cookie')||''; assert.match(setCookie,new RegExp(`${MEDIA}=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+`)); assert.match(setCookie,/HttpOnly/); assert.match(setCookie,/Secure/); assert.match(setCookie,/SameSite=Strict/); assert.doesNotMatch(setCookie,new RegExp(CAMERA_TOKEN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))); assert.doesNotMatch(setCookie,new RegExp(MEDIA_TOKEN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))); assert.doesNotMatch(setCookie,/trycloudflare\.com/i);
  const mediaCookie=pair(setCookie,MEDIA); const auth=cookies(outerCookie,mediaCookie); assert.ok(mediaCookie);

  const n=await req('https://kalenel.nl/security/new/api/status',{headers:{Cookie:auth}},e); assert.equal(n.status,200); assert.deepEqual(await n.json(),{ok:true,path:'/new/api/status'}); assert.equal(n.headers.get('X-Upstream-Secret'),null); assert.equal(n.headers.get('X-Kalenel-Security-Media-Path'),'direct');
  const s=await req('https://kalenel.nl/security/s3/api/status',{headers:{Cookie:auth}},e); assert.equal(s.status,200); assert.deepEqual(await s.json(),{ok:true,path:'/s3/api/status'});
  const controls=await req('https://kalenel.nl/security/new/api/controls',{headers:{Cookie:auth}},e); assert.equal(controls.status,200); assert.deepEqual(await controls.json(),{ok:true,path:'/new/api/controls'});
  const control=await req('https://kalenel.nl/security/new/api/control',{method:'POST',headers:{Cookie:auth,'Content-Type':'application/json'},body:JSON.stringify({action:'torch',value:true})},e); assert.equal(control.status,200); assert.deepEqual(await control.json(),{ok:true,path:'/new/api/control'});
  const clip=await req('https://kalenel.nl/security/new/clip/capture-01.mp4',{headers:{Cookie:auth,Range:'bytes=0-999'}},e); assert.equal(clip.status,200); assert.equal(calls.at(-1).range,'bytes=0-999');
  assert.equal((await req('https://kalenel.nl/security/new/clip/a.txt',{headers:{Cookie:auth}},e)).status,404);
  assert.equal((await req('https://kalenel.nl/security/new/clip/bad..mp4',{headers:{Cookie:auth}},e)).status,404);
  assert.equal((await req('https://kalenel.nl/security/other/api/status',{headers:{Cookie:auth}},e)).status,404);
  const badControl=await req('https://kalenel.nl/security/new/api/control',{method:'POST',headers:{Cookie:auth,'Content-Type':'application/json'},body:'not-json'},e); assert.equal(badControl.status,400);

  const expiredUpstream=await req('https://kalenel.nl/security/s3/api/events',{headers:{Cookie:auth}},e); assert.equal(expiredUpstream.status,401); assert.match(expiredUpstream.headers.get('Set-Cookie')||'',new RegExp(`${MEDIA}=; Max-Age=0`));
  const otherOuter=await outer(e,{id:'12345',login:'different-login'}); const replay=await req('https://kalenel.nl/security/new/api/status',{headers:{Cookie:cookies(otherOuter,mediaCookie)}},e); assert.equal(replay.status,401);

  const raw=mediaCookie.slice(`${MEDIA}=`.length); const [payload,sig]=raw.split('.'); assert.ok(payload&&sig);
  const alteredPayload=(payload[0]==='A'?'B':'A')+payload.slice(1); const tampered=`${MEDIA}=${alteredPayload}.${sig}`;
  const tamperedResponse=await req('https://kalenel.nl/security/new/api/status',{headers:{Cookie:cookies(outerCookie,tampered)}},e); assert.equal(tamperedResponse.status,401);

  const logout=await req('https://kalenel.nl/security/auth/logout',{method:'POST',headers:{Cookie:auth}},e); assert.equal(logout.status,200); assert.match(logout.headers.get('Set-Cookie')||'',new RegExp(`${MEDIA}=; Max-Age=0`));
  assert.equal((await req('https://evil.example/security/new/api/status',{headers:{Cookie:auth}},e)).status,404);
  assert.equal(calls.some(x=>x.camera==='new'&&x.kind==='status'),true); assert.equal(calls.some(x=>x.camera==='s3'&&x.kind==='status'),true); assert.equal(calls.some(x=>x.camera==='new'&&x.kind==='clip'&&x.name==='capture-01.mp4'),true); assert.equal(calls.some(x=>x.camera==='new'&&x.kind==='control'&&x.method==='POST'),true);
}finally{globalThis.fetch=originalFetch;}

const expiredOuter=await outer(e,{id:'12345',login:'bruis-approved'},-1); const expiredPage=await req('https://kalenel.nl/security/',{headers:{Cookie:expiredOuter},redirect:'manual'},e); assert.equal(expiredPage.status,302);
console.log('v813 private security worker boundary tests passed for v776 direct-origin controls with relay-capable encrypted session');
