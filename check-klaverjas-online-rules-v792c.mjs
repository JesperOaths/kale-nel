import fs from 'node:fs';

const sql = fs.readFileSync('GEJAST_v792c_klaverjas_online_rules_guard.sql', 'utf8').toLowerCase();
const required = [
  '_klaverjas_online_card_strength',
  '_klaverjas_online_trick_winner',
  '_klaverjas_online_card_legal',
  '_klaverjas_online_roem_points',
  '_klaverjas_online_bid_valid',
  '_klaverjas_online_round_result',
  '_klaverjas_online_should_finish',
  "next_nonce <> stored_nonce",
  "stored_phase='bidding'",
  "stored_phase='playing'",
  'next_taken_len<>stored_taken_len+1',
  "appended_round -> 'result'<>expected_result",
  "stored_phase='finished' then return next_state=stored_state"
];
for (const needle of required) {
  if (!sql.includes(needle)) throw new Error(`v792c missing contract marker: ${needle}`);
}
for (const helper of [
  '_klaverjas_online_card_strength(jsonb,text,text)',
  '_klaverjas_online_trick_winner(jsonb,text)',
  '_klaverjas_online_card_legal(jsonb,jsonb,integer,text,jsonb)',
  '_klaverjas_online_roem_points(jsonb,text)',
  '_klaverjas_online_round_result(jsonb,jsonb,jsonb)',
  '_klaverjas_online_should_finish(jsonb)'
]) {
  if (!sql.includes(`revoke execute on function public.${helper} from public, anon, authenticated`)) {
    throw new Error(`v792c helper exposure regression: ${helper}`);
  }
}
console.log('Online Klaverjas v792c deterministic rules regression: PASS');
