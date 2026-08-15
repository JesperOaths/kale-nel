-- Backend source reconstruction only.
--
-- These definitions were recovered from read-only PostgreSQL catalog inspection of the
-- deployed jas-site database on 2026-08-15. This file is deliberately NOT named
-- GEJAST_v7*_*.sql, so the manual apply-repair-sql workflow refuses it. It is source
-- authority / reproducibility material, not an instruction to apply SQL to production.
--
-- Exact deployed identities and production fingerprints are tracked in
-- backend-rpc-provenance.json and independently compiled/checked in PostgreSQL 17.6 CI.

CREATE OR REPLACE FUNCTION public.get_paardenrace_stats_fast_v687(site_scope_input text DEFAULT 'friends'::text, limit_input integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'version','v687a',
    'site_scope', public._gejast_v687a_scope_norm(site_scope_input),
    'leaderboard','[]'::jsonb,
    'recent','[]'::jsonb
  );
$function$;

CREATE OR REPLACE FUNCTION public.update_paardenrace_room_choice_safe(session_token text DEFAULT NULL::text, session_token_input text DEFAULT NULL::text, room_code_input text DEFAULT NULL::text, selected_suit_input text DEFAULT NULL::text, wager_bakken_input integer DEFAULT NULL::integer, ready_input boolean DEFAULT false, site_scope_input text DEFAULT 'friends'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text := public._paardenrace_require_name(session_token, session_token_input);
  v_player_id bigint := public._paardenrace_player_id(session_token, session_token_input);
  v_room public.paardenrace_rooms%rowtype;
  v_suit text := lower(trim(coalesce(selected_suit_input,'')));
  v_wager integer := coalesce(wager_bakken_input, 0);
begin
  select * into v_room
    from public.paardenrace_rooms
   where upper(coalesce(room_code,'')) = upper(trim(coalesce(room_code_input,'')))
   order by updated_at desc nulls last, id desc
   limit 1
   for update;

  if v_room.id is null then raise exception 'Room niet gevonden.'; end if;
  if coalesce(v_room.stage,'lobby') <> 'lobby' then raise exception 'Je kunt je inzet alleen in de lobby aanpassen.'; end if;
  if v_suit not in ('hearts','diamonds','clubs','spades') then raise exception 'Kies eerst een paard/suit.'; end if;
  if v_wager <= 0 then raise exception 'Vul eerst een inzet in Bakken in.'; end if;

  perform public._paardenrace_upsert_player(v_room.id, v_name, v_player_id);

  update public.paardenrace_room_players rp
     set selected_suit = v_suit,
         wager_bakken = v_wager,
         wager_verified = false,
         wager_saved_at = now(),
         is_ready = false,
         updated_at = now()
   where rp.room_id = v_room.id
     and lower(coalesce(rp.player_name,'')) = lower(coalesce(v_name,''));

  update public.paardenrace_rooms set updated_at = now() where id = v_room.id;
  return public._paardenrace_build_room_state(v_room.room_code, session_token, session_token_input);
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_paardenrace_wager_safe(session_token text DEFAULT NULL::text, session_token_input text DEFAULT NULL::text, room_code_input text DEFAULT NULL::text, target_player_name_input text DEFAULT NULL::text, site_scope_input text DEFAULT 'friends'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_host_name text := public._paardenrace_require_name(session_token, session_token_input);
  v_room public.paardenrace_rooms%rowtype;
  v_target text := nullif(trim(coalesce(target_player_name_input,'')), '');
begin
  select * into v_room
    from public.paardenrace_rooms
   where upper(coalesce(room_code,'')) = upper(trim(coalesce(room_code_input,'')))
   order by updated_at desc nulls last, id desc
   limit 1
   for update;
  if v_room.id is null then raise exception 'Room niet gevonden.'; end if;
  if lower(coalesce(v_room.host_name,'')) <> lower(coalesce(v_host_name,'')) then raise exception 'Alleen de host mag wagers verifiëren.'; end if;
  if v_target is null then v_target := v_host_name; end if;

  update public.paardenrace_room_players rp
     set wager_verified = true,
         is_ready = false,
         updated_at = now()
   where rp.room_id = v_room.id
     and lower(coalesce(rp.player_name,'')) = lower(v_target)
     and coalesce(rp.wager_bakken,0) > 0
     and nullif(trim(coalesce(rp.selected_suit,'')), '') is not null;
  if not found then raise exception 'Geen open wager gevonden voor deze speler.'; end if;

  update public.paardenrace_rooms set updated_at = now() where id = v_room.id;
  return public._paardenrace_build_room_state(v_room.room_code, session_token, session_token_input);
end;
$function$;
