import fs from 'node:fs';
import path from 'node:path';

const fail = (message) => {
  console.error(`FAIL ${message}`);
  process.exit(1);
};

if (fs.readFileSync('VERSION', 'utf8').trim() !== 'v812') {
  fail('v812f is SQL-only and must not change the frontend VERSION');
}

const sql = fs.readFileSync('GEJAST_v812f_direct_data_boundary.sql', 'utf8').toLowerCase();
for (const needle of [
  'revoke insert, update, delete, truncate on all tables in schema public from public, anon, authenticated',
  'alter default privileges in schema public revoke insert, update, delete, truncate on tables from public, anon, authenticated',
  'revoke usage, select, update on all sequences in schema public from public, anon, authenticated',
  '_web_push_apply_action(text,bigint,text,bigint)',
  "p.proname like 'admin\\_%'",
  "p.proname not in ('admin_login','admin_get_paardenrace_overview_v667')",
  'claim_web_push_jobs(integer)',
  'consume_web_push_action_v3(uuid)',
  'enqueue_email_job(text,jsonb)',
  'queue_activation_email(text,text)',
  'queue_nearby_verification_pushes_v3(text,bigint,integer)',
  'despimarkt_finalize_caute_mint_from_verified_drink(bigint)',
  'despimarkt_finalize_debt_clear_from_verified_drink(bigint)',
  'validate_outbound_email_job_public(bigint,boolean)'
]) {
  if (!sql.includes(needle)) fail(`migration contract missing: ${needle}`);
}
if (sql.includes("where n.nspname = 'public' and p.proname like '\\_%'")) {
  fail('v812f must not globally revoke underscore read helpers; rollback rehearsal proved invoker RPC compatibility depends on them');
}

const provenance = JSON.parse(fs.readFileSync('production-migrations-v813.json', 'utf8'));
if (!Array.isArray(provenance.already_applied_production_migrations) || provenance.already_applied_production_migrations.length !== 20) {
  fail('production v813 migration provenance must contain all 20 observed migrations');
}
if (provenance.prepared_not_deployed !== 'GEJAST_v812f_direct_data_boundary.sql') {
  fail('migration provenance does not identify the prepared v812f boundary');
}

// Shipped browser code may retain bounded read-only table fallbacks, but no direct table
// mutation owner is allowed before client DML is globally revoked.
const skippedDirs = new Set(['.git', 'node_modules', 'scripts', 'cloudflare', '.github', 'archive', 'archives', 'backup', 'backups', 'repo', 'mnt']);
const files = [];
function walk(dir = '.') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirs.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    const rel = path.join(dir, entry.name).replaceAll('\\', '/').replace(/^\.\//, '');
    if (!/\.(?:html|m?js)$/i.test(rel)) continue;
    if (/^(?:check|fix)-/i.test(entry.name)) continue;
    files.push(rel);
  }
}
walk();

const violations = [];
let directReadFallbacks = 0;
for (const rel of files) {
  const text = fs.readFileSync(rel, 'utf8');
  for (const match of text.matchAll(/\/rest\/v1\/(?!rpc\/)/gi)) {
    const nearby = text.slice(match.index, Math.min(text.length, match.index + 700));
    if (/method\s*:\s*['"](?:post|put|patch|delete)['"]/i.test(nearby)) {
      violations.push(`${rel}: direct PostgREST table mutation at offset ${match.index}`);
    } else {
      directReadFallbacks += 1;
    }
  }
  if (/\.from\s*\([^)]*\)\s*\.\s*(?:insert|update|delete|upsert)\s*\(/i.test(text)) {
    violations.push(`${rel}: direct Supabase table mutation`);
  }
}
if (violations.length) fail(`active browser direct-table mutation owners found:\n${violations.join('\n')}`);

console.log(`ACTIVE_BROWSER_FILES_SCANNED=${files.length}`);
console.log(`DIRECT_READ_FALLBACKS=${directReadFallbacks}`);
console.log('RESULT=V812F_DIRECT_DATA_BOUNDARY_PASS');
