#!/usr/bin/env node
import fs from 'node:fs';

const searchPathFile='GEJAST_20260825203001_harden_admin_drinks_security_definer_search_path.sql';
const aclFile='GEJAST_20260825203049_restrict_admin_drinks_rpc_execute_public.sql';
const acceptanceFile='final-acceptance-v813.json';
for(const path of [searchPathFile,aclFile,acceptanceFile]) {
  if(!fs.existsSync(path)) throw new Error(`V813_POST_CERT_DB_PROVENANCE_FAIL missing ${path}`);
}

const searchSql=fs.readFileSync(searchPathFile,'utf8');
const aclSql=fs.readFileSync(aclFile,'utf8');
const acceptance=JSON.parse(fs.readFileSync(acceptanceFile,'utf8'));
const fail=(message)=>{throw new Error(`V813_POST_CERT_DB_PROVENANCE_FAIL ${message}`);};

const signatures=[
  'public.admin_activate_release(text, text)',
  'public.admin_list_allowed_emails(text)',
  'public.admin_list_invites(text)',
  'public.admin_set_allowed_email(text, text, boolean, text)',
  'public.admin_set_invite_email(text, text, boolean)',
  'public.admin_set_player_banned(text, bigint, boolean, text)',
  'public.admin_set_release_channel(text, text, text)',
  'public.admin_set_reuse_expected_domain(text, text, text)',
  'public.admin_set_reuse_expected_origin(text, text, text)',
  'public.admin_upsert_release(text, text, text, text, text)',
  'public.admin_upsert_release_manifest(text, text, text, text, text, boolean)',
  'public.admin_revoke_player_access(text, bigint, text)',
  'public.admin_resolve_player_access(text, bigint, text)',
  'public.admin_create_player(text, text, text, text, text, text)',
  'public.admin_create_drink(text, text, numeric, numeric, integer)',
  'public.admin_update_drink(text, bigint, text, numeric, numeric, integer, boolean)',
  'public.admin_delete_drink(text, bigint)',
  'public.admin_settings_list_drinks(text)',
  'public.get_ingame_drinks_v1()',
  'public.admin_reset_game_stats4035(text, text)'
];

const alterCount=(searchSql.match(/\bALTER\s+FUNCTION\b/gi)||[]).length;
const revokeCount=(aclSql.match(/\bREVOKE\s+EXECUTE\s+ON\s+FUNCTION\b/gi)||[]).length;
const grantCount=(aclSql.match(/\bGRANT\s+EXECUTE\s+ON\s+FUNCTION\b/gi)||[]).length;
if(alterCount!==signatures.length) fail(`expected ${signatures.length} ALTER FUNCTION statements, got ${alterCount}`);
if(revokeCount!==signatures.length) fail(`expected ${signatures.length} REVOKE statements, got ${revokeCount}`);
if(grantCount!==signatures.length) fail(`expected ${signatures.length} GRANT statements, got ${grantCount}`);

for(const sig of signatures) {
  const escaped=sig.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const searchPattern=new RegExp(`ALTER\\s+FUNCTION\\s+${escaped}\\s+SET\\s+search_path\\s*=\\s*public\\s*;`,'i');
  const revokePattern=new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${escaped}\\s+FROM\\s+PUBLIC\\s*;`,'i');
  const grantPattern=new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${escaped}\\s+TO\\s+anon\\s*,\\s*authenticated\\s*,\\s*service_role\\s*;`,'i');
  if(!searchPattern.test(searchSql)) fail(`fixed search_path statement missing for ${sig}`);
  if(!revokePattern.test(aclSql)) fail(`PUBLIC revoke missing for ${sig}`);
  if(!grantPattern.test(aclSql)) fail(`explicit role grant missing for ${sig}`);
}

for(const [name,sql] of [[searchPathFile,searchSql],[aclFile,aclSql]]) {
  if(/\bALTER\s+ROLE\b/i.test(sql)) fail(`${name} must not alter roles`);
  if(/\bstatement_timeout\b/i.test(sql)) fail(`${name} must not change statement_timeout`);
}

if(acceptance.status!=='PASS') fail('v813 acceptance status changed from PASS');
if(acceptance.evidence_baseline_main_sha!=='570ef4bded55493a226d1fc7c8afbb1e35244f56') fail('certified product SHA changed');
if(acceptance.certified_release_branch!=='release/v813-certified-20260825') fail('frozen certified branch changed');
if(acceptance.authoritative_runs?.exact_main_live_browser?.run_id!==32830627407) fail('original authoritative browser run evidence changed');
if(acceptance.production_migration?.version!=='20260825063031' || acceptance.production_migration?.name!=='v813i_read_path_timeout_hardening') fail('historic certification-baseline migration evidence changed');
if(acceptance.production_migration?.record_scope!=='certification_baseline_at_authoritative_run') fail('historic production_migration scope is not explicit');

const provenance=acceptance.post_certification_database_provenance;
if(!provenance) fail('post-certification database provenance metadata missing');
if(provenance.certified_product_sha_unchanged!==true || provenance.certified_product_sha!==acceptance.evidence_baseline_main_sha) fail('provenance does not pin unchanged certified product SHA');
if(provenance.frozen_branch!==acceptance.certified_release_branch) fail('provenance frozen branch mismatch');
if(provenance.migrations_reapplied!==false) fail('provenance must record that migrations were not reapplied');
if(provenance.live_contract_verified!==true) fail('live contract verification not recorded');
if(provenance.expected_contract?.security_definer_search_path!=='public') fail('search_path contract missing');
if(provenance.expected_contract?.public_execute!=='revoked') fail('PUBLIC execute revocation contract missing');
if(JSON.stringify(provenance.expected_contract?.explicit_execute_roles)!==JSON.stringify(['anon','authenticated','service_role'])) fail('explicit execute-role contract mismatch');
if(provenance.expected_contract?.statement_timeout_changed!==false) fail('timeout non-change contract missing');

const expectedMigrations=[
  ['20260825203001','harden_admin_drinks_security_definer_search_path_20260825',searchPathFile],
  ['20260825203049','restrict_admin_drinks_rpc_execute_public_20260825',aclFile]
];
if(!Array.isArray(provenance.migrations) || provenance.migrations.length!==expectedMigrations.length) fail('provenance migration list mismatch');
for(const [version,name,source_file] of expectedMigrations) {
  const row=provenance.migrations.find((item)=>item.version===version);
  if(!row || row.name!==name || row.source_file!==source_file) fail(`provenance mismatch for ${version}`);
}
if(provenance.latest_production_migration?.version!=='20260825203049' || provenance.latest_production_migration?.name!=='restrict_admin_drinks_rpc_execute_public_20260825') fail('latest production migration provenance mismatch');
if(acceptance.production_state?.latest_migration_version!=='20260825203049' || acceptance.production_state?.latest_migration_name!=='restrict_admin_drinks_rpc_execute_public_20260825') fail('production_state latest migration is stale');

console.log('RESULT=V813_POST_CERT_ADMIN_DRINKS_HARDENING_PASS');
