import fs from 'node:fs';
const sql=fs.readFileSync('GEJAST_v792d_klaverjas_online_transition_compat.sql','utf8').toLowerCase();
for(const s of ['_klaverjas_online_human_transition_valid','_klaverjas_online_bid_valid','_klaverjas_online_card_legal','_klaverjas_online_round_result','roster mutation is intentionally not compared as raw json here']) if(!sql.includes(s)) throw new Error('missing '+s);
console.log('Online Klaverjas v792d compatibility regression: PASS');
