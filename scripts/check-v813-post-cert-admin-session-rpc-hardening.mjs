#!/usr/bin/env node
import fs from 'node:fs';

const sqlFile='GEJAST_20260830001727_harden_ignored_admin_session_token_admin_rpcs.sql';
const proofFile='ADMIN_SESSION_RPC_HARDENING_PROOF_20260830.json';
const fail=(message)=>{throw new Error(`V813_POST_CERT_ADMIN_SESSION_RPC_FAIL ${message}`);};
for(const path of [sqlFile,proofFile]) if(!fs.existsSync(path)) fail(`missing ${path}`);

const sql=fs.readFileSync(sqlFile,'utf8');
const norm=sql.toLowerCase().replace(/\s+/g,' ').trim();
const proof=JSON.parse(fs.readFileSync(proofFile,'utf8'));
const functions=[
  'admin_get_home_profile_runtime_audit_v682',
  'admin_get_home_profile_runtime_audit_v683',
  'admin_get_klaverjassen_alignment_audit_v644',
  'admin_get_phase_completion_audit_v647',
  'admin_get_phase_completion_registry_v647',
  'admin_get_phase_runtime_smoke_v647'
];

for(const name of functions) {
  if(!norm.includes(`create or replace function public.${name}(`)) fail(`definition missing for ${name}`);
}
const createCount=(sql.match(/\bcreate\s+or\s+replace\s+function\s+public\./gi)||[]).length;
const guardCount=(sql.match(/_gejast_require_admin_session_v792m\s*\(\s*admin_session_token\s*\)/gi)||[]).length;
const securityDefinerCount=(sql.match(/\bsecurity\s+definer\b/gi)||[]).length;
const searchPathCount=(sql.match(/\bset\s+search_path\s+to\s+'public'/gi)||[]).length;
const materializedGuardCount=(sql.match(/with\s+_guard\s+as\s+materialized/gi)||[]).length;
if(createCount!==6) fail(`expected 6 function definitions, got ${createCount}`);
if(guardCount!==6) fail(`expected 6 canonical admin-session guard calls, got ${guardCount}`);
if(securityDefinerCount!==6) fail(`expected 6 SECURITY DEFINER declarations, got ${securityDefinerCount}`);
if(searchPathCount!==6) fail(`expected 6 fixed public search_path declarations, got ${searchPathCount}`);
if(materializedGuardCount!==2) fail(`expected 2 materialized SQL-language guard CTEs, got ${materializedGuardCount}`);

for(const forbidden of [/\bgrant\b/i,/\brevoke\b/i,/\balter\s+role\b/i,/\bstatement_timeout\b/i]) {
  if(forbidden.test(sql.replace(/^--.*$/gm,''))) fail(`unexpected privilege/timeout mutation matching ${forbidden}`);
}

if(proof.site_version!=='v813') fail('proof site_version mismatch');
if(proof.certified_product_sha_unchanged!==true) fail('certified product must remain unchanged');
if(proof.certified_product_sha!=='570ef4bded55493a226d1fc7c8afbb1e35244f56') fail('certified product SHA mismatch');
if(proof.source_baseline_main_sha!=='73cbe3b2c80b86c74c41c01cbc3e932ab526ba5a') fail('source baseline SHA mismatch');
if(proof.production_migration?.version!=='20260830001727') fail('migration version mismatch');
if(proof.production_migration?.name!=='harden_ignored_admin_session_token_admin_rpcs') fail('migration name mismatch');
if(proof.production_migration?.source_file!==sqlFile) fail('migration source file mismatch');
if(proof.frontend_changed!==false || proof.function_signatures_changed!==false || proof.execute_acl_changed!==false || proof.search_path_changed!==false || proof.statement_timeout_changed!==false) fail('non-target contract changed');
if(proof.catalog_guard_proof!=='6/6') fail('catalog guard proof incomplete');
if(proof.anon_null_token_rejection!=='6/6 admin_session_invalid') fail('anon rejection proof incomplete');
if(proof.live_contract_verified!==true || proof.migration_reapplied!==false) fail('live provenance flags invalid');
if(JSON.stringify(proof.functions)!==JSON.stringify(functions)) fail('proof function set mismatch');

console.log('RESULT=V813_POST_CERT_ADMIN_SESSION_RPC_HARDENING_PASS');
