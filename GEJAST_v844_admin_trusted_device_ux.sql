-- v844 durable MFA-verified admin sessions and trusted-computer UX.
-- Production-applied 2026-09-20.

create index if not exists admin_login_attempts_username_ci_time_idx
  on public.admin_login_attempts (lower(username), attempted_at desc);

alter table public.admin_trusted_devices enable row level security;
revoke all on table public.admin_trusted_devices from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_trusted_devices to service_role;

update public.admin_accounts
set trusted_device_enabled = true
where trusted_device_enabled is distinct from true;

create or replace function public.admin_login(input_username text, input_password text, input_totp_code text)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  acct public.admin_accounts%rowtype;
  session_token text;
  token_hash text;
  v_expires_at timestamptz := now() + interval '12 hours';
  v_fail_count integer := 0;
  v_locked_until timestamptz;
  clean_username text := trim(coalesce(input_username, ''));
begin
  select count(*)::int, max(attempted_at) + interval '10 minutes'
  into v_fail_count, v_locked_until
  from public.admin_login_attempts
  where lower(username) = lower(clean_username)
    and success = false and attempted_at > now() - interval '10 minutes';

  if v_fail_count >= 5 and v_locked_until > now() then
    raise exception 'Te veel mislukte pogingen. Probeer het later opnieuw.';
  end if;

  select * into acct
  from public.admin_accounts
  where lower(username) = lower(clean_username)
  limit 1;

  if not found
     or acct.password_hash <> extensions.crypt(coalesce(input_password, ''), acct.password_hash)
     or public._verify_totp(acct.totp_secret_base32, input_totp_code, 1) is not true then
    insert into public.admin_login_attempts(username, success) values (clean_username, false);
    raise exception 'Ongeldige inloggegevens';
  end if;

  insert into public.admin_login_attempts(username, success) values (acct.username, true);
  session_token := encode(extensions.gen_random_bytes(32), 'hex');
  token_hash := public._hash_session_token(session_token);

  delete from public.admin_sessions where expires_at <= now();
  insert into public.admin_sessions (admin_id, token_hash, expires_at, last_used_at)
  values (acct.id, token_hash, v_expires_at, now());

  delete from public.admin_sessions s
  using (
    select id from public.admin_sessions
    where admin_id = acct.id and expires_at > now()
    order by last_used_at desc nulls last, created_at desc
    offset 20
  ) old
  where s.id = old.id;

  return json_build_object(
    'ok', true, 'username', acct.username, 'admin_username', acct.username,
    'admin_session_token', session_token, 'expires_at', v_expires_at,
    'trusted_device_available', coalesce(acct.trusted_device_enabled, false)
  );
end;
$function$;

create or replace function public.admin_check_session(admin_session_token text)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  sess record;
  new_token text;
  new_hash text;
  old_hash text;
  new_expires timestamptz;
begin
  select * into sess from public._require_valid_admin_session(admin_session_token);
  if coalesce(sess.ok, false) is not true then return json_build_object('ok', false); end if;

  if sess.expires_at < now() + interval '2 hours' then
    old_hash := public._hash_session_token(admin_session_token);
    new_token := encode(extensions.gen_random_bytes(32), 'hex');
    new_hash := public._hash_session_token(new_token);
    new_expires := now() + interval '12 hours';
    update public.admin_sessions
       set token_hash=new_hash, expires_at=new_expires, last_used_at=now()
     where token_hash=old_hash and expires_at>now();
    return json_build_object('ok',true,'username',sess.username,'admin_username',sess.username,'expires_at',new_expires,'admin_session_token',new_token);
  end if;

  return json_build_object('ok',true,'username',sess.username,'admin_username',sess.username,'expires_at',sess.expires_at);
end;
$function$;

create or replace function public.admin_issue_trusted_device_v844(
  admin_session_token_input text, raw_device_token_input text,
  device_label_input text default null, device_fingerprint_input text default null,
  user_agent_hash_input text default null
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_session record; v_enabled boolean; v_hash text; v_id bigint;
  v_expires timestamptz := now() + interval '45 days';
begin
  select * into v_session from public._require_valid_admin_session(admin_session_token_input);
  if coalesce(v_session.ok,false) is not true then raise exception 'Adminsessie ongeldig.'; end if;
  select trusted_device_enabled into v_enabled from public.admin_accounts where id=v_session.admin_id;
  if coalesce(v_enabled,false) is not true then raise exception 'Trusted-device login is niet toegestaan voor dit account.'; end if;
  if length(coalesce(raw_device_token_input,'')) < 64 then raise exception 'Ongeldig device token.'; end if;
  v_hash := public._hash_admin_device_token(raw_device_token_input);

  insert into public.admin_trusted_devices(
    admin_username,device_token_hash,device_label,device_fingerprint,
    device_user_agent_hash,trusted_at,last_seen_at,expires_at,revoked_at
  ) values(
    v_session.username,v_hash,nullif(trim(coalesce(device_label_input,'')),''),
    nullif(trim(coalesce(device_fingerprint_input,'')),''),
    nullif(trim(coalesce(user_agent_hash_input,'')),''),
    now(),now(),v_expires,null
  )
  on conflict(device_token_hash) do update set
    admin_username=excluded.admin_username,device_label=excluded.device_label,
    device_fingerprint=excluded.device_fingerprint,device_user_agent_hash=excluded.device_user_agent_hash,
    trusted_at=now(),last_seen_at=now(),expires_at=v_expires,revoked_at=null
  returning id into v_id;

  return jsonb_build_object('ok',true,'trusted_device_id',v_id,'admin_username',v_session.username,'trusted_until',v_expires);
end;
$function$;

create or replace function public.admin_resume_trusted_device_v844(
  admin_username_input text, raw_device_token_input text,
  device_fingerprint_input text default null, user_agent_hash_input text default null
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_device public.admin_trusted_devices%rowtype; v_acct public.admin_accounts%rowtype;
  v_token text; v_session_hash text; v_hash text;
  v_session_expires timestamptz := now() + interval '12 hours';
begin
  if length(coalesce(raw_device_token_input,'')) < 64 then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  v_hash := public._hash_admin_device_token(raw_device_token_input);

  select * into v_device from public.admin_trusted_devices
  where device_token_hash=v_hash
    and lower(admin_username)=lower(trim(coalesce(admin_username_input,'')))
    and revoked_at is null and expires_at>now()
  limit 1;
  if not found then return jsonb_build_object('ok',false,'error','not_trusted_or_expired'); end if;

  select * into v_acct from public.admin_accounts where lower(username)=lower(v_device.admin_username) limit 1;
  if not found or coalesce(v_acct.trusted_device_enabled,false) is not true then return jsonb_build_object('ok',false,'error','account_not_enabled'); end if;
  if v_device.device_fingerprint is not null and coalesce(device_fingerprint_input,'')<>v_device.device_fingerprint then return jsonb_build_object('ok',false,'error','device_mismatch'); end if;
  if v_device.device_user_agent_hash is not null and coalesce(user_agent_hash_input,'')<>v_device.device_user_agent_hash then return jsonb_build_object('ok',false,'error','browser_mismatch'); end if;

  v_token := encode(extensions.gen_random_bytes(32),'hex');
  v_session_hash := public._hash_session_token(v_token);
  delete from public.admin_sessions where expires_at<=now();
  insert into public.admin_sessions(admin_id,token_hash,expires_at,last_used_at)
  values(v_acct.id,v_session_hash,v_session_expires,now());
  update public.admin_trusted_devices set last_seen_at=now() where id=v_device.id;

  return jsonb_build_object('ok',true,'username',v_acct.username,'admin_username',v_acct.username,'admin_session_token',v_token,'session_expires_at',v_session_expires,'trusted_until',v_device.expires_at);
end;
$function$;

create or replace function public.admin_forget_trusted_device_v844(admin_session_token_input text,raw_device_token_input text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_session record; v_hash text;
begin
  select * into v_session from public._require_valid_admin_session(admin_session_token_input);
  if coalesce(v_session.ok,false) is not true then raise exception 'Adminsessie ongeldig.'; end if;
  v_hash := public._hash_admin_device_token(raw_device_token_input);
  update public.admin_trusted_devices set revoked_at=now(),last_seen_at=now()
  where device_token_hash=v_hash and lower(admin_username)=lower(v_session.username) and revoked_at is null;
  return jsonb_build_object('ok',true);
end;
$function$;

revoke all on function public.admin_issue_trusted_device_v844(text,text,text,text,text) from public;
revoke all on function public.admin_resume_trusted_device_v844(text,text,text,text) from public;
revoke all on function public.admin_forget_trusted_device_v844(text,text) from public;
grant execute on function public.admin_issue_trusted_device_v844(text,text,text,text,text) to anon, authenticated;
grant execute on function public.admin_resume_trusted_device_v844(text,text,text,text) to anon, authenticated;
grant execute on function public.admin_forget_trusted_device_v844(text,text) to anon, authenticated;
grant execute on function public.admin_login(text,text,text) to anon, authenticated;
grant execute on function public.admin_check_session(text) to anon, authenticated;


create or replace function public.admin_logout(admin_session_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if admin_session_token is not null and admin_session_token <> '' then
    delete from public.admin_sessions
    where token_hash = public._hash_session_token(admin_session_token);
  end if;
  return json_build_object('ok', true);
end;
$function$;

grant execute on function public.admin_logout(text) to anon, authenticated;
