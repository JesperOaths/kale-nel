select jsonb_pretty(jsonb_build_object(
  'checked_at', now(),
  'functions', (
    select jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'signature', oidvectortypes(p.proargtypes),
      'owner', pg_get_userbyid(p.proowner),
      'result_type', pg_get_function_result(p.oid),
      'public_execute', has_function_privilege('public', p.oid, 'EXECUTE'),
      'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'uses_perform_only_admin_check', pg_get_functiondef(p.oid) ilike '%perform public.admin_check_session(admin_session_token)%',
      'uses_admin_ok_guard', pg_get_functiondef(p.oid) ilike '%v_admin_state%ok%'
    ) order by p.proname, oidvectortypes(p.proargtypes))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in (
      'get_my_profile_settings','update_my_profile_settings',
      'admin_remove_allowed_username','admin_permanently_delete_allowed_username','admin_check_session'
    )
  ),
  'required_profile_schema', jsonb_build_object(
    'profile_table_exists', to_regclass('public.gejast_profile_settings') is not null,
    'profile_pkey_exists', exists (
      select 1 from pg_constraint c
      join pg_class t on t.oid=c.conrelid
      join pg_namespace n on n.oid=t.relnamespace
      where n.nspname='public' and t.relname='gejast_profile_settings' and c.conname='gejast_profile_settings_pkey' and c.contype='p'
    )
  ),
  'table_acl', jsonb_build_object(
    'allowed_usernames_public_insert', has_table_privilege('public','public.allowed_usernames','INSERT'),
    'allowed_usernames_public_update', has_table_privilege('public','public.allowed_usernames','UPDATE'),
    'allowed_usernames_public_delete', has_table_privilege('public','public.allowed_usernames','DELETE'),
    'allowed_usernames_anon_insert', has_table_privilege('anon','public.allowed_usernames','INSERT'),
    'allowed_usernames_anon_update', has_table_privilege('anon','public.allowed_usernames','UPDATE'),
    'allowed_usernames_anon_delete', has_table_privilege('anon','public.allowed_usernames','DELETE'),
    'allowed_usernames_authenticated_insert', has_table_privilege('authenticated','public.allowed_usernames','INSERT'),
    'allowed_usernames_authenticated_update', has_table_privilege('authenticated','public.allowed_usernames','UPDATE'),
    'allowed_usernames_authenticated_delete', has_table_privilege('authenticated','public.allowed_usernames','DELETE')
  ),
  'admin_check_session_invalid_shape', to_jsonb(public.admin_check_session('OC_V764_INVALID_PREFLIGHT')),
  'baselines', jsonb_build_object(
    'allowed_usernames', (select count(*) from public.allowed_usernames),
    'drink_events', (select count(*) from public.drink_events),
    'boerenbridge_matches', (select count(*) from public.boerenbridge_matches),
    'matrix_residue_allowed_usernames', (select count(*) from public.allowed_usernames where coalesce(display_name,'') like 'OC_V764_MATRIX_ADMIN_ALLOWED_%' or coalesce(username,'') like 'oc-v764-matrix-admin-allowed-%' or coalesce(reserved_for_person_note,'') like '%OC_V764_MATRIX_ADMIN_ALLOWED_%'),
    'matrix_residue_drink_events', (select count(*) from public.drink_events where to_jsonb(drink_events)::text like '%OC_V764_MATRIX%'),
    'matrix_residue_boerenbridge', (select count(*) from public.boerenbridge_matches where to_jsonb(boerenbridge_matches)::text like '%OC_V764_MATRIX%'),
    'queued_test_push_jobs', (select count(*) from public.web_push_jobs where status in ('queued','pending','ready') and to_jsonb(web_push_jobs)::text like '%OC_V764_MATRIX%'),
    'ice_unit_value', (select unit_value from public.drink_event_types where key='ice' limit 1)
  )
)) as sanitized_preflight;
