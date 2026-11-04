import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Run the real migration in an isolated Postgres instance with synthetic
// worker credentials and jobs. No production data or audio is used.
const sqlPath = process.argv[2];
assert.ok(sqlPath, 'A migration file path is required');
const db = new PGlite();
const worker = 'a'.repeat(64), poll = 'b'.repeat(64), wrong = 'c'.repeat(64);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
try {
  await db.exec(`
    create role anon; create role authenticated;
    create table public.tunerush_s21_relay_workers(id text primary key,secret_hash text,seen_at timestamptz);
    create table public.tunerush_s21_relay_jobs(
      id uuid primary key, poll_hash text not null, request_payload jsonb not null,
      response_payload jsonb, status text not null default 'queued',
      created_at timestamptz not null default now(), claimed_at timestamptz, finished_at timestamptz
    );
  `);
  await db.query(`insert into public.tunerush_s21_relay_workers(id,secret_hash)
    values('s21-solo',encode(sha256(convert_to($1,'UTF8')),'hex'))`,[worker]);
  await db.exec(await readFile(sqlPath,'utf8'));
  async function job(n,command='action',op='clue',status='claimed') {
    await db.query(`insert into public.tunerush_s21_relay_jobs(id,poll_hash,request_payload,status,claimed_at)
      values($1,$2,$3::jsonb,$4,now())`,[id(n),poll,JSON.stringify({command,data:{op}}),status]);
  }
  async function complete(n,result,secret=worker) {
    return db.query('select public.tunerush_s21_complete_v1($1,$2,$3::jsonb) as result',
      [secret,id(n),JSON.stringify(result)]);
  }
  const clue = size => ({ok:true,body:{state:{source:'persistent-library',phase:'playing',
    clipAudio:'data:audio/mpeg;base64,'+'A'.repeat(size)}}});

  await job(1);
  await assert.rejects(complete(1,{ok:true},wrong),/Worker not authorized/);
  const accepted=await complete(1,clue(1_400_000));
  assert.equal(accepted.rows[0].result.ok,true,'A bounded 20-second clue should complete');
  await db.query('select public.tunerush_s21_ack_v1($1,$2)',[id(1),wrong]);
  assert.equal((await db.query('select count(*)::int n from public.tunerush_s21_relay_jobs where id=$1',[id(1)])).rows[0].n,1,'Wrong capability must not remove a job');
  await db.query('select public.tunerush_s21_ack_v1($1,$2)',[id(1),poll]);
  await db.query('select public.tunerush_s21_ack_v1($1,$2)',[id(1),poll]);
  assert.equal((await db.query('select count(*)::int n from public.tunerush_s21_relay_jobs where id=$1',[id(1)])).rows[0].n,0,'Acknowledgment must be safe to repeat');

  await job(2,'action','answer');
  await assert.rejects(complete(2,clue(20_000)),/Invalid game result/);
  await job(3);
  await assert.rejects(complete(3,clue(1_466_701)),/Invalid game result/);
  await job(4);
  await assert.rejects(complete(4,{ok:true,body:{state:{source:'other',phase:'playing',clipAudio:'x'.repeat(20_000)}}}),/Invalid game result/);
  await job(5,'state');
  assert.equal((await complete(5,clue(20_000))).rows[0].result.ok,true,'Restoring a playing session must permit its clue');

  await db.query(`update public.tunerush_s21_relay_jobs set finished_at=now()-interval '91 seconds' where id=$1`,[id(5)]);
  await job(6,'action','clue','queued');
  await db.query('select public.tunerush_s21_claim_v1($1)',[worker]);
  assert.equal((await db.query('select count(*)::int n from public.tunerush_s21_relay_jobs where id=$1',[id(5)])).rows[0].n,0,'Lost acknowledgments must be cleaned up');
  assert.equal((await db.query('select status from public.tunerush_s21_relay_jobs where id=$1',[id(6)])).rows[0].status,'claimed','Queued requests must remain claimable');
  const privileges=await db.query(`select has_table_privilege('anon','public.tunerush_s21_relay_jobs','SELECT,INSERT,UPDATE,DELETE') as can_access`);
  assert.equal(privileges.rows[0].can_access,false,'The job table stays private');
  console.log('PASS relay: authenticated worker, bounded MP3 results, capability-scoped acknowledgments and cleanup');
} finally { await db.close(); }
