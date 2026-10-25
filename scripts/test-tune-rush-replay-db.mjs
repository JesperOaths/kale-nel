import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// In-memory PostgreSQL: exercises the real SQL without contacting production.
const db=new PGlite();
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n');
try{
 await db.exec('create role anon; create role authenticated; create role service_role;');
 for(const path of ['sql/musicquiz-v1.sql','sql/musicquiz-direct-public-v1.sql','sql/musicquiz-youtube-host-video-v2.sql','sql/musicquiz-filtered-video-pool-v3.sql'])await db.exec(read(path));
 await db.exec(read('sql/musicquiz-official-youtube-enrichment-v4.sql').split('create or replace function public.musicquiz_catalog_import_v1')[0]);
 const migration=read('supabase/migrations/20261025032513_musicquiz_replay_current_clue.sql');
 await db.exec(migration);await db.exec(migration); // Safe reapplication guard.
 await db.exec('set role anon');
 const host='a'.repeat(64),player='b'.repeat(64),outsider='c'.repeat(64),code='REPLAY';
 async function rpc(action,hash=host,data={}){
  return (await db.query('select public.musicquiz_v1($1,$2,$3,$4::jsonb) as state',[action,code,hash,JSON.stringify(data)])).rows[0].state;
 }
 await rpc('create');await rpc('join',player,{name:'ReplayPlayer'});
 await rpc('start',host,{mode:'youtube',videoId:'M7lc1UVf-VE',song:'Test Song',artist:'Test Artist',cueMs:10000});
 await assert.rejects(rpc('replay',host,{expectedRound:1,expectedStep:0}),/replay_unavailable/);
 let state=await rpc('play');await rpc('pause');
 const original={step:state.step,clipMs:state.clipMs,cue:state.audio.cueMs,score:state.players[0].score};
 state=await rpc('replay',host,{expectedRound:1,expectedStep:0});
 assert.equal(state.phase,'playing');assert.equal(state.step,original.step);assert.equal(state.clipMs,original.clipMs);
 assert.equal(state.audio.cueMs,original.cue);assert.equal(state.players[0].score,original.score);
 assert.equal((await rpc('replay',host,{expectedRound:1,expectedStep:0})).step,0,'duplicate recovery is idempotent');
 await assert.rejects(rpc('replay',host,{expectedRound:2,expectedStep:0}),/stale_clue/);
 await assert.rejects(rpc('replay',host,{expectedRound:1,expectedStep:1}),/stale_clue/);
 await assert.rejects(rpc('replay',host,{expectedRound:'bad',expectedStep:0}),/stale_clue/);
 await assert.rejects(rpc('replay',player,{expectedRound:1,expectedStep:0}),/replay_unavailable/);
 await assert.rejects(rpc('replay',outsider,{expectedRound:1,expectedStep:0}),/unauthorized/);
 state=await rpc('state',player);assert.equal(state.audio,null);assert.equal(state.title,null);assert.equal(state.artist,null);
 await assert.rejects(db.query('select * from musicquiz.rooms'),/permission denied/);
 await rpc('buzz',player);
 await assert.rejects(rpc('replay',host,{expectedRound:1,expectedStep:0}),/replay_unavailable/);
 assert.equal((await rpc('pause')).phase,'answering','late host pause cannot clear a buzzer claim');
 await rpc('answer',player,{song:'wrong',artist:'wrong'});await rpc('resume');
 await assert.rejects(rpc('replay',host,{expectedRound:1,expectedStep:0}),/replay_unavailable/,'replay cannot erase an answer attempt');
 state=await rpc('play');assert.equal(state.step,1);await rpc('pause');
 await assert.rejects(rpc('replay',host,{expectedRound:1,expectedStep:0}),/stale_clue/);
 assert.equal((await rpc('replay',host,{expectedRound:1,expectedStep:1})).step,1);
 await rpc('pause');
 for(let step=2;step<=6;step++){await rpc('play');await rpc('pause')}
 state=await rpc('replay',host,{expectedRound:1,expectedStep:6});
 assert.equal(state.clipMs,20000,'last clue remains replayable');assert.equal(state.step,6);
 await db.exec('reset role');
 await db.exec("update musicquiz.players set score=19 where name='ReplayPlayer'");
 await db.exec('set role anon');
 await rpc('buzz',player);state=await rpc('answer',player,{song:'Test Song',artist:'Test Artist'});
 assert.equal(state.phase,'finished');assert.equal(state.players[0].score,20);
 await assert.rejects(rpc('replay',host,{expectedRound:1,expectedStep:6}),/replay_unavailable/);
 console.log('TUNE_RUSH_REPLAY_DB_PASS: same cue/step/score, idempotency, stale requests, host-only access, privacy, buzzer locks, final clue, winner');
}finally{await db.close()}
