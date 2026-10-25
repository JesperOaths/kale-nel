// In-memory PostgreSQL regression for the UNDEPLOYED license-gated Deezer mode.
// Tests no authorization, permitted test-only transaction, host ID secrecy, no-repeat.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
const db=new PGlite(),read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
try{
 await db.exec("create role anon; create role authenticated; create role service_role;");
 for(const file of ["sql/musicquiz-v1.sql","sql/musicquiz-direct-public-v1.sql",
   "sql/musicquiz-youtube-host-video-v2.sql","sql/musicquiz-filtered-video-pool-v3.sql"])
   await db.exec(read(file));
 await db.exec(read("sql/musicquiz-official-youtube-enrichment-v4.sql")
   .split("create or replace function public.musicquiz_catalog_import_v1")[0]);
 await db.exec(read("supabase/migrations/20261025032513_musicquiz_replay_current_clue.sql"));
 await db.exec(read("sql/musicquiz-deezer-preview-gated-v5.sql"));
 const host="a".repeat(64),guest="b".repeat(64),code="DZZQ83";
 async function rpc(action,token=host,data={}){
  return (await db.query("select public.musicquiz_v1($1,$2,$3,$4::jsonb) as state",
   [action,code,token,JSON.stringify(data)])).rows[0].state;
 }
 await db.exec("insert into musicquiz.deezer_tracks(track_id,title,artist,genres,release_year) values (664107,'Take on Me','a-ha',array['pop'],1985),(12345678999,'Test Song','Test Artist',array['pop'],1987)");
 await db.exec("set role anon");
 assert.equal((await db.query("select public.musicquiz_deezer_enabled_v1() as enabled")).rows[0].enabled,false);
 await rpc("create");await rpc("join",guest,{name:"DeezerGuest"});
 await rpc("settings",host,{genres:["pop"],decades:["1980"]});
 await assert.rejects(rpc("start",host,{mode:"deezer"}),/deezer_not_authorized/);
 await assert.rejects(db.query("select * from musicquiz.deezer_tracks"),/permission denied/);
 await assert.rejects(db.query("select public.musicquiz_deezer_host_preview_v1($1,$2)",[code,host]),/permission denied/);
 await db.exec("reset role");
 await db.exec("update musicquiz.deezer_approval set approved=true, authorization_reference='OFFLINE_LICENSING_TEST_NOT_REAL', authorized_at=now() where id=1");
 await db.exec("set role anon");
 assert.equal((await db.query("select public.musicquiz_deezer_enabled_v1() as enabled")).rows[0].enabled,true);
 let r=await rpc("start",host,{mode:"deezer"});
 assert.equal(r.mode,"deezer");assert.deepEqual(r.decades,["1980"]);
 assert.match(r.audio.source,/^deezer:\d+$/);
 assert.ok(r.audio.cueMs>=0&&r.audio.cueMs<=9000);
 const first=r.audio.source;
 const guestState=await rpc("state",guest);
 assert.equal(guestState.audio,null);assert.equal(guestState.title,null);assert.equal(guestState.artist,null);
 await db.exec("reset role");
 await db.exec("set role service_role");
 let preview=(await db.query("select public.musicquiz_deezer_host_preview_v1($1,$2) as data",[code,host])).rows[0].data;
 assert.equal("deezer:"+preview.trackId,first);
 assert.equal(preview.cueMs,r.audio.cueMs);
 await assert.rejects(db.query("select public.musicquiz_deezer_host_preview_v1($1,$2)",[code,guest]),/unauthorized/);
 await db.exec("reset role");await db.exec("set role anon");
 r=await rpc("skip",host);assert.equal(r.phase,"solved");
 r=await rpc("next",host);assert.equal(r.round,2);assert.notEqual(r.audio.source,first);
 await db.exec("reset role");
 await db.exec("update musicquiz.deezer_approval set approved=false, authorization_reference='', authorized_at=null where id=1");
 await db.exec("set role anon");
 await assert.rejects(rpc("next",host),/round_not_solved/);
 await db.exec("reset role");await db.exec("set role service_role");
 await assert.rejects(db.query("select public.musicquiz_deezer_host_preview_v1($1,$2)",[code,host]),/deezer_not_authorized/);
 console.log("DEEZER_LICENSE_DB_PASS",JSON.stringify({defaultGate:"closed",hostSecret:"required",guests:"cannot read audio",cue:"0-9 seconds",filters:"1980s pop",rounds:"no premature repeat",revocation:"immediate"}));
}finally{await db.close()}
