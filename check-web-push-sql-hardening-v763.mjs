import { readFileSync } from 'node:fs';

const sql = readFileSync('GEJAST_v755j_targeted_push_security_hardening.sql', 'utf8');

function assertIncludes(fragment, label) {
  if (!sql.includes(fragment)) {
    throw new Error(`Missing SQL hardening fragment: ${label}`);
  }
}

function assertMatches(pattern, label) {
  if (!pattern.test(sql)) {
    throw new Error(`Missing SQL hardening pattern: ${label}`);
  }
}

assertIncludes("revoke all on function public.claim_web_push_jobs_targeted_v763(bigint, integer, text, uuid) from public, anon, authenticated;", 'targeted claim revoked from public/anon/authenticated');
assertIncludes("revoke all on function public.mark_web_push_job_sent_v763(bigint, uuid, text, text) from public, anon, authenticated;", 'mark sent revoked from public/anon/authenticated');
assertIncludes("revoke all on function public.mark_web_push_job_failed_v763(bigint, uuid, text, text, text, text, boolean) from public, anon, authenticated;", 'mark failed revoked from public/anon/authenticated');
assertIncludes("revoke all on function public.requeue_web_push_job_dry_run_v763(bigint, uuid, text) from public, anon, authenticated;", 'dry-run requeue revoked from public/anon/authenticated');

assertIncludes("grant execute on function public.claim_web_push_jobs_targeted_v763(bigint, integer, text, uuid) to service_role;", 'targeted claim service_role grant');
assertIncludes("grant execute on function public.mark_web_push_job_sent_v763(bigint, uuid, text, text) to service_role;", 'mark sent service_role grant');
assertIncludes("grant execute on function public.mark_web_push_job_failed_v763(bigint, uuid, text, text, text, text, boolean) to service_role;", 'mark failed service_role grant');
assertIncludes("grant execute on function public.requeue_web_push_job_dry_run_v763(bigint, uuid, text) to service_role;", 'dry-run requeue service_role grant');

assertIncludes("revoke all on function public.admin_queue_targeted_web_push_test_v763(text, bigint, text, text, text, text, boolean) from public;", 'admin queue public revoke');
assertIncludes("grant execute on function public.admin_queue_targeted_web_push_test_v763(text, bigint, text, text, text, text, boolean) to anon, authenticated, service_role;", 'admin queue callable roles only');

assertMatches(/where\s+j\.status\s+=\s+'queued'[\s\S]*?and\s+j\.target_subscription_id\s+=\s+target_subscription_id_input[\s\S]*?and\s+j\.trigger_kind\s+=\s+'admin_targeted_test'/, 'targeted claim only claims explicit admin_targeted_test jobs');
assertMatches(/create or replace function public\.claim_web_push_jobs_v2[\s\S]*?where\s+j\.status\s+=\s+'queued'[\s\S]*?coalesce\(j\.trigger_kind, ''\)\s+<>\s+'admin_targeted_test'/, 'scheduled claim excludes admin_targeted_test');
assertMatches(/select\s+count\(\*\)\s+into\s+v_open_count[\s\S]*?trigger_kind\s+=\s+'admin_targeted_test'[\s\S]*?status\s+in\s+\('queued',\s*'claimed'\)[\s\S]*?ADMIN_TARGETED_TEST_ALREADY_OPEN/, 'duplicate open admin targeted jobs rejected');
assertMatches(/if\s+dry_run\s+then[\s\S]*?'dry_run',\s+true[\s\S]*?'queued_count',\s+0[\s\S]*?end if;/, 'dry_run=true creates zero queued rows');
assertMatches(/'dry_run',\s+false[\s\S]*?'queued_count',\s+1[\s\S]*?'job_id',\s+v_job_id[\s\S]*?'trigger_kind',\s+'admin_targeted_test'[\s\S]*?'status',\s+'queued'/, 'dry_run=false returns durable queued job metadata');

console.log('web push SQL hardening static checks passed');
