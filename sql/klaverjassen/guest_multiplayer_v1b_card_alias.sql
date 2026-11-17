-- Remove an ambiguous PL/pgSQL alias in guest card mutations.
-- Original body declared integer n and also used SQL range alias n.
do $do$
declare
 source_sql text;
begin
 select pg_get_functiondef('public.klaverjassen_guest_v1(text,text,text,text,jsonb)'::regprocedure) into source_sql;
 if position('jsonb_array_elements(incoming->''hands''->viewer_seat) n' in source_sql)=0
    or position('n->>''id''' in source_sql)=0 then
    raise exception 'Expected ambiguous guest-card SQL alias not found';
 end if;
 source_sql := replace(source_sql,
   'jsonb_array_elements(incoming->''hands''->viewer_seat) n',
   'jsonb_array_elements(incoming->''hands''->viewer_seat) newcard');
 source_sql := replace(source_sql, 'n->>''id''', 'newcard->>''id''');
 execute source_sql;
end $do$;