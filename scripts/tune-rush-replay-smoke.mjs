// Live, disposable capability room. Run after the replay migration is deployed.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
const endpoint='https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/musicquiz_v1';
const key='sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA';
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code=[...randomBytes(6)].map(n=>alphabet[n%alphabet.length]).join('');
const host=randomBytes(32).toString('hex'),alice=randomBytes(32).toString('hex'),bob=randomBytes(32).toString('hex');
async function rpc(action,token=host,data={}){
 const response=await fetch(endpoint,{method:'POST',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify({p_action:action,p_code:code,p_hash:createHash('sha256').update(token).digest('hex'),p_data:data})});
 const state=await response.json();if(!response.ok)throw Error(state.message||'request_failed');return state;
}
await rpc('create');await rpc('join',alice,{name:'ReplayAlice'});await rpc('join',bob,{name:'ReplayBob'});
await rpc('start',host,{mode:'youtube',videoId:'M7lc1UVf-VE',song:'Replay Example',artist:'Sample Artist',cueMs:10000});
await rpc('play');await rpc('pause');
const replay={expectedRound:1,expectedStep:0};
let state=await rpc('replay',host,replay);
assert.equal(state.phase,'playing');assert.equal(state.step,0);assert.equal(state.clipMs,500);assert.equal(state.audio.cueMs,10000);
assert.ok(state.players.every(p=>p.score===0));
assert.equal((await rpc('replay',host,replay)).step,0);
await assert.rejects(rpc('replay',alice,replay),/replay_unavailable/);
await assert.rejects(rpc('replay',host,{expectedRound:1,expectedStep:1}),/stale_clue/);
await rpc('buzz',alice);await assert.rejects(rpc('replay',host,replay),/replay_unavailable/);
await rpc('answer',alice,{song:'Replay Example',artist:'wrong'});
await rpc('steal',bob);state=await rpc('answer',bob,{artist:'Sample Artist'});assert.equal(state.phase,'solved');
assert.equal(state.players.find(p=>p.name==='ReplayBob').score,0.5);
await rpc('next',host,{videoId:'M7lc1UVf-VE',song:'Round Two',artist:'Another Artist',cueMs:0});
await rpc('play');await assert.rejects(rpc('replay',host,replay),/stale_clue/);await rpc('pause');
state=await rpc('state',alice);assert.equal(state.audio,null);assert.equal(state.title,null);assert.equal(state.artist,null);
console.log('TUNE_RUSH_REPLAY_LIVE_PASS',JSON.stringify({code,players:2,stepPreserved:true,buzzerProtected:true,staleRequestsRejected:true,steal:true,answerPrivacy:true}));
