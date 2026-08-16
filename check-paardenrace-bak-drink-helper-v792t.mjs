#!/usr/bin/env node
import fs from 'node:fs';

const sql = fs.readFileSync('GEJAST_v792t_paardenrace_bak_drink_helper.sql', 'utf8');

function fail(message) {
  console.error(`Paardenrace v792t Bak/drink invariant failed: ${message}`);
  process.exit(1);
}
function need(needle, label = needle) {
  if (!sql.includes(needle)) fail(`missing ${label}`);
}
function reject(needle, label = needle) {
  if (sql.includes(needle)) fail(`historical/broken marker remains: ${label}`);
}

for (const needle of [
  'CREATE OR REPLACE FUNCTION public._gejast_create_bak_drink_request_v695(',
  "source_kind_input text DEFAULT 'paardenrace'::text",
  'source_ref_input text DEFAULT NULL::text',
  "metadata_input jsonb DEFAULT '{}'::jsonb",
  'SECURITY DEFINER',
  'p.display_name',
  'p.profile_display_name',
  'p.chosen_username',
  'public._scope_norm(p.site_scope)',
  "RAISE EXCEPTION 'Speler voor Bak-verzoek niet gevonden.'",
  'v_client_event_id := coalesce(',
  'source_ref_input',
  'INSERT INTO public.drink_events(',
  'client_event_id,',
  'player_id,',
  'event_type_id,',
  'event_type_key,',
  'event_type_label,',
  'site_scope,',
  'raw_payload,',
  'metadata,',
  'WHEN unique_violation THEN',
]) need(needle);

reject("coalesce(display_name,name,email,''", 'removed players.name/email dynamic lookup');
reject("execute 'select id from public.players", 'dynamic player-id lookup');

console.log('Paardenrace v792t Bak/drink helper invariant ok.');
