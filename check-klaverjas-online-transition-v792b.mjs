import fs from 'node:fs';

const path = 'GEJAST_v792b_klaverjas_online_transition_guard.sql';
const sql = fs.readFileSync(path, 'utf8');
const lower = sql.toLowerCase();

const required = [
  'create or replace function public._klaverjas_online_full_deal_valid',
  'create or replace function public._klaverjas_online_human_transition_valid',
  'create or replace function public.klaverjas_online_save_state',
  "klaverjas_online_illegal_state_transition",
  "klaverjas_online_phase_invalid",
  "next_nonce <> stored_nonce",
  "public._klaverjas_online_full_deal_valid(next_state)",
  "stored_phase = 'lobby'",
  "viewer_seat = 0",
  "stored_phase = 'bidding'",
  "viewer_seat = stored_bidder",
  "stored_phase = 'roundover'",
  "stored_phase = 'playing'",
  "viewer_seat <> stored_turn",
  "jsonb_array_length(next_hand) <> jsonb_array_length(stored_hand) - 1",
  "not (stored_hand @> next_hand)",
  "last_play -> 'card' <> removed_card",
  "next_taken_len <> stored_taken_len + 1",
  "if not has_bots and not public._klaverjas_online_human_transition_valid",
  "revoke execute on function public._klaverjas_online_full_deal_valid(jsonb) from public, anon, authenticated",
  "revoke execute on function public._klaverjas_online_human_transition_valid(jsonb,jsonb,integer) from public, anon, authenticated",
  "revoke execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) from public",
  "grant execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) to anon, authenticated"
];

for (const needle of required) {
  if (!lower.includes(needle.toLowerCase())) {
    throw new Error(`v792b missing required transition guard: ${needle}`);
  }
}

const saveStart = lower.indexOf('create or replace function public.klaverjas_online_save_state');
const saveEnd = lower.indexOf('$function$;', saveStart);
const saveBody = lower.slice(saveStart, saveEnd > saveStart ? saveEnd : undefined);
const authAt = saveBody.indexOf('session_player := public._jas_session_player(session_token)');
const lockAt = saveBody.indexOf('for update');
const transitionAt = saveBody.indexOf('public._klaverjas_online_human_transition_valid');
const writeAt = saveBody.indexOf('update public.klaverjas_online_games');
if (authAt < 0 || lockAt < 0 || transitionAt < 0 || writeAt < 0) {
  throw new Error('v792b save RPC missing auth/lock/transition/write ordering anchors');
}
if (!(authAt < lockAt && lockAt < transitionAt && transitionAt < writeAt)) {
  throw new Error('v792b transition validation must run after auth+row lock and before game write');
}

const helperStart = lower.indexOf('create or replace function public._klaverjas_online_human_transition_valid');
const helperEnd = lower.indexOf('$function$;', helperStart);
const helper = lower.slice(helperStart, helperEnd > helperStart ? helperEnd : undefined);
for (const protectedField of ["'totals'", "'rounds'", "'hands'", "'taken'", "'trick'"]) {
  if (!helper.includes(protectedField)) throw new Error(`v792b helper does not constrain ${protectedField}`);
}

const dealStart = lower.indexOf('create or replace function public._klaverjas_online_full_deal_valid');
const dealEnd = lower.indexOf('$function$;', dealStart);
const deal = lower.slice(dealStart, dealEnd > dealStart ? dealEnd : undefined);
for (const invariant of ['jsonb_array_length(hands) <> 4', 'jsonb_array_length(hand_item) <> 8', 'card_id = any(seen_ids)', "array_length(seen_ids, 1) = 32"]) {
  if (!deal.includes(invariant)) throw new Error(`v792b full-deal validation missing: ${invariant}`);
}

const forbidden = [
  'grant execute on function public._klaverjas_online_human_transition_valid(jsonb,jsonb,integer) to anon',
  'grant execute on function public._klaverjas_online_full_deal_valid(jsonb) to anon',
  'grant update on table public.klaverjas_online_games',
  'disable row level security',
  'security invoker'
];
for (const needle of forbidden) {
  if (lower.includes(needle)) throw new Error(`v792b must not contain: ${needle}`);
}

console.log('Online Klaverjas v792b state-transition regression: PASS');
