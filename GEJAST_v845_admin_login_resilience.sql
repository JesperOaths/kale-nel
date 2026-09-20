-- v845 resilient admin login.
-- Keeps failed-attempt accounting durable by returning JSON errors instead of raising,
-- and is called through a service-role Edge Function to avoid the anon 3-second PostgREST timeout.

create or replace function public.admin_login(input_username text, input_password text, input_totp_code text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  acct public.admin_accounts%rowtype;
  session_token text;
  token_hash text;
  v_expires_at timestamptz := now() + interval '12 hours';
  v_fail_count integer := 0;
  v_locked_until timestamptz;
  clean_username text := trim(coalesce(input_username, ''));
  v_password_ok boolean := false;
begin
  select count(*)::int, max(attempted_at) + interval '10 minutes'
    into v_fail_count, v_locked_until
  from public.admin_login_attempts
  where lower(username) = lower(clean_username)
    and success = false
    and attempted_at > now() - interval '10 minutes';

  if v_fail_count >= 5 and v_locked_until > now() then
    return json_build_object(
      'ok', false,
      'error', 'too_many_attempts',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_locked_until - now())))::int)
    );
  end if;

  select * into acct
  from public.admin_accounts
  where lower(username) = lower(clean_username)
  limit 1;

  if found then
    v_password_ok := acct.password_hash = extensions.crypt(coalesce(input_password, ''), acct.password_hash);
  end if;

  if not found or v_password_ok is not true then
    insert into public.admin_login_attempts(username, success) values (clean_username, false);
    return json_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  if public._verify_totp(acct.totp_secret_base32, input_totp_code, 1) is not true then
    insert into public.admin_login_attempts(username, success) values (acct.username, false);
    return json_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  insert into public.admin_login_attempts(username, success) values (acct.username, true);

  session_token := encode(extensions.gen_random_bytes(32), 'hex');
  token_hash := public._hash_session_token(session_token);

  delete from public.admin_sessions where expires_at <= now();

  insert into public.admin_sessions(admin_id, token_hash, expires_at, last_used_at)
  values(acct.id, token_hash, v_expires_at, now());

  delete from public.admin_sessions s
  using (
    select id from public.admin_sessions
    where admin_id = acct.id and expires_at > now()
    order by last_used_at desc nulls last, created_at desc
    offset 20
  ) old
  where s.id = old.id;

  return json_build_object(
    'ok', true,
    'username', acct.username,
    'admin_username', acct.username,
    'admin_session_token', session_token,
    'expires_at', v_expires_at,
    'trusted_device_available', coalesce(acct.trusted_device_enabled, false)
  );
end;
$function$;
