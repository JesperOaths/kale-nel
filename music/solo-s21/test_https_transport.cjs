"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const {webcrypto}=require("node:crypto");
const file=process.argv[2]||"repo/music/solo/app.js";
const source=fs.readFileSync(file,"utf8").split("async function refresh(){")[0];
function fixture(handler){
 const calls=[];
 const context=vm.createContext({document:{getElementById:()=>({})},
  localStorage:{getItem:()=>"a".repeat(64)},crypto:webcrypto,AbortController,TextEncoder,setTimeout,clearTimeout,
  fetch:async(url,options)=>{calls.push({url,options});return handler(url,options)},
 });
 vm.runInContext(source,context);
 return {api:vm.runInContext("api",context),calls};
}
const response=body=>({ok:true,status:200,json:async()=>body});
(async()=>{
 const direct=fixture((url,options)=>{
  assert.ok(url.startsWith("https://jesper-hub.tail87c632.ts.net/"));
  return response(url.endsWith("/health")?{ready:true,service:"tunerush-s21-solo"}:{state:{source:"persistent-library"}});
 });
 const started=await direct.api("/api/session","POST",{limit:5},false);
 assert.equal(started.state.source,"persistent-library");
 assert.equal(direct.calls.filter(x=>x.options.method==="POST").length,1);
 assert.equal(direct.calls[0].options.headers.Authorization,undefined);
 assert.equal(direct.calls.at(-1).options.redirect,"error");

 const interrupted=fixture(url=>{
  if(url.endsWith("/health"))return response({ready:true,service:"tunerush-s21-solo"});
  throw new Error("network disconnected after submission");
 });
 await assert.rejects(interrupted.api("/api/action","POST",{op:"clue",round:1}));
 assert.equal(interrupted.calls.filter(x=>x.options.method==="POST").length,1);
 assert.ok(!interrupted.calls.some(x=>x.url.includes("supabase.co")),"must not replay a mutation via the queue");

 const fallback=fixture(url=>{
  if(url.includes(".ts.net"))throw new Error("HTTPS route not enabled");
  if(url.endsWith("tunerush_s21_health_v1"))return response({online:true});
  if(url.endsWith("tunerush_s21_submit_v1"))return response({id:"test-job"});
  if(url.endsWith("tunerush_s21_status_v1"))return response({status:"done",result:{ok:true,body:{state:{source:"persistent-library"}}}});
  throw new Error("Unexpected request");
 });
 assert.equal((await fallback.api("/api/health","GET",null,false)).ready,true);
 assert.equal((await fallback.api("/api/session","POST",{limit:5},false)).state.source,"persistent-library");
 assert.equal(fallback.calls.filter(x=>x.url.endsWith("tunerush_s21_submit_v1")).length,1);
 console.log("PASS: direct HTTPS, retained queue fallback, and no mutation replay");
})().catch(error=>{console.error(error);process.exit(1)});
