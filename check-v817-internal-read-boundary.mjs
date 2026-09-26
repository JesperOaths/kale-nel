import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath='supabase/migrations/20260926070456_harden_internal_read_surfaces.sql';
const sql=fs.readFileSync(migrationPath,'utf8');

const tables=[
  'despimarkt_audit_log',
  'despimarkt_house_wallet_ledger',
  'despimarkt_caute_ledger',
  'despimarkt_drink_debts',
  'despimarkt_player_restrictions',
  'drink_suspicion_flags',
  'game_rating_rebuild_queue',
  'rating_rebuild_queue',
  'username_events',
  'ballroom_cycle_reset_guard',
  'despimarkt_market_settlements',
  'despimarkt_market_payouts',
  'despimarkt_drink_mint_requests',
  'despimarkt_announcement_reads',
  'despimarkt_market_watchers',
  'despimarkt_house_wallets',
  'despimarkt_caute_accounts',
  'despimarkt_nomination_drink_rules',
  'paardenrace_wager_verifications',
];

for(const table of tables){
  assert.match(
    sql,
    new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,'i'),
    table+' must keep RLS enabled',
  );
  assert.match(sql,new RegExp(`public\\.${table}\\b`,'i'),table+' must remain in the hardened relation set');
}

assert.match(
  sql,
  /revoke\s+select\s+on\s+table[\s\S]*from\s+anon\s*,\s*authenticated\s*;/i,
  'internal read surfaces must revoke browser-role SELECT',
);
assert.doesNotMatch(sql,/grant\s+select[\s\S]*(?:anon|authenticated)/i,'migration must not re-open direct browser SELECT');
assert.match(sql,/service_role and postgres ownership remain unchanged/i);

console.log('v817 internal read-boundary hardening regression PASS: '+tables.length+' internal tables are RLS-enabled and direct browser SELECT is revoked.');
