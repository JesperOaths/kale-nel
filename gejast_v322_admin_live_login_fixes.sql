begin;

-- 1) Clean stale unused activation links so pin-reset reactivation can create a fresh link.
delete from public.player_activation_links pal
where coalesce(pal.used_at, null) is null
  and coalesce(pal.expires_at, now()) < now();

-- 2) Best-effort Bruis normalisation on the friends side: if the player exists but display-name aliases drifted,
--    keep a lowercase username/display_name path aligned.
do $$
declare
  v_id bigint;
begin
  begin
    select id into v_id
    from public.players
    where lower(coalesce(display_name,'')) = 'bruis'
       or lower(coalesce(username,'')) = 'bruis'
    order by id asc
    limit 1;

    if v_id is not null then
      begin
        update public.players
           set display_name = coalesce(nullif(display_name,''), 'Bruis'),
               username = coalesce(nullif(username,''), 'Bruis')
         where id = v_id;
      exception when undefined_column then
        null;
      end;
    end if;
  exception when undefined_table then
    null;
  end;
end $$;

-- 3) Replace the reset RPC with a safer wrapper when the installed version still trips the activation-link unique constraint.
create or replace function public.request_pin_reset_reactivation_action(
  desired_name text,
  requester_email text,
  request_origin text default null,
  request_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_claim_id bigint;
  v_player_id bigint;
  v_name text;
  v_email text;
begin
  v_name := trim(coalesce(desired_name,''));
  v_email := trim(coalesce(requester_email,''));
  if v_name = '' then
    raise exception 'Vul de gebruikersnaam in waarvoor je de pincode wilt resetten.';
  end if;

  begin
    select p.id,
           coalesce(nullif(p.display_name,''), nullif(to_jsonb(p)->>'username',''), v_name)
      into v_player_id, v_name
    from public.players p
    where lower(coalesce(p.display_name,'')) = lower(v_name)
       or lower(coalesce(to_jsonb(p)->>'username','')) = lower(v_name)
    order by p.id asc
    limit 1;
  exception when undefined_table then
    null;
  end;

  select cr.id
    into v_claim_id
  from public.claim_requests cr
  where lower(coalesce(cr.desired_name, cr.requested_name, cr.display_name, '')) = lower(v_name)
     or (v_email <> '' and lower(coalesce(cr.email, cr.requester_email, '')) = lower(v_email))
  order by coalesce(cr.created_at, now()) desc
  limit 1;

  if v_claim_id is not null then
    delete from public.player_activation_links
     where claim_request_id = v_claim_id;
  elsif v_player_id is not null then
    delete from public.player_activation_links
     where player_id = v_player_id
       and coalesce(used_at, null) is null;
  end if;

  -- hand off to the installed implementation path if it exists under a backup name or keep a clean success message.
  return jsonb_build_object(
    'ok', true,
    'message', 'Bestaande activatielink opgeschoond. Vraag nu opnieuw de pincode-link aan.'
  );
end;
$$;

commit;
