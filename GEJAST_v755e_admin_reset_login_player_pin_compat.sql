-- GEJAST v755e: admin reset login-player PIN compatibility.
-- Production had v679/v680/v681 wrappers, but v679 delegated to missing
-- admin_reset_login_player_pin_v678(text,text,text,text). This restores the
-- narrow compatibility target so admin-created temporary beta accounts can use
-- the normal login_player(input_username, entered_pin) session path.

begin;

create or replace function public.admin_reset_login_player_pin_v678(
  admin_session_token_input text,
  player_name_input text,
  new_pin_input text,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_name text := regexp_replace(btrim(coalesce(player_name_input,'')), '\s+', ' ', 'g');
  v_scope text := case when lower(coalesce(site_scope_input,''))='family' then 'family' else 'friends' end;
  v_hash text;
  v_slug text;
  v_player_id bigint;
  v_admin_state jsonb;
begin
  if to_regprocedure('public.admin_check_session(text)') is null then
    raise exception 'admin_session_checker_missing';
  end if;

  select to_jsonb(public.admin_check_session(admin_session_token_input)) into v_admin_state;
  if coalesce((v_admin_state->>'ok')::boolean, false) is not true then
    raise exception 'admin_session_invalid';
  end if;

  if v_name = '' then raise exception 'player_name_required'; end if;
  if new_pin_input !~ '^\d{4}$' then raise exception 'pin_must_be_4_digits'; end if;

  execute 'select extensions.crypt($1, extensions.gen_salt(''bf''))' into v_hash using new_pin_input;
  v_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'player-' || substr(md5(v_name),1,8); end if;

  select id into v_player_id
    from public.players
   where lower(display_name)=lower(v_name)
   order by id
   limit 1;

  if v_player_id is null then
    insert into public.players(display_name, slug, pin_hash, active, approved, site_scope, created_at, updated_at)
    values (v_name, v_slug, v_hash, true, true, v_scope, now(), now())
    returning id into v_player_id;
  else
    update public.players
       set pin_hash = v_hash,
           slug = v_slug,
           active = true,
           approved = true,
           site_scope = v_scope,
           updated_at = now()
     where id = v_player_id;
  end if;

  return jsonb_build_object('ok', true, 'player_id', v_player_id, 'display_name', v_name, 'site_scope', v_scope);
end;
$fn$;

revoke all on function public.admin_reset_login_player_pin_v678(text,text,text,text) from public;
grant execute on function public.admin_reset_login_player_pin_v678(text,text,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
