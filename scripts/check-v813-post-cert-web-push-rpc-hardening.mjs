#!/usr/bin/env node
import fs from 'node:fs';

const legacyPushFile='GEJAST_20260829223803_lock_legacy_drinks_push_summary_rpc_exposure_20260830.sql';
const legacyPendingFile='GEJAST_20260829224000_lock_legacy_drinks_pending_summary_rpc_exposure_20260830.sql';
const safeV661File='GEJAST_20260829231158_restore_safe_drinks_push_v661_diagnostics.sql';
const acceptanceFile='final-acceptance-v813.json';
const files=[legacyPushFile,legacyPendingFile,safeV661File,acceptanceFile];
for(const path of files) {
  if(!fs.existsSync(path)) throw new Error(`V813_POST_CERT_WEB_PUSH_RPC_FAIL missing ${path}`);
}

const fail=(message)=>{throw new Error(`V813_POST_CERT_WEB_PUSH_RPC_FAIL ${message}`);};
const normalize=(text)=>text.toLowerCase().replace(/\s+/g,' ').trim();
const legacyPushSql=fs.readFileSync(legacyPushFile,'utf8');
const legacyPendingSql=fs.readFileSync(legacyPendingFile,'utf8');
const safeSql=fs.readFileSync(safeV661File,'utf8');
const acceptance=JSON.parse(fs.readFileSync(acceptanceFile,'utf8'));
const legacyPushNorm=normalize(legacyPushSql);
const legacyPendingNorm=normalize(legacyPendingSql);
const safeNorm=normalize(safeSql);

const legacyPushSignatures=[
  'public.get_drinks_push_eligibility_summary_v660(text,integer)',
  'public.get_drinks_push_phase_summary_v660(text,integer)',
  'public._gejast_v660_recent_rows(text,integer)'
];
const legacyPendingSignatures=[
  'public.get_drinks_pending_verification_summary_v660(text,integer)'
];
for(const sig of legacyPushSignatures) {
  if(!legacyPushNorm.includes(`revoke execute on function ${sig} from public, anon, authenticated;`)) fail(`legacy PUBLIC/client revoke missing for ${sig}`);
  if(!legacyPushNorm.includes(`grant execute on function ${sig} to service_role;`)) fail(`legacy service_role grant missing for ${sig}`);
}
for(const sig of legacyPendingSignatures) {
  if(!legacyPendingNorm.includes(`revoke execute on function ${sig} from public, anon, authenticated;`)) fail(`legacy pending PUBLIC/client revoke missing for ${sig}`);
  if(!legacyPendingNorm.includes(`grant execute on function ${sig} to service_role;`)) fail(`legacy pending service_role grant missing for ${sig}`);
}

const legacyJoined=normalize(`${legacyPushSql}\n${legacyPendingSql}`);
for(const sig of [...legacyPushSignatures,...legacyPendingSignatures]) {
  if(legacyJoined.includes(`grant execute on function ${sig} to anon`)) fail(`legacy anon execute was reintroduced for ${sig}`);
  if(legacyJoined.includes(`grant execute on function ${sig} to authenticated`)) fail(`legacy authenticated execute was reintroduced for ${sig}`);
}

const safeSignatures=[
  'public.get_drinks_push_phase_summary_v661(integer,text)',
  'public.get_drinks_pending_verification_summary_v661(integer,text)',
  'public.get_drinks_push_eligibility_summary_v661(integer,text)',
  'public.admin_get_drinks_push_audit_v661(text)'
];
for(const sig of safeSignatures) {
  if(!safeNorm.includes(`revoke all on function ${sig} from public;`)) fail(`safe v661 generic PUBLIC revoke missing for ${sig}`);
  if(!safeNorm.includes(`grant execute on function ${sig} to anon, authenticated, service_role;`)) fail(`safe v661 explicit role grant missing for ${sig}`);
}

const createCount=(safeSql.match(/\bcreate\s+or\s+replace\s+function\b/gi)||[]).length;
const securityDefinerCount=(safeSql.match(/\bsecurity\s+definer\b/gi)||[]).length;
const searchPathCount=(safeSql.match(/\bset\s+search_path\s+to\s+'public'/gi)||[]).length;
if(createCount!==4) fail(`expected 4 safe v661 function definitions, got ${createCount}`);
if(securityDefinerCount!==4) fail(`expected 4 SECURITY DEFINER declarations, got ${securityDefinerCount}`);
if(searchPathCount!==4) fail(`expected 4 fixed public search_path declarations, got ${searchPathCount}`);

for(const forbidden of [
  '_gejast_v660_recent_rows',
  'get_drinks_push_phase_summary_v660',
  'get_drinks_push_eligibility_summary_v660',
  'get_drinks_pending_verification_summary_v660'
]) {
  if(safeNorm.includes(forbidden)) fail(`safe v661 migration delegates to legacy raw-row path: ${forbidden}`);
}
if(/\bselect\s+\*/i.test(safeSql)) fail('safe v661 migration contains SELECT *');
if(/\brow_to_json\s*\(/i.test(safeSql)) fail('safe v661 migration contains row_to_json');
if(/\bto_jsonb\s*\(/i.test(safeSql)) fail('safe v661 migration contains to_jsonb row serialization');

for(const required of [
  "'version', 'v661-safe'",
  "'source', 'aggregate_only_no_subscription_secrets'",
  "'sensitive_rows_redacted', true",
  "'push_rows', '[]'::jsonb",
  "'presence_rows', '[]'::jsonb",
  "'recent_requests', '[]'::jsonb"
]) {
  if(!safeNorm.includes(normalize(required))) fail(`safe diagnostic invariant missing: ${required}`);
}

for(const [name,sql] of [[legacyPushFile,legacyPushSql],[legacyPendingFile,legacyPendingSql],[safeV661File,safeSql]]) {
  if(/\balter\s+role\b/i.test(sql)) fail(`${name} must not alter roles`);
  if(/\bstatement_timeout\b/i.test(sql)) fail(`${name} must not change statement_timeout`);
}

if(acceptance.status!=='PASS') fail('v813 acceptance status changed from PASS');
if(acceptance.evidence_baseline_main_sha!=='570ef4bded55493a226d1fc7c8afbb1e35244f56') fail('certified product SHA changed');
if(acceptance.certified_release_branch!=='release/v813-certified-20260825') fail('frozen certified branch changed');
const provenance=acceptance.post_certification_web_push_rpc_security;
if(!provenance) fail('web push RPC post-certification provenance metadata missing');
if(provenance.certified_product_sha_unchanged!==true || provenance.certified_product_sha!==acceptance.evidence_baseline_main_sha) fail('web push provenance does not preserve certified product SHA');
if(provenance.migrations_reapplied!==false) fail('web push provenance must record migrations were not reapplied');
if(provenance.live_contract_verified!==true) fail('web push live contract verification not recorded');
if(provenance.legacy_v660_execute!=='service_role_only') fail('legacy v660 service-only contract missing');
if(provenance.safe_v661_execute!=='anon_authenticated_service_role_explicit_only') fail('safe v661 explicit execute contract missing');
if(provenance.safe_v661_raw_subscription_rows_returned!==false) fail('safe v661 raw-row redaction contract missing');

const expectedMigrations=[
  ['20260829223803','lock_legacy_drinks_push_summary_rpc_exposure_20260830',legacyPushFile],
  ['20260829224000','lock_legacy_drinks_pending_summary_rpc_exposure_20260830',legacyPendingFile],
  ['20260829231158','restore_safe_drinks_push_v661_diagnostics',safeV661File]
];
if(!Array.isArray(provenance.migrations) || provenance.migrations.length!==expectedMigrations.length) fail('web push provenance migration list mismatch');
for(const [version,name,source_file] of expectedMigrations) {
  const row=provenance.migrations.find((item)=>item.version===version);
  if(!row || row.name!==name || row.source_file!==source_file) fail(`web push provenance mismatch for ${version}`);
}
if(provenance.latest_production_migration?.version!=='20260829231158' || provenance.latest_production_migration?.name!=='restore_safe_drinks_push_v661_diagnostics') fail('web push latest production migration mismatch');
if(acceptance.production_state?.latest_migration_version!=='20260829231158' || acceptance.production_state?.latest_migration_name!=='restore_safe_drinks_push_v661_diagnostics') fail('production_state latest migration is stale');

console.log('RESULT=V813_POST_CERT_WEB_PUSH_RPC_HARDENING_PASS');
