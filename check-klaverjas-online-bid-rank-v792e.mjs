import fs from 'node:fs';
const sql=fs.readFileSync('GEJAST_v792e_klaverjas_online_bid_rank_guard.sql','utf8').toLowerCase();
for(const marker of [
  "if mode_text='suit' then return greatest(82,points)",
  "if mode_text='sans' then return points + 0.1",
  "kind_text='pit' and mode_text='sans' and points=132",
  "points%10<>0",
  "suit_text not in ('clubs','spades','hearts','diamonds')",
  "revoke execute on function public._klaverjas_online_bid_rank(jsonb) from public, anon, authenticated",
  "revoke execute on function public._klaverjas_online_bid_valid(jsonb,jsonb,integer) from public, anon, authenticated"
]) if(!sql.includes(marker)) throw new Error(`v792e missing bid parity guard: ${marker}`);
console.log('Online Klaverjas v792e bid-rank parity regression: PASS');
