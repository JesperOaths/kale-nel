#!/usr/bin/env node
import fs from 'node:fs';

const tracker = JSON.parse(fs.readFileSync('gameplay-acceptance.json', 'utf8'));
const provenance = JSON.parse(fs.readFileSync('backend-rpc-provenance.json', 'utf8'));
const html = fs.readFileSync('paardenrace.html', 'utf8');
const failures = [];

const game = (tracker.games || []).find((row) => row?.id === 'paardenrace');
const contract = game?.player_contract || {};
const evidence = contract.minimum_evidence || {};
const expectedIdentity = 'room_code_input text, session_token text, session_token_input text, site_scope_input text';
const rpc = (provenance.rpcs || []).find((row) => row?.name === 'start_paardenrace_room_safe' && row?.identity_arguments === expectedIdentity);

if (contract.minimum !== 2 || contract.minimum_status !== 'grounded') failures.push('Paardenrace minimum must remain grounded at 2');
if (contract.maximum !== null || contract.maximum_status !== 'not_yet_proven') failures.push('Paardenrace maximum must remain explicitly unknown');
if (contract.supported_player_counts_status !== 'minimum_grounded_maximum_unknown') failures.push('Paardenrace range status must preserve grounded minimum / unknown maximum');
if (contract.authority !== 'checked_in_backend_start_rpc_plus_shipped_frontend_plus_controlled_live_smoke') failures.push('Paardenrace authority must remain backend + shipped frontend + controlled live smoke');

if (!rpc) {
  failures.push('exact start_paardenrace_room_safe provenance entry is missing');
} else {
  const authorityPath = String(rpc?.repository_authority?.path || '').replaceAll('\\', '/');
  if (rpc?.repository_authority?.status !== 'checked_in' || !authorityPath) failures.push('exact Paardenrace start RPC must retain checked-in source authority');
  if (evidence.rpc !== 'start_paardenrace_room_safe' || evidence.identity_arguments !== expectedIdentity) failures.push('Paardenrace minimum evidence must identify the exact deployed start RPC');
  if (evidence.repository_authority_path !== authorityPath || contract.source !== authorityPath) failures.push('Paardenrace tracker source must match exact RPC provenance authority');
  if (evidence.observed_production_definition_md5 !== rpc?.observed_production?.definition_md5) failures.push('Paardenrace minimum evidence must remain tied to the observed production definition fingerprint');

  if (authorityPath && fs.existsSync(authorityPath)) {
    const sql = fs.readFileSync(authorityPath, 'utf8');
    if (!/create\s+or\s+replace\s+function\s+public\.start_paardenrace_room_safe\s*\(/i.test(sql)) failures.push('Paardenrace authority path must define start_paardenrace_room_safe');
    if (!/if\s+v_player_count\s*<\s*2\s+then\s+raise\s+exception\s+'Paardenrace kan niet starten met minder dan 2 spelers\.'/i.test(sql)) failures.push('Paardenrace authoritative backend start guard must preserve the fewer-than-two rejection');
  } else if (authorityPath) {
    failures.push(`Paardenrace authority path does not exist: ${authorityPath}`);
  }
}

if (!/players\.length\s*<\s*2/.test(html)) failures.push('shipped Paardenrace lobby must keep the two-player start-button guard');
if (!/readyTotal\s*<\s*2/.test(html)) failures.push('shipped Paardenrace click path must keep the two-ready-player guard');
if (!/kan niet starten met minder dan 2 spelers/i.test(html)) failures.push('shipped Paardenrace lobby must preserve its two-player rejection copy');
if (!/minimum at 2/i.test(String(game?.remaining_gap || '')) || !/maximum human room size/i.test(String(game?.remaining_gap || ''))) failures.push('Paardenrace gap must distinguish grounded minimum from unknown maximum');

if (failures.length) {
  console.error(`Paardenrace backend minimum evidence failed for ${failures.length} item(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Paardenrace backend minimum evidence PASS: exact checked-in/deployed start RPC and shipped frontend agree on minimum 2; maximum remains unclaimed.');
