-- Fix standalone guest Klaverjassen: host add_bot was pre-authorized but
-- omitted from the save action dispatcher, rejecting all solo bot additions.
-- Reconstruct lobby state from the stored row rather than accepting client
-- changes to cards, scores, player identities or other room fields.
do $migration$
declare
  source_sql text;
  marker text := ' elsif reason=''bid'' then';
  replacement text := $branch$
 elsif reason='add_bot' then
  -- The earlier add_bot guard already requires: valid host credential,
  -- lobby phase, exactly one appended bot and a valid difficulty.
  -- Canonicalize the new player; keep all previous room state server-owned.
  n := jsonb_array_length(old_players);
  bot := jsonb_build_object(
    'seat', n,
    'name', coalesce(nullif(left(btrim(coalesce(bot->>'name','')),30),''),format('Bot %s',n+1)),
    'team', case when n%2=0 then 1 else 2 end,
    'is_bot',true,
    'player_type','bot',
    'bot_difficulty', bot->>'bot_difficulty'
  );
  new_players := old_players || jsonb_build_array(bot);
  incoming := jsonb_set(s,'{players}',new_players,true);
  incoming := jsonb_set(incoming,'{settings}',
    coalesce(s->'settings','{}'::jsonb) || jsonb_build_object('bot_count',
      (select count(*) from jsonb_array_elements(new_players) seat_record
        where coalesce((seat_record->>'is_bot')::boolean,false))),true);
  incoming := incoming || jsonb_build_object(
    'last_progress_reason','add_bot',
    'progress_tick',coalesce((s->>'progress_tick')::bigint,0)+1,
    'last_saved_at',now());
$branch$;
begin
 select pg_get_functiondef('public.klaverjassen_guest_v1(text,text,text,text,jsonb)'::regprocedure)
 into source_sql;
 if position(marker in source_sql)=0 then
  raise exception 'Expected guest bid dispatch arm not found; refused unsafe patch';
 end if;
 if position('elsif reason=''add_bot'' then' in source_sql)>0 then
  raise exception 'Guest add_bot dispatcher already exists; refused duplicate patch';
 end if;
 source_sql := replace(source_sql,marker,replacement || marker);
 execute source_sql;
end $migration$;