-- Align standalone RPC bid action with the original game client.
do $do$
declare source_sql text;
begin
 select pg_get_functiondef('public.klaverjassen_guest_v1(text,text,text,text,jsonb)'::regprocedure) into source_sql;
 if position('reason=''place_bid''' in source_sql) = 0 then
   raise exception 'Expected original bid arm not found; refusing blind replacement';
 end if;
 source_sql := replace(source_sql, 'reason=''place_bid''', 'reason=''bid''');
 execute source_sql;
end $do$;