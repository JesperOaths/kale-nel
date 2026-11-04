'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(process.argv[2]||'repo/music/solo/app.js','utf8').split('async function refresh(){')[0];
function fixture(ackFails=false){
 const calls=[];
 const context=vm.createContext({document:{getElementById:()=>({})},
  localStorage:{getItem:()=>''},crypto:webcrypto,TextEncoder,AbortController,setTimeout,clearTimeout,
  fetch:async(url,options)=>{
   calls.push({url,body:JSON.parse(options.body)});
   if(url.endsWith('tunerush_s21_submit_v1'))return {ok:true,json:async()=>({id:'test-job'})};
   if(url.endsWith('tunerush_s21_status_v1'))return {ok:true,json:async()=>({status:'done',result:{ok:true,body:{state:{source:'persistent-library'}}}})};
   if(url.endsWith('tunerush_s21_ack_v1')){
    if(ackFails)throw Error('temporary acknowledgment failure');
    return {ok:true,json:async()=>({ok:true})};
   }
   throw Error('Unexpected endpoint');
  }
 });
 vm.runInContext(source,context);return {api:vm.runInContext('api',context),calls};
}
(async()=>{
 for(const ackFails of [false,true]){
  const f=fixture(ackFails);const result=await f.api('/api/session','POST',{genres:['pop'],limit:5},false);
  assert.equal(result.state.source,'persistent-library');
  assert.equal(f.calls.filter(x=>x.url.endsWith('tunerush_s21_submit_v1')).length,1,'A failed cleanup must never replay the game action');
  const status=f.calls.find(x=>x.url.endsWith('tunerush_s21_status_v1'));
  const ack=f.calls.find(x=>x.url.endsWith('tunerush_s21_ack_v1'));
  assert.equal(ack.body.p_id,status.body.p_id);assert.equal(ack.body.p_poll_hash,status.body.p_poll_hash);
 }
 console.log('PASS browser: acknowledge received results and tolerate failed cleanup without replay');
})().catch(error=>{console.error(error);process.exit(1)});
