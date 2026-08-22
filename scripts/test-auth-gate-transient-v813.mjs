#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('gejast-auth-gate.js','utf8');
class StorageMock{constructor(entries={}){this.m=new Map(Object.entries(entries));}getItem(k){return this.m.has(k)?this.m.get(k):null;}setItem(k,v){this.m.set(k,String(v));}removeItem(k){this.m.delete(k);}}
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

async function run(sequence){
  const attrs=new Map();
  const style=new Map();
  const localStorage=new StorageMock({jas_session_token_v11:'fixture-token'});
  const sessionStorage=new StorageMock();
  let calls=0;
  const location={search:'',pathname:'/boerenbridge.html',replaced:'',replace(v){this.replaced=String(v);}};
  const ctx={
    console,Response,AbortController,URLSearchParams,setTimeout,clearTimeout,queueMicrotask,
    location,localStorage,sessionStorage,
    document:{
      scripts:[],
      documentElement:{setAttribute(k,v){attrs.set(k,String(v));},style:{setProperty(k,v){style.set(k,String(v));},removeProperty(k){style.delete(k);}}},
      createElement(){throw new Error('config script must not be created');},
      head:{appendChild(){throw new Error('config script must not be appended');}}
    },
    GEJAST_CONFIG:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'publishable-test-key'},
    fetch:async(input)=>{
      const url=String(typeof input==='string'?input:input?.url||'');
      if(!url.includes('/rest/v1/rpc/account_public_state_v687')) throw new Error(`unexpected request ${url}`);
      const next=sequence[Math.min(calls,sequence.length-1)];
      calls+=1;
      if(next instanceof Error) throw next;
      return response(next.body,next.status);
    }
  };
  ctx.window=ctx;ctx.globalThis=ctx;
  vm.createContext(ctx);
  new vm.Script(source,{filename:'gejast-auth-gate.js'}).runInContext(ctx);
  const ok=await ctx.GEJAST_AUTH_GATE;
  return {ok,calls,attrs,location,localStorage};
}

const transient=await run([
  {status:503,body:{message:'temporary'}},
  {status:502,body:{message:'temporary'}},
  {status:200,body:{ok:true,site_scope:'friends'}}
]);
assert.equal(transient.ok,true);
assert.equal(transient.calls,3,'two transient failures must be retried exactly twice');
assert.equal(transient.attrs.get('data-gejast-auth-state'),'authenticated');
assert.equal(transient.location.replaced,'');
assert.equal(transient.localStorage.getItem('jas_session_token_v11'),'fixture-token','transient errors must not erase a valid token');

const hardInvalid=await run([{status:200,body:{ok:false,site_scope:'friends'}}]);
assert.equal(hardInvalid.ok,false);
assert.equal(hardInvalid.calls,1,'authoritative invalid session must not be retried');
assert.equal(hardInvalid.attrs.get('data-gejast-auth-state'),'denied');
assert.match(hardInvalid.location.replaced,/login\.html/);
assert.equal(hardInvalid.localStorage.getItem('jas_session_token_v11'),null,'authoritative invalid session must clear the token');

console.log('RESULT=V813_AUTH_GATE_TRANSIENT_RETRY_PASS');
