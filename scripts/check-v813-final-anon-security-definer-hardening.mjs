#!/usr/bin/env node
import fs from 'node:fs';

const sqlFile='GEJAST_20260830113728_harden_remaining_anon_security_definer_search_paths_v813.sql';
const proofFile='ANON_SECURITY_DEFINER_HARDENING_PROOF_20260830.json';
const fail=(message)=>{throw new Error(`V813_FINAL_ANON_SECURITY_DEFINER_FAIL ${message}`);};
for(const path of [sqlFile,proofFile]) if(!fs.existsSync(path)) fail(`missing ${path}`);

const sql=fs.readFileSync(sqlFile,'utf8');
const executableSql=sql.replace(/^\s*--.*$/gm,'');
const norm=executableSql.toLowerCase().replace(/\s+/g,' ').trim();
const proof=JSON.parse(fs.readFileSync(proofFile,'utf8'));

const signatures=[
  'public.ballroom_abdicate_safe(text,text)',
  'public.ballroom_resolve_request_safe(text,text,bigint,boolean)',
  'public.create_combined_drink_speed_attempt(text,text,numeric,numeric,double precision,double precision,double precision)',
  'public.create_combined_drink_speed_attempt(text,text,text,numeric,numeric,double precision,double precision,double precision)',
  'public.create_drink_event_v382(text,text,numeric,double precision,double precision,double precision)',
  'public.create_drink_speed_attempt(text,text,text,numeric,numeric,double precision,double precision,double precision)',
  'public.create_drink_speed_attempt_v382(text,text,text,numeric,numeric,double precision,double precision,double precision)',
  'public.draw_next_paardenrace_card_safe(text,text,text)',
  'public.draw_paardenrace_card_safe(text,text,text,text)',
  'public.draw_paardenrace_card_safe(text,text,text)',
  'public.get_ballroom_public_state(text,text)',
  'public.get_drink_speed_page_public(text,double precision,double precision)',
  'public.get_drinks_workflow_public(text,double precision,double precision,integer)',
  'public.get_my_pending_drink_requests_public(text)',
  'public.get_paardenrace_pending_drink_verifications_safe(text,text,text)',
  'public.get_paardenrace_stats_public(text,text)',
  'public.get_verified_drinks_history_public(integer)',
  'public.join_paardenrace_room_safe(text,text,text)',
  'public.klaverjas_clear_active_match_presence_scoped(text,bigint)',
  'public.klaverjas_get_fun_ladders_public(text)',
  'public.klaverjas_get_live_match_public(bigint)',
  'public.klaverjas_get_player_stats_public(text,text)',
  'public.klaverjas_get_quick_stats_public(bigint,integer)',
  'public.klaverjas_set_active_match_presence_scoped(text,bigint,text,text,text)',
  'public.reset_paardenrace_room_safe(text,text,text)',
  'public.reshuffle_paardenrace_draw_pile_safe(text,text,text,text)',
  'public.save_paardenrace_choice_safe(text,text,text,text,integer,bigint)',
  'public.save_paardenrace_choice_safe(text,text,text,text,integer)',
  'public.submit_paardenrace_nominations_safe(text,jsonb,text,text,text)',
  'public.submit_paardenrace_nominations_safe(text,text,text,jsonb)',
  'public.tick_paardenrace_room_safe(text,text,text,text)',
  'public.verify_drink_event(text,bigint,numeric,numeric,numeric,boolean,text)',
  'public.verify_drink_speed_attempt(text,bigint,numeric,numeric,numeric,boolean,text)',
  'public.verify_paardenrace_obligation_safe(text,text,text,bigint)'
];

const alterCount=(executableSql.match(/\balter\s+function\b/gi)||[]).length;
if(alterCount!==34) fail(`expected 34 ALTER FUNCTION statements, got ${alterCount}`);
if(signatures.length!==34 || new Set(signatures).size!==34) fail('checker signature inventory is not exactly 34 unique signatures');
for(const sig of signatures) {
  if(!norm.includes(`alter function ${sig} set search_path = public;`)) fail(`fixed search_path statement missing for ${sig}`);
}
for(const forbidden of [
  /\bcreate\s+(or\s+replace\s+)?function\b/i,
  /\bdrop\s+function\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\balter\s+role\b/i,
  /\bstatement_timeout\b/i
]) {
  if(forbidden.test(executableSql)) fail(`unexpected non-target SQL matching ${forbidden}`);
}

if(proof.schema_version!==1 || proof.site_version!=='v813') fail('proof schema/site version mismatch');
if(proof.supabase_project_id!=='uiqntazgnrxwliaidkmy') fail('Supabase project mismatch');
if(proof.source_baseline_main_sha!=='83bea253dc9eb1e736b7be9f3c0a3e697574fa2c') fail('source baseline main SHA mismatch');
if(proof.certified_product_sha_unchanged!==true || proof.certified_product_sha!=='570ef4bded55493a226d1fc7c8afbb1e35244f56') fail('certified product SHA contract changed');
if(proof.frozen_certified_branch!=='release/v813-certified-20260825') fail('frozen certified branch mismatch');

const migration=proof.production_migration;
if(!migration) fail('production migration proof missing');
if(migration.version!=='20260830113728' || migration.name!=='harden_remaining_anon_security_definer_search_paths_v813') fail('production migration identity mismatch');
if(migration.source_file!==sqlFile || migration.functions_hardened!==34 || migration.migrations_reapplied_for_provenance!==false) fail('production migration provenance mismatch');

const catalog=proof.live_catalog_proof;
if(!catalog) fail('live catalog proof missing');
for(const key of ['expected_signatures','resolved_signatures','security_definer','fixed_search_path_public','anon_execute','authenticated_execute','service_role_execute']) {
  if(catalog[key]!==34) fail(`live catalog ${key} must be 34`);
}
if(catalog.function_bodies_with_dml_keyword!==18 || catalog.missing_signatures!==0) fail('live DML/missing-signature proof mismatch');

const classification=proof.final_anonymous_mutator_classification;
if(classification?.status!=='PASS_NO_NEW_UNAUTHENTICATED_AUTHORITATIVE_STATE_BYPASS_FOUND') fail('anonymous mutator classification did not pass');
if(!Array.isArray(classification.credential_gated_public_entrypoints) || classification.credential_gated_public_entrypoints.length!==2) fail('credential-gated entrypoint classification missing');
if(!Array.isArray(classification.intentional_public_claim_writes) || classification.intentional_public_claim_writes.length!==3) fail('public claim-write classification missing');
if(!Array.isArray(classification.intentional_public_analytics_writes) || !classification.intentional_public_analytics_writes.includes('track_site_event')) fail('analytics classification missing');
if(!Array.isArray(classification.intentional_public_ephemeral_compute_writes) || classification.intentional_public_ephemeral_compute_writes.length!==2) fail('ephemeral compute classification missing');
for(const key of ['analytics_caveat','compute_caveat','claim_caveat','authorization_conclusion']) {
  if(typeof classification[key]!=='string' || classification[key].length<20) fail(`classification caveat missing: ${key}`);
}

const advisors=proof.supabase_advisor_verification;
if(advisors?.security_function_search_path_findings!==0) fail('Supabase security advisor still reports function search-path findings');
if(JSON.stringify(advisors?.security_remaining_warnings)!==JSON.stringify(['auth_leaked_password_protection','auth_insufficient_mfa_options'])) fail('remaining security advisor warning set mismatch');
if(advisors?.performance_severity!=='INFO_ONLY') fail('performance advisor severity is not INFO_ONLY');

const nonTarget=proof.non_target_contract;
if(nonTarget?.frontend_changed!==false || nonTarget?.function_signatures_changed!==false || nonTarget?.execute_acl_changed_by_final_34_function_migration!==false || nonTarget?.statement_timeout_changed!==false || nonTarget?.certified_product_tree_changed!==false) fail('non-target contract changed');
if(proof.live_contract_verified!==true) fail('live contract verification flag missing');

console.log('RESULT=V813_FINAL_ANON_SECURITY_DEFINER_HARDENING_PASS');
