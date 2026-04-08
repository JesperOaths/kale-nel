begin;

create table if not exists public.admin_write_audit_log (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  admin_session_token_hash text not null,
  admin_username text,
  domain text not null,
  action_name text not null,
  site_scope text,
  payload jsonb not null default '{}'::jsonb,
  result_preview jsonb,
  page_hint text,
  created_at timestamptz not null default now(),
  constraint admin_write_audit_log_domain_nonempty check (length(trim(domain)) > 0),
  constraint admin_write_audit_log_action_nonempty check (length(trim(action_name)) > 0)
);

create index if not exists idx_admin_write_audit_log_occurred_at
  on public.admin_write_audit_log(occurred_at desc);

create index if not exists idx_admin_write_audit_log_domain_action
  on public.admin_write_audit_log(domain, action_name, occurred_at desc);

create or replace function public._admin_scope_norm_v356(input_value text)
returns text
language sql
immutable
as $$
  select case when lower(trim(coalesce(input_value, 'friends'))) = 'family' then 'family' else 'friends' end
$$;

create or replace function public._admin_has_activation_evidence_v356(row_input jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(
    (row_input->>'has_pin')::boolean,
    (row_input->>'pin_is_set')::boolean,
    (row_input->>'player_has_pin')::boolean,
    (row_input->>'pin_set')::boolean,
    (row_input->>'pin_hash_set')::boolean,
    (row_input->>'pin_hash_present')::boolean,
    (row_input->>'has_pin_hash')::boolean,
    (row_input->>'player_pin_hash_set')::boolean,
    false
  )
  or coalesce(nullif(row_input->>'activated_at',''), '') <> ''
  or coalesce(nullif(row_input->>'activated_on',''), '') <> ''
  or coalesce(nullif(row_input->>'link_used_at',''), '') <> ''
  or coalesce(nullif(row_input->>'activation_used_at',''), '') <> ''
  or coalesce(nullif(row_input->>'player_activation_used_at',''), '') <> ''
  or coalesce(nullif(row_input->>'used_at',''), '') <> ''
  or coalesce(nullif(row_input->>'pin_hash',''), '') <> ''
  or coalesce(nullif(row_input->>'player_pin_hash',''), '') <> '';
$$;

create or replace function public._admin_parse_timestamptz_v356(value_input text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  if nullif(trim(coalesce(value_input, '')), '') is null then
    return null;
  end if;
  return value_input::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public._admin_claim_bucket_v356(row_input jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_state_bucket text := lower(trim(coalesce(row_input->>'state_bucket', '')));
  v_status text := lower(trim(coalesce(row_input->>'status', '')));
  v_request_status text := lower(trim(coalesce(row_input->>'request_status', '')));
  v_decision text := lower(trim(coalesce(row_input->>'decision', '')));
  v_has_pin boolean := public._admin_has_activation_evidence_v356(row_input);
  v_expires_at timestamptz := public._admin_parse_timestamptz_v356(row_input->>'expires_at');
  v_activation_expires_at timestamptz := public._admin_parse_timestamptz_v356(row_input->>'activation_expires_at');
  v_link_expires_at timestamptz := public._admin_parse_timestamptz_v356(row_input->>'link_expires_at');
begin
  if v_state_bucket like '%expired%' or v_status like '%expired%' or v_request_status like '%expired%' then
    return 'expired';
  end if;

  if not v_has_pin and (
    (v_expires_at is not null and v_expires_at <= now()) or
    (v_activation_expires_at is not null and v_activation_expires_at <= now()) or
    (v_link_expires_at is not null and v_link_expires_at <= now())
  ) then
    return 'expired';
  end if;

  if v_state_bucket like '%claimable%' or v_status like '%claimable%' or v_request_status like '%claimable%' then
    return 'rejected';
  end if;

  if v_state_bucket like '%revok%' or v_status like '%revok%' or v_request_status like '%revok%' or
     v_state_bucket like '%reject%' or v_status like '%reject%' or v_request_status like '%reject%' or
     v_decision in ('rejected','revoked') then
    return 'rejected';
  end if;

  if v_state_bucket like '%active%' or v_status like '%active%' or v_request_status like '%active%' or
     v_state_bucket like '%activated%' or v_status like '%activated%' or v_request_status like '%activated%' then
    return 'active';
  end if;

  if v_state_bucket like '%approved%' or v_status like '%approved%' or v_request_status like '%approved%' or
     v_state_bucket like '%await%' or v_status like '%await%' or v_request_status like '%await%' or
     v_state_bucket like '%pending_activation%' or v_status like '%pending_activation%' or v_request_status like '%pending_activation%' or
     v_state_bucket like '%waiting%' or v_status like '%waiting%' or v_request_status like '%waiting%' then
    return case when v_has_pin then 'active' else 'awaiting' end;
  end if;

  if v_has_pin then
    return 'active';
  end if;

  return 'pending';
end;
$$;

create or replace function public._admin_bucket_counts_v356(
  requests_input jsonb default '[]'::jsonb,
  history_input jsonb default '[]'::jsonb,
  expired_input jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_pending integer := 0;
  v_awaiting integer := 0;
  v_active integer := 0;
  v_rejected integer := 0;
  v_expired integer := 0;
  v_item jsonb;
begin
  for v_item in select value from jsonb_array_elements(coalesce(requests_input, '[]'::jsonb))
  loop
    if public._admin_claim_bucket_v356(v_item) = 'pending' then
      v_pending := v_pending + 1;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(history_input, '[]'::jsonb))
    union all
    select value from jsonb_array_elements(coalesce(expired_input, '[]'::jsonb))
  loop
    case public._admin_claim_bucket_v356(v_item)
      when 'awaiting' then v_awaiting := v_awaiting + 1;
      when 'active' then v_active := v_active + 1;
      when 'rejected' then v_rejected := v_rejected + 1;
      when 'expired' then v_expired := v_expired + 1;
      else null;
    end case;
  end loop;

  return jsonb_build_object(
    'pending', v_pending,
    'awaiting', v_awaiting,
    'active', v_active,
    'rejected', v_rejected,
    'expired', v_expired
  );
end;
$$;

create or replace function public._admin_require_session_v356(
  admin_session_token text,
  domain_input text default null,
  action_input text default null,
  payload_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session jsonb;
begin
  if nullif(trim(coalesce(admin_session_token, '')), '') is null then
    raise exception 'Geen adminsessie gevonden.';
  end if;

  begin
    v_session := to_jsonb(public.admin_check_session(admin_session_token));
  exception when others then
    raise exception 'Ongeldige adminsessie.';
  end;

  if v_session is null then
    raise exception 'Ongeldige adminsessie.';
  end if;

  return coalesce(v_session, '{}'::jsonb);
end;
$$;

create or replace function public._admin_log_write_v356(
  admin_session_token text,
  session_json jsonb,
  domain_input text,
  action_input text,
  payload_input jsonb default '{}'::jsonb,
  result_input jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._admin_scope_norm_v356(payload_input->>'site_scope_input');
begin
  insert into public.admin_write_audit_log(
    admin_session_token_hash,
    admin_username,
    domain,
    action_name,
    site_scope,
    payload,
    result_preview,
    page_hint
  )
  values (
    md5(coalesce(admin_session_token, '')),
    coalesce(session_json->>'admin_username', session_json->>'username'),
    domain_input,
    action_input,
    v_scope,
    coalesce(payload_input, '{}'::jsonb),
    jsonb_strip_nulls(jsonb_build_object(
      'ok', coalesce(result_input->'ok', 'true'::jsonb),
      'id', result_input->'id',
      'job_id', result_input->'job_id',
      'message', result_input->'message',
      'status', result_input->'status'
    )),
    payload_input->>'page_hint'
  );
end;
$$;

create or replace function public._admin_revoke_execute_by_name_v356(function_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  rec record;
begin
  for rec in
    select n.nspname as schema_name,
           p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = function_name
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from anon, authenticated',
      rec.schema_name,
      rec.function_name,
      rec.identity_args
    );
  end loop;
end;
$$;

create or replace function public.admin_secure_read_v356(
  admin_session_token text,
  domain text,
  payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_domain text := lower(trim(coalesce(domain, '')));
  v_scope text := public._admin_scope_norm_v356(payload->>'site_scope_input');
  v_result jsonb := '{}'::jsonb;
  v_requests jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_expired jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  perform public._admin_require_session_v356(admin_session_token, v_domain, 'read', payload);

  if v_domain = 'claims' then
    begin
      v_result := to_jsonb(public.admin_list_claim_requests_action(admin_session_token => admin_session_token));
    exception when others then
      v_result := to_jsonb(public.admin_get_claim_requests(admin_session_token => admin_session_token));
    end;
    v_requests := case
      when jsonb_typeof(v_result) = 'array' then v_result
      when jsonb_typeof(v_result) = 'object' and v_result ? 'items' then coalesce(v_result->'items', '[]'::jsonb)
      when jsonb_typeof(v_result) = 'object' and v_result ? 'requests' then coalesce(v_result->'requests', '[]'::jsonb)
      else '[]'::jsonb
    end;

    begin
      v_result := to_jsonb(public.admin_list_claim_history_action(admin_session_token => admin_session_token));
    exception when others then
      v_result := to_jsonb(public.admin_get_claim_history(admin_session_token => admin_session_token));
    end;
    v_history := case
      when jsonb_typeof(v_result) = 'array' then v_result
      when jsonb_typeof(v_result) = 'object' and v_result ? 'items' then coalesce(v_result->'items', '[]'::jsonb)
      when jsonb_typeof(v_result) = 'object' and v_result ? 'history' then coalesce(v_result->'history', '[]'::jsonb)
      else '[]'::jsonb
    end;

    begin
      v_result := to_jsonb(public.admin_list_expired_activation_queue_action(admin_session_token => admin_session_token));
    exception when others then
      begin
        v_result := to_jsonb(public.admin_get_expired_activation_queue(admin_session_token => admin_session_token));
      exception when others then
        v_result := jsonb_build_object('items', '[]'::jsonb);
      end;
    end;
    v_expired := case
      when jsonb_typeof(v_result) = 'array' then v_result
      when jsonb_typeof(v_result) = 'object' and v_result ? 'items' then coalesce(v_result->'items', '[]'::jsonb)
      else '[]'::jsonb
    end;

    return jsonb_build_object(
      'ok', true,
      'domain', v_domain,
      'requests', v_requests,
      'history', v_history,
      'expired_queue', v_expired,
      'counts', public._admin_bucket_counts_v356(v_requests, v_history, v_expired)
    );
  elsif v_domain = 'reserved_names' then
    v_result := to_jsonb(public.admin_get_allowed_usernames(admin_session_token => admin_session_token));
    v_items := case
      when jsonb_typeof(v_result) = 'array' then v_result
      when jsonb_typeof(v_result) = 'object' and v_result ? 'items' then coalesce(v_result->'items', '[]'::jsonb)
      else '[]'::jsonb
    end;
    return jsonb_build_object('ok', true, 'domain', v_domain, 'items', v_items, 'site_scope', v_scope);
  elsif v_domain = 'push' then
    v_result := to_jsonb(public.admin_get_active_web_push_presence(
      admin_session_token => admin_session_token,
      active_minutes => greatest(1, least(coalesce(nullif(payload->>'active_minutes','')::integer, 5), 60))
    ));

    if jsonb_typeof(v_result) = 'object' and v_result ? 'rows' then
      select coalesce(jsonb_agg(row_item), '[]'::jsonb)
      into v_items
      from jsonb_array_elements(coalesce(v_result->'rows', '[]'::jsonb)) row_item
      where nullif(row_item->>'player_name', '') is null
         or public._name_in_site_scope(row_item->>'player_name', v_scope);

      return jsonb_build_object(
        'ok', true,
        'domain', v_domain,
        'active_endpoints', coalesce(v_result->'active_endpoints', to_jsonb(jsonb_array_length(v_items))),
        'unique_players', coalesce(v_result->'unique_players', '0'::jsonb),
        'rows', v_items,
        'site_scope', v_scope
      );
    end if;

    return jsonb_build_object('ok', true, 'domain', v_domain, 'rows', '[]'::jsonb, 'site_scope', v_scope);
  elsif v_domain = 'mail' then
    return to_jsonb(public.admin_get_mail_diagnostics(admin_session_token => admin_session_token));
  elsif v_domain = 'analytics' then
    return to_jsonb(public.admin_get_site_analytics_action(
      admin_session_token => admin_session_token,
      range_days => greatest(1, least(coalesce(nullif(payload->>'range_days','')::integer, 7), 365)),
      recent_limit => greatest(1, least(coalesce(nullif(payload->>'recent_limit','')::integer, 80), 500))
    ));
  elsif v_domain = 'matches' then
    return to_jsonb(public.admin_get_match_edit_state_action(admin_session_token => admin_session_token));
  elsif v_domain = 'drinks' then
    return to_jsonb(public.get_drinks_admin_console(admin_session_token => admin_session_token));
  else
    raise exception 'Onbekend admin leesdomein: %', v_domain;
  end if;
end;
$$;

create or replace function public.admin_secure_write_v356(
  admin_session_token text,
  domain text,
  action text,
  payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_domain text := lower(trim(coalesce(domain, '')));
  v_action text := lower(trim(coalesce(action, '')));
  v_session jsonb;
  v_result jsonb := '{}'::jsonb;
  v_scope text := public._admin_scope_norm_v356(payload->>'site_scope_input');
  v_ids jsonb := coalesce(payload->'ids', '[]'::jsonb);
  v_id_text text;
begin
  v_session := public._admin_require_session_v356(admin_session_token, v_domain, v_action, payload);

  if v_domain = 'claims' then
    if v_action = 'decide' then
      v_result := to_jsonb(public.admin_decide_claim_request_action(
        admin_session_token => admin_session_token,
        request_id_input => payload->>'request_id_input',
        decision => payload->>'decision',
        decision_reason_input => nullif(payload->>'decision_reason_input', '')
      ));
    elsif v_action = 'approve_and_send_activation' then
      v_result := to_jsonb(public.admin_approve_and_send_activation_action(
        admin_session_token => admin_session_token,
        request_id_input => payload->>'request_id_input',
        decision_reason_input => nullif(payload->>'decision_reason_input', ''),
        base_url => payload->>'base_url'
      ));
    elsif v_action = 'requeue_expired_activation' then
      v_result := to_jsonb(public.admin_requeue_expired_activation_action(
        admin_session_token => admin_session_token,
        request_id_input => payload->>'request_id_input',
        base_url => payload->>'base_url'
      ));
    elsif v_action = 'resend_pending_activation' then
      v_result := to_jsonb(public.admin_resend_pending_activation_action(
        admin_session_token => admin_session_token,
        request_id_input => payload->>'request_id_input',
        base_url => payload->>'base_url'
      ));
    elsif v_action = 'return_name_to_claimable' then
      v_result := to_jsonb(public.admin_return_name_to_claimable_action(
        admin_session_token => admin_session_token,
        request_id_input => payload->>'request_id_input',
        decision_reason_input => nullif(payload->>'decision_reason_input', '')
      ));
    elsif v_action = 'create_activation_link' then
      v_result := to_jsonb(public.create_player_activation_link_action(
        admin_session_token => admin_session_token,
        request_id_input => payload->>'request_id_input',
        base_url => payload->>'base_url'
      ));
    elsif v_action = 'validate_outbound_email_job' then
      v_result := to_jsonb(public.admin_validate_outbound_email_job(
        admin_session_token => admin_session_token,
        job_id_input => nullif(payload->>'job_id_input', '')::bigint,
        mark_failed_input => coalesce((payload->>'mark_failed_input')::boolean, true)
      ));
    elsif v_action = 'revoke_player_access' then
      v_result := to_jsonb(public.admin_revoke_player_access_action(
        admin_session_token => admin_session_token,
        request_id_input => payload->>'request_id_input',
        decision_reason_input => nullif(payload->>'decision_reason_input', '')
      ));
    elsif v_action = 'remove_player' then
      v_result := to_jsonb(public.admin_remove_player_action(
        admin_session_token => admin_session_token,
        request_id_input => payload->>'request_id_input',
        decision_reason_input => nullif(payload->>'decision_reason_input', '')
      ));
    elsif v_action = 'queue_activation_email' then
      v_result := to_jsonb(public.admin_queue_activation_email(
        admin_session_token => admin_session_token,
        request_id_input => payload->>'request_id_input',
        base_url => payload->>'base_url',
        recipient_email_input => payload->>'recipient_email_input',
        recipient_name_input => nullif(payload->>'recipient_name_input', ''),
        activation_link_input => payload->>'activation_link_input',
        player_id_input => nullif(payload->>'player_id_input', '')::bigint
      ));
    elsif v_action = 'set_activation_email_subject' then
      v_result := to_jsonb(public.admin_set_activation_email_subject_action(
        admin_session_token => admin_session_token,
        request_id_input => payload->>'request_id_input',
        desired_subject => payload->>'desired_subject'
      ));
    else
      raise exception 'Onbekende claims admin actie: %', v_action;
    end if;
  elsif v_domain = 'reserved_names' then
    if v_action = 'reserve' then
      v_result := to_jsonb(public.admin_reserve_allowed_username(
        admin_session_token => admin_session_token,
        display_name_input => payload->>'display_name_input',
        reserved_for_email_input => nullif(payload->>'reserved_for_email_input', ''),
        reserved_for_person_note_input => nullif(payload->>'reserved_for_person_note_input', '')
      ));
    elsif v_action = 'remove' then
      begin
        execute 'select to_jsonb(public.admin_remove_allowed_username(admin_session_token => $1, allowed_username_id_input => $2))'
          into v_result
          using admin_session_token, nullif(payload->>'allowed_username_id_input', '')::bigint;
      exception when others then
        execute 'select to_jsonb(public.admin_remove_allowed_username(admin_session_token => $1, allowed_username_id => $2))'
          into v_result
          using admin_session_token, nullif(payload->>'allowed_username_id_input', '')::bigint;
      end;
    elsif v_action = 'set_ghost' then
      v_result := to_jsonb(public.admin_set_player_ghost_status(
        admin_session_token => admin_session_token,
        target_player_id => nullif(payload->>'target_player_id', '')::bigint,
        ghosted => coalesce((payload->>'ghosted')::boolean, false),
        reason_input => nullif(payload->>'reason_input', '')
      ));
    else
      raise exception 'Onbekende reserved_names admin actie: %', v_action;
    end if;
  elsif v_domain = 'push' then
    if v_action = 'queue' then
      v_result := to_jsonb(public.admin_queue_active_web_push(
        admin_session_token => admin_session_token,
        title_input => payload->>'title_input',
        body_input => payload->>'body_input',
        target_url_input => nullif(payload->>'target_url_input', ''),
        active_minutes => greatest(1, least(coalesce(nullif(payload->>'active_minutes','')::integer, 5), 60))
      ));
    elsif v_action = 'trust_device' then
      v_result := to_jsonb(public.admin_trust_device_action(
        admin_session_token => admin_session_token,
        admin_username => payload->>'admin_username',
        raw_device_token => payload->>'raw_device_token',
        trusted_meta_input => coalesce(payload->'trusted_meta_input', '{}'::jsonb),
        device_fingerprint => payload->>'device_fingerprint'
      ));
    elsif v_action = 'forget_device' then
      v_result := to_jsonb(public.admin_forget_device_action(
        admin_session_token => admin_session_token,
        raw_device_token => payload->>'raw_device_token'
      ));
    else
      raise exception 'Onbekende push admin actie: %', v_action;
    end if;
  elsif v_domain = 'matches' then
    if v_action = 'update_payload' then
      v_result := to_jsonb(public.admin_update_match_payload_action(
        admin_session_token => admin_session_token,
        game_type_input => payload->>'game_type_input',
        client_match_id_input => payload->>'client_match_id_input',
        replacement_payload => coalesce(payload->'replacement_payload', '{}'::jsonb)
      ));
    elsif v_action = 'replace_player' then
      v_result := to_jsonb(public.admin_replace_match_player_everywhere_action(
        admin_session_token => admin_session_token,
        game_type_input => payload->>'game_type_input',
        client_match_id_input => payload->>'client_match_id_input',
        old_player_name_input => payload->>'old_player_name_input',
        new_player_name_input => payload->>'new_player_name_input',
        old_player_id_input => nullif(payload->>'old_player_id_input', '')::bigint,
        new_player_id_input => nullif(payload->>'new_player_id_input', '')::bigint,
        site_scope_input => v_scope
      ));
    elsif v_action = 'delete_match' then
      v_result := to_jsonb(public.admin_delete_match_action(
        admin_session_token => admin_session_token,
        game_type_input => payload->>'game_type_input',
        client_match_id_input => payload->>'client_match_id_input'
      ));
    else
      raise exception 'Onbekende matches admin actie: %', v_action;
    end if;
  elsif v_domain = 'drinks' then
    if v_action = 'update_event' then
      v_result := to_jsonb(public.admin_update_drink_event_entry(
        admin_session_token => admin_session_token,
        drink_event_id => nullif(payload->>'drink_event_id', '')::bigint,
        next_status => payload->>'next_status'
      ));
    elsif v_action = 'delete_event' then
      v_result := to_jsonb(public.admin_delete_drink_event_entry(
        admin_session_token => admin_session_token,
        drink_event_id => nullif(payload->>'drink_event_id', '')::bigint
      ));
    elsif v_action = 'update_speed' then
      v_result := to_jsonb(public.admin_update_drink_speed_attempt_entry(
        admin_session_token => admin_session_token,
        attempt_id => nullif(payload->>'attempt_id', '')::bigint,
        next_status => payload->>'next_status'
      ));
    elsif v_action = 'delete_speed' then
      v_result := to_jsonb(public.admin_delete_drink_speed_attempt_entry(
        admin_session_token => admin_session_token,
        attempt_id => nullif(payload->>'attempt_id', '')::bigint
      ));
    elsif v_action = 'batch_update_events' then
      for v_id_text in select jsonb_array_elements_text(v_ids)
      loop
        perform public.admin_update_drink_event_entry(
          admin_session_token => admin_session_token,
          drink_event_id => v_id_text::bigint,
          next_status => payload->>'next_status'
        );
      end loop;
      v_result := jsonb_build_object('ok', true, 'updated_count', jsonb_array_length(v_ids));
    elsif v_action = 'batch_update_speed' then
      for v_id_text in select jsonb_array_elements_text(v_ids)
      loop
        perform public.admin_update_drink_speed_attempt_entry(
          admin_session_token => admin_session_token,
          attempt_id => v_id_text::bigint,
          next_status => payload->>'next_status'
        );
      end loop;
      v_result := jsonb_build_object('ok', true, 'updated_count', jsonb_array_length(v_ids));
    else
      raise exception 'Onbekende drinks admin actie: %', v_action;
    end if;
  else
    raise exception 'Onbekend admin schrijfdomein: %', v_domain;
  end if;

  perform public._admin_log_write_v356(admin_session_token, v_session, v_domain, v_action, payload, coalesce(v_result, '{}'::jsonb));
  return jsonb_build_object('ok', true, 'domain', v_domain, 'action', v_action, 'result', coalesce(v_result, '{}'::jsonb));
end;
$$;

do $$
declare
  v_names text[] := array[
    'admin_decide_claim_request_action',
    'admin_approve_and_send_activation_action',
    'admin_requeue_expired_activation_action',
    'admin_resend_pending_activation_action',
    'admin_return_name_to_claimable_action',
    'create_player_activation_link_action',
    'admin_validate_outbound_email_job',
    'admin_revoke_player_access_action',
    'admin_remove_player_action',
    'admin_queue_activation_email',
    'admin_set_activation_email_subject_action',
    'admin_reserve_allowed_username',
    'admin_remove_allowed_username',
    'admin_set_player_ghost_status',
    'admin_queue_active_web_push',
    'admin_trust_device_action',
    'admin_forget_device_action',
    'admin_update_match_payload_action',
    'admin_replace_match_player_everywhere_action',
    'admin_delete_match_action',
    'admin_update_drink_event_entry',
    'admin_delete_drink_event_entry',
    'admin_update_drink_speed_attempt_entry',
    'admin_delete_drink_speed_attempt_entry',
    'admin_batch_update_drink_event_entries',
    'admin_batch_update_drink_speed_attempt_entries',
    'admin_dev_login'
  ];
  v_name text;
begin
  foreach v_name in array v_names
  loop
    perform public._admin_revoke_execute_by_name_v356(v_name);
  end loop;
end $$;

grant execute on function public.admin_secure_read_v356(text, text, jsonb) to anon, authenticated;
grant execute on function public.admin_secure_write_v356(text, text, text, jsonb) to anon, authenticated;

commit;
