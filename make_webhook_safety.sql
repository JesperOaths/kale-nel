begin;

create or replace function public._email_job_validation_reasons_v638(row_data jsonb)
returns text[]
language plpgsql
stable
set search_path to 'public'
as $$
declare
  reasons text[] := array[]::text[];
  payload jsonb := coalesce(row_data->'payload','{}'::jsonb);
  email text := lower(btrim(coalesce(row_data->>'recipient_email', row_data->>'to_email', row_data->>'email', payload->>'recipient_email', payload->>'requester_email', payload->>'email', payload->>'to', '')));
  subject text := btrim(coalesce(row_data->>'subject', row_data->>'email_subject', payload->>'subject', payload->>'email_subject', ''));
  activation_url text := btrim(coalesce(payload->>'activation_url', payload->>'reset_url', payload->>'url', row_data->>'activation_url', row_data->>'reset_url', ''));
  template text := btrim(coalesce(payload->>'template', row_data->>'template', row_data->>'job_type', ''));
  bodyish text := btrim(coalesce(payload->>'html', payload->>'text', payload->>'body', row_data->>'html', row_data->>'text', row_data->>'body', ''));
  job_type text := lower(btrim(coalesce(row_data->>'job_type', payload->>'trigger', template, '')));
begin
  if email = '' then reasons := array_append(reasons, 'missing_recipient_email');
  elsif email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then reasons := array_append(reasons, 'invalid_recipient_email');
  end if;
  if subject = '' then reasons := array_append(reasons, 'missing_subject'); end if;
  if template = '' and bodyish = '' then reasons := array_append(reasons, 'missing_template_or_body'); end if;
  if job_type ~ '(activation|reset|reactivat)' or template ~* '(activation|reset|reactivat)' then
    if activation_url = '' then reasons := array_append(reasons, 'missing_activation_or_reset_url');
    elsif activation_url !~* '^https?://' then reasons := array_append(reasons, 'invalid_activation_or_reset_url');
    end if;
  end if;
  return reasons;
end;
$$;

grant execute on function public._email_job_validation_reasons_v638(jsonb) to anon, authenticated;

create or replace function public.admin_validate_outbound_email_job_v638(admin_session_token text, job_id_input bigint, mark_failed_input boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  admin_row record;
  row_data jsonb;
  reasons text[];
begin
  select * into admin_row from public._require_valid_admin_session(admin_session_token);
  if coalesce(admin_row.ok, false) is not true then raise exception 'Ongeldige admin-sessie'; end if;
  if to_regclass('public.outbound_email_jobs') is null then
    return jsonb_build_object('ok', false, 'reasons', jsonb_build_array('missing_outbound_email_jobs_table'));
  end if;
  execute 'select to_jsonb(j) from public.outbound_email_jobs j where id = $1 limit 1' into row_data using job_id_input;
  if row_data is null then return jsonb_build_object('ok', false, 'reasons', jsonb_build_array('missing_job')); end if;
  reasons := public._email_job_validation_reasons_v638(row_data);
  if array_length(reasons,1) is not null and mark_failed_input then
    execute 'update public.outbound_email_jobs set job_status = $2, status = $2, last_error = $3, updated_at = now() where id = $1'
      using job_id_input, 'failed_preflight', array_to_string(reasons, ',');
  end if;
  return jsonb_build_object('ok', coalesce(array_length(reasons,1),0) = 0, 'job_id', job_id_input, 'reasons', coalesce(to_jsonb(reasons), '[]'::jsonb), 'payload', row_data);
end;
$$;

grant execute on function public.admin_validate_outbound_email_job_v638(text,bigint,boolean) to anon, authenticated;

create or replace function public.admin_wake_outbound_email_job_safe_v638(admin_session_token text, job_id_input bigint, meta_input jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  validation jsonb;
begin
  validation := public.admin_validate_outbound_email_job_v638(admin_session_token, job_id_input, true);
  if coalesce((validation->>'ok')::boolean, false) is not true then
    return validation || jsonb_build_object('woken', false, 'skipped', true, 'message', 'Make niet gewekt: mailjob faalde preflight.');
  end if;
  execute 'update public.outbound_email_jobs set updated_at = now() where id = $1' using job_id_input;
  return jsonb_build_object(
    'ok', true,
    'woken', false,
    'queued_for_worker', true,
    'job_id', job_id_input,
    'message', 'Mailjob is gevalideerd. Browser heeft Make niet direct aangeroepen; worker/Make mag alleen valid rows claimen.',
    'payload', validation->'payload',
    'meta', coalesce(meta_input,'{}'::jsonb)
  );
end;
$$;

grant execute on function public.admin_wake_outbound_email_job_safe_v638(text,bigint,jsonb) to anon, authenticated;

create or replace function public.admin_wake_latest_valid_outbound_email_job_safe_v638(admin_session_token text, meta_input jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  admin_row record;
  job_id bigint;
begin
  select * into admin_row from public._require_valid_admin_session(admin_session_token);
  if coalesce(admin_row.ok, false) is not true then raise exception 'Ongeldige admin-sessie'; end if;
  if to_regclass('public.outbound_email_jobs') is null then
    return jsonb_build_object('ok', false, 'skipped', true, 'reasons', jsonb_build_array('missing_outbound_email_jobs_table'));
  end if;
  execute $q$
    select id from public.outbound_email_jobs
    where coalesce(job_status,status,'pending') in ('pending','queued','ready')
    order by created_at asc
    limit 1
  $q$ into job_id;
  if job_id is null then return jsonb_build_object('ok', false, 'skipped', true, 'reasons', jsonb_build_array('no_pending_mail_jobs')); end if;
  return public.admin_wake_outbound_email_job_safe_v638(admin_session_token, job_id, meta_input);
end;
$$;

grant execute on function public.admin_wake_latest_valid_outbound_email_job_safe_v638(text,jsonb) to anon, authenticated;

create or replace function public.claim_email_jobs_http(p_limit int default 5)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  rec record;
  row_data jsonb;
  reasons text[];
  claimed jsonb := '[]'::jsonb;
  limit_n int := greatest(1, least(coalesce(p_limit,5), 25));
begin
  if to_regclass('public.outbound_email_jobs') is null then return '[]'::json; end if;
  for rec in execute format($q$
    select id from public.outbound_email_jobs
    where coalesce(job_status,status,'pending') in ('pending','queued','ready')
      and coalesce(attempts,0) < 5
    order by created_at asc
    limit %s
    for update skip locked
  $q$, limit_n * 3)
  loop
    execute 'select to_jsonb(j) from public.outbound_email_jobs j where id = $1' into row_data using rec.id;
    reasons := public._email_job_validation_reasons_v638(row_data);
    if array_length(reasons,1) is not null then
      execute 'update public.outbound_email_jobs set job_status = $2, status = $2, last_error = $3, updated_at = now() where id = $1'
        using rec.id, 'failed_preflight', array_to_string(reasons, ',');
    elsif jsonb_array_length(claimed) < limit_n then
      execute 'update public.outbound_email_jobs set job_status = $2, status = $2, updated_at = now() where id = $1 returning to_jsonb(outbound_email_jobs.*)'
        into row_data using rec.id, 'processing';
      claimed := claimed || jsonb_build_array(row_data);
    end if;
  end loop;
  return claimed::json;
end;
$$;

grant execute on function public.claim_email_jobs_http(int) to anon, authenticated;

create or replace function public.admin_get_mail_safety_audit_v638(admin_session_token text, limit_input int default 50)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  admin_row record;
  rows_out jsonb := '[]'::jsonb;
begin
  select * into admin_row from public._require_valid_admin_session(admin_session_token);
  if coalesce(admin_row.ok, false) is not true then raise exception 'Ongeldige admin-sessie'; end if;
  if to_regclass('public.outbound_email_jobs') is null then return jsonb_build_object('table_exists', false, 'rows', rows_out); end if;
  execute format($q$
    select coalesce(jsonb_agg(x order by (x->>'created_at') desc), '[]'::jsonb)
    from (
      select to_jsonb(j) || jsonb_build_object('preflight_reasons', to_jsonb(public._email_job_validation_reasons_v638(to_jsonb(j)))) x
      from public.outbound_email_jobs j
      order by created_at desc
      limit %s
    ) s
  $q$, greatest(1, least(coalesce(limit_input,50), 200))) into rows_out;
  return jsonb_build_object('table_exists', true, 'rows', coalesce(rows_out,'[]'::jsonb));
end;
$$;

grant execute on function public.admin_get_mail_safety_audit_v638(text,int) to anon, authenticated;

commit;
