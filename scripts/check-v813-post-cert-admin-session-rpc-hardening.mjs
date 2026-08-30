#!/usr/bin/env node
import fs from 'node:fs';

const sqlFiles=[
  'GEJAST_20260830001727_harden_ignored_admin_session_token_admin_rpcs.sql',
  'GEJAST_20260830002126_harden_remaining_home_profile_admin_session_rpcs.sql'
];
const proofFile='ADMIN_SESSION_RPC_HARDENING_PROOF_20260830.json';
const fail=(message)=>{throw new Error(`V813_POST_CERT_ADMIN_SESSION_RPC_FAIL ${message}`);};
for(const path of [...sqlFiles,proofFile]) if(!fs.existsSync(path)) fail(`missing ${path}`);

const sqlParts=sqlFiles.map(path=>fs.readFileSync(path,'utf8'));
const sql=sqlParts.join('\n');
const executableSql=sqlParts.map(part=>part.replace(/^\s*--.*$/gm,'')).join('\n');
const norm=executableSql.toLowerCase().replace(/\s+/g,' ').trim();
const proof=JSON.parse(fs.readFileSync(proofFile,'utf8'));
const functions=[
  'admin_get_home_profile_runtime_audit_v682',
  'admin_get_home_profile_runtime_audit_v683',
  'admin_get_klaverjassen_alignment_audit_v644',
  'admin_get_phase_completion_audit_v647',
  'admin_get_phase_completion_registry_v647',
  'admin_get_phase_runtime_smoke_v647',
  'admin_get_home_profile_runtime_audit_v685',
  'admin_get_home_profile_runtime_audit_v686',
  'admin_get_home_profile_runtime_audit_v687'
];

for(const name of functions) {
  if(!norm.includes(`create or replace function public.${name}(`)) fail(`definition missing for ${name}`);
}
const createCount=(executableSql.match(/\bcreate\s+or\s+replace\s+function\s+public\./gi)||[]).length;
const guardCount=(executableSql.match(/_gejast_require_admin_session_v792m\s*\(\s*admin_session_token(?:_input)?\s*\)/gi)||[]).length;
const securityDefinerCount=(executableSql.match(/\bsecurity\s+definer\b/gi)||[]).length;
const searchPathCount=(executableSql.match(/\bset\s+search_path\s+to\s+'public'/gi)||[]).length;
const materializedGuardCount=(executableSql.match(/with\s+_guard\s+as\s+materialized/gi)||[]).length;
if(createCount!==9) fail(`expected 9 function definitions, got ${createCount}`);
if(guardCount!==9) fail(`expected 9 canonical admin-session guard calls, got ${guardCount}`);
if(securityDefinerCount!==9) fail(`expected 9 SECURITY DEFINER declarations, got ${securityDefinerCount}`);
if(searchPathCount!==9) fail(`expected 9 fixed public search_path declarations, got ${searchPathCount}`);
if(materializedGuardCount!==4) fail(`expected 4 materialized SQL-language guard CTEs, got ${materializedGuardCount}`);

for(const forbidden of [/\bgrant\b/i,/\brevoke\b/i,/\balter\s+role\b/i,/\bstatement_timeout\b/i]) {
  if(forbidden.test(executableSql)) fail(`unexpected privilege/timeout mutation matching ${forbidden}`);
}

if(proof.site_version!=='v813') fail('proof site_version mismatch');
if(proof.certified_product_sha_unchanged!==true) fail('certified product must remain unchanged');
if(proof.certified_product_sha!=='570ef4bded55493a226d1fc7c8afbb1e35244f56') fail('certified product SHA mismatch');
if(proof.source_baseline_main_sha!=='73cbe3b2c80b86c74c41c01cbc3e932ab526ba5a') fail('source baseline SHA mismatch');
const expectedMigrations=[
  ['20260830001727','harden_ignored_admin_session_token_admin_rpcs',sqlFiles[0],6],
  ['20260830002126','harden_remaining_home_profile_admin_session_rpcs',sqlFiles[1],3]
];
if(!Array.isArray(proof.production_migrations) || proof.production_migrations.length!==expectedMigrations.length) fail('production migration list mismatch');
for(const [version,name,source_file,functions_hardened] of expectedMigrations) {
  const row=proof.production_migrations.find(item=>item.version===version);
  if(!row || row.name!==name || row.source_file!==source_file || row.functions_hardened!==functions_hardened) fail(`migration provenance mismatch for ${version}`);
}
if(proof.latest_production_migration?.version!=='20260830002126' || proof.latest_production_migration?.name!=='harden_remaining_home_profile_admin_session_rpcs') fail('latest production migration mismatch');
if(proof.frontend_changed!==false || proof.function_signatures_changed!==false || proof.execute_acl_changed!==false || proof.search_path_changed!==false || proof.statement_timeout_changed!==false) fail('non-target contract changed');
if(proof.catalog_guard_proof!=='9/9') fail('catalog guard proof incomplete');
if(proof.anon_null_token_rejection!=='9/9 admin_session_invalid') fail('anon rejection proof incomplete');
if(proof.residual_ignored_admin_token_classifier_rows!==0) fail('ignored-admin-token classifier is not empty');
if(proof.live_contract_verified!==true || proof.migrations_reapplied!==false) fail('live provenance flags invalid');
if(JSON.stringify(proof.functions)!==JSON.stringify(functions)) fail('proof function set mismatch');

console.log('RESULT=V813_POST_CERT_ADMIN_SESSION_RPC_HARDENING_PASS');
