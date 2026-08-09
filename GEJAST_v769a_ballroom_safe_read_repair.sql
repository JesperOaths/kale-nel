begin;

create or replace function public.get_ballroom_public_state_safe(
  session_token text default null,
  session_token_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  viewer_name text := public._gejast_name_for_session(
    public._ballroom_safe_token(session_token, session_token_input)
  );
  v_king_name text;
  v_king_avatar text;
  approved_members jsonb;
  pending_requests jsonb;
  succession_line jsonb;
begin
  select s.king_name, s.king_avatar_url
    into v_king_name, v_king_avatar
  from public.ballroom_safe_state s
  where s.id = 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'display_name', m.player_name,
        'avatar_url', m.avatar_url
      )
      order by m.approved_at
    ),
    '[]'::jsonb
  )
  into approved_members
  from public.ballroom_safe_members m;

  select coalesce(
    jsonb_agg(x.obj order by x.approved_at),
    '[]'::jsonb
  )
  into succession_line
  from (
    select
      jsonb_build_object(
        'display_name', m.player_name,
        'avatar_url', m.avatar_url
      ) as obj,
      m.approved_at
    from public.ballroom_safe_members m
    where coalesce(lower(m.player_name), '') <> coalesce(lower(v_king_name), '')
    order by m.approved_at
    limit 3
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'display_name', r.player_name,
        'avatar_url', r.avatar_url,
        'requested_at', r.requested_at
      )
      order by r.requested_at
    ),
    '[]'::jsonb
  )
  into pending_requests
  from public.ballroom_safe_requests r
  where r.status = 'pending';

  return jsonb_build_object(
    'has_king', nullif(trim(coalesce(v_king_name, '')), '') is not null,
    'king', case
      when nullif(trim(coalesce(v_king_name, '')), '') is not null then
        jsonb_build_object(
          'display_name', v_king_name,
          'avatar_url', v_king_avatar
        )
      else null
    end,
    'approved_members', approved_members,
    'succession_line', succession_line,
    'pending_requests', pending_requests,
    'viewer', jsonb_build_object(
      'display_name', viewer_name,
      'is_king', viewer_name is not null
        and lower(viewer_name) = lower(coalesce(v_king_name, '')),
      'is_member', viewer_name is not null
        and exists (
          select 1
          from public.ballroom_safe_members m
          where lower(m.player_name) = lower(viewer_name)
        ),
      'pending', viewer_name is not null
        and exists (
          select 1
          from public.ballroom_safe_requests r
          where lower(r.player_name) = lower(viewer_name)
            and r.status = 'pending'
        )
    )
  );
end;
$fn$;

create or replace function public.get_ballroom_state_safe(
  session_token text default null,
  session_token_input text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  select public.get_ballroom_public_state_safe(session_token, session_token_input)
$fn$;

revoke execute on function public.get_ballroom_public_state_safe(text, text) from public;
revoke execute on function public.get_ballroom_state_safe(text, text) from public;
grant execute on function public.get_ballroom_public_state_safe(text, text) to anon, authenticated;
grant execute on function public.get_ballroom_state_safe(text, text) to anon, authenticated;

commit;
