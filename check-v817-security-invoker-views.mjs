import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20260926075000_safe_security_invoker_views_v817.sql','utf8');
const views=[
  'despimarkt_player_market_positions_view',
  'despimarkt_recent_bets_view',
  'klaverjas_match_player_rows',
  'klaverjas_online_kruip_stats',
  'klaverjas_player_stats_v',
];
for(const view of views){
  assert.match(
    sql,
    new RegExp('alter\\s+view\\s+public\\.'+view+'\\s+set\\s*\\(security_invoker\\s*=\\s*true\\)','i'),
    view+' must execute with caller privileges',
  );
}
console.log('v817 safe security-invoker view hardening PASS: '+views.length+' views.');
