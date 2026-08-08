#!/usr/bin/env node
/*
  FAST MATRIX MODE helper.

  Repository-safe by design:
  - reads only public frontend config for optional REST count snapshots;
  - never accepts, stores or prints player/admin tokens, cookies, PINs or secrets;
  - emits SQL templates for the authenticated Supabase SQL editor instead of
    embedding privileged credentials in local files;
  - cleanup SQL is label/domain scoped and includes multiple predicates.
*/
import fs from 'node:fs';

const args = process.argv.slice(2);
const command = args[0] || 'help';
const options = parseOptions(args.slice(1));
const label = options.label || 'OC_V764_MATRIX_LABEL_REQUIRED';
const domain = options.domain || 'all';

const domains = {
  paardenrace: {
    tables: ['paardenrace_rooms', 'paardenrace_room_players', 'paardenrace_obligations', 'paardenrace_match_history'],
    rootTable: 'paardenrace_rooms',
    rootPredicate: (l) => `room_code = '${sql(l)}' or to_jsonb(paardenrace_rooms)::text like '%${sql(l)}%'`,
    cleanup: paardenraceCleanup,
  },
  pikken: {
    tables: ['pikken_games', 'pikken_game_players', 'pikken_round_hands', 'pikken_round_votes', 'pikken_match_archive_v709', 'pikken_player_stats_v709'],
    rootTable: 'pikken_games',
    rootPredicate: (l) => `to_jsonb(pikken_games)::text like '%${sql(l)}%'`,
    cleanup: null,
  },
  toepen: {
    tables: ['toepen_games', 'toepen_game_participants', 'toepen_game_rounds', 'toepen_round_results'],
    rootTable: 'toepen_games',
    rootPredicate: (l) => `client_match_id = '${sql(l)}' or to_jsonb(toepen_games)::text like '%${sql(l)}%'`,
    cleanup: toepenCleanup,
  },
  beerpong: {
    tables: ['beerpong_matches', 'beerpong_player_ratings', 'beerpong_player_rating_history'],
    rootTable: 'beerpong_matches',
    rootPredicate: (l) => `client_match_id = '${sql(l)}' or to_jsonb(beerpong_matches)::text like '%${sql(l)}%'`,
    cleanup: null,
  },
  klaverjas: {
    tables: ['klaverjas_online_games', 'jas_games', 'jas_game_entries'],
    rootTable: 'klaverjas_online_games',
    rootPredicate: (l) => `to_jsonb(klaverjas_online_games)::text like '%${sql(l)}%'`,
    cleanup: null,
  },
  drinks: {
    tables: ['drink_events', 'web_push_jobs'],
    rootTable: 'drink_events',
    rootPredicate: (l) => `to_jsonb(drink_events)::text like '%${sql(l)}%'`,
    cleanup: null,
  },
  profile: {
    tables: ['players', 'gejast_profile_settings', 'allowed_usernames', 'player_sessions'],
    rootTable: 'players',
    rootPredicate: (l) => `to_jsonb(players)::text like '%${sql(l)}%'`,
    cleanup: null,
  },
  push: {
    tables: ['web_push_jobs', 'web_push_attempts', 'web_push_subscriptions'],
    rootTable: 'web_push_jobs',
    rootPredicate: (l) => `to_jsonb(web_push_jobs)::text like '%${sql(l)}%'`,
    cleanup: null,
  },
};

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`Usage:
  node scripts/matrix-harness.mjs sql --domain <domain|all> --label <OC_V764_*>
  node scripts/matrix-harness.mjs cleanup-sql --domain <paardenrace|toepen> --label <OC_V764_*>
  node scripts/matrix-harness.mjs snapshot-public --domain <domain|all>

Domains: ${Object.keys(domains).join(', ')}

Notes:
  sql emits a sanitized Supabase SQL-editor snapshot for counts, Ice, controlled
  fixtures, controlled queued push jobs and function/table ACL metadata.
  cleanup-sql is intentionally available only for domains with reviewed exact
  cleanup predicates. Review output before running in production.
`);
  process.exit(0);
}

if (command === 'sql') {
  console.log(snapshotSql(domain, label));
} else if (command === 'cleanup-sql') {
  const d = requireDomain(domain);
  if (!d.cleanup) throw new Error(`No reviewed cleanup SQL helper for domain: ${domain}`);
  console.log(d.cleanup(label));
} else if (command === 'snapshot-public') {
  await publicSnapshot(domain);
} else {
  throw new Error(`Unknown command: ${command}`);
}

function snapshotSql(domainName, fixtureLabel) {
  const selected = selectDomains(domainName);
  const tableNames = [...new Set(selected.flatMap(([, d]) => d.tables))];
  const controlledParts = selected.map(([name, d]) => `
      '${name}', jsonb_build_object(
        'root_table', '${d.rootTable}',
        'root_count', (select count(*) from public.${d.rootTable} where ${d.rootPredicate(fixtureLabel)}),
        'all_domain_marker_count', ${d.tables.map((t) => `(select count(*) from public.${t} where to_jsonb(${t})::text like '%${sql(fixtureLabel)}%')`).join(' + ')}
      )`).join(',');
  const countParts = tableNames.map((t) => `
      '${t}', (select count(*) from public.${t})`).join(',');
  const aclTables = tableNames.map(sqlLiteral).join(', ');
  return `-- FAST MATRIX MODE sanitized snapshot
-- Domain: ${domainName}
-- Controlled label: ${fixtureLabel}
-- Paste into the authenticated Supabase SQL editor; no secrets are embedded.
select jsonb_pretty(jsonb_build_object(
  'snapshot_at', now(),
  'domain', '${sql(domainName)}',
  'label', '${sql(fixtureLabel)}',
  'ice_unit_value', (select unit_value from public.drink_event_types where key='ice' limit 1),
  'controlled_queued_push_jobs', (
    select count(*) from public.web_push_jobs
    where status in ('queued','pending','ready')
      and to_jsonb(web_push_jobs)::text like '%${sql(fixtureLabel)}%'
  ),
  'table_counts', jsonb_build_object(${countParts}
  ),
  'controlled_fixtures', jsonb_build_object(${controlledParts}
  ),
  'table_dml_acl', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name,
      'grantee', grantee,
      'privilege', privilege_type
    ) order by table_name, grantee, privilege_type), '[]'::jsonb)
    from information_schema.role_table_grants
    where table_schema='public'
      and table_name in (${aclTables})
      and grantee in ('PUBLIC','anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE')
  ),
  'function_execute_acl', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'function', p.proname,
      'args', pg_get_function_identity_arguments(p.oid),
      'acl', coalesce(p.proacl::text, 'default')
    ) order by p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (${selected.map(([, d]) => d.tables.map((t) => `p.proname ilike '%${sql(t.replace(/^gejast_|_v\d+$/g, '').split('_')[0])}%'`).join(' or ')).join(' or ') || 'false'})
  )
)) as fast_matrix_snapshot;
`;
}

function paardenraceCleanup(fixtureLabel) {
  return `-- Reviewed exact cleanup helper: Paardenrace lobby/soft-closed fixture only.
-- Refuses broad deletion by requiring an exact OC_V764 label, no obligations and no history.
-- Add additional exact predicates (id, host_player_id, host_name, stage) before running when known.
do $$
declare
  _label text := '${sql(fixtureLabel)}';
  _deleted int;
begin
  if _label not like 'OC_V764_%' then
    raise exception 'Refusing cleanup: label must start with OC_V764_';
  end if;

  with controlled as (
    select id
    from public.paardenrace_rooms r
    where r.room_code = _label
      and r.stage in ('lobby','closed')
      and not exists (select 1 from public.paardenrace_obligations o where o.room_id = r.id)
      and not exists (select 1 from public.paardenrace_match_history h where h.room_id = r.id)
  ), del as (
    delete from public.paardenrace_rooms
    where id in (select id from controlled)
    returning 1
  )
  select count(*) into _deleted from del;

  raise notice 'deleted controlled paardenrace rooms: %', _deleted;
end $$;

${snapshotSql('paardenrace', fixtureLabel)}
`;
}

function toepenCleanup(fixtureLabel) {
  return `-- Reviewed exact cleanup helper: Toepen fixture by exact client_match_id only.
-- Refuses broad deletion by requiring an exact OC_V764 label.
do $$
declare
  _label text := '${sql(fixtureLabel)}';
  _deleted int;
begin
  if _label not like 'OC_V764_%' then
    raise exception 'Refusing cleanup: label must start with OC_V764_';
  end if;

  with controlled as (
    select id from public.toepen_games where client_match_id = _label
  ), del as (
    delete from public.toepen_games where id in (select id from controlled) returning 1
  )
  select count(*) into _deleted from del;

  raise notice 'deleted controlled toepen games: %', _deleted;
end $$;

${snapshotSql('toepen', fixtureLabel)}
`;
}

async function publicSnapshot(domainName) {
  const config = readConfig();
  const selected = selectDomains(domainName);
  const tables = [...new Set(selected.flatMap(([, d]) => d.tables).concat(['drink_event_types','web_push_jobs']))];
  const out = { at: new Date().toISOString(), domain: domainName, tables: {}, ice_unit_value: null };
  for (const table of tables) {
    const res = await fetch(`${config.url}/rest/v1/${table}?select=*&limit=0`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, Prefer: 'count=exact' },
    });
    await res.text();
    out.tables[table] = { status: res.status, count: countFromRange(res.headers.get('content-range')) };
  }
  const ice = await fetch(`${config.url}/rest/v1/drink_event_types?select=key,unit_value&key=eq.ice`, {
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
  }).then((r) => r.json()).catch(() => []);
  out.ice_unit_value = Array.isArray(ice) && ice[0] ? Number(ice[0].unit_value) : null;
  console.log(JSON.stringify(out, null, 2));
}

function readConfig() {
  const text = fs.readFileSync('gejast-config.js', 'utf8');
  const url = text.match(/SUPABASE_URL\s*:\s*['"]([^'"]+)['"]/)?.[1];
  const key = text.match(/SUPABASE_PUBLISHABLE_KEY\s*:\s*['"]([^'"]+)['"]/)?.[1];
  if (!url || !key) throw new Error('Missing public Supabase config');
  return { url, key };
}

function selectDomains(domainName) {
  if (domainName === 'all') return Object.entries(domains);
  return [[domainName, requireDomain(domainName)]];
}

function requireDomain(domainName) {
  const d = domains[domainName];
  if (!d) throw new Error(`Unknown domain: ${domainName}`);
  return d;
}

function parseOptions(items) {
  const out = {};
  for (let i = 0; i < items.length; i += 1) {
    if (!items[i].startsWith('--')) continue;
    out[items[i].slice(2)] = items[i + 1] && !items[i + 1].startsWith('--') ? items[++i] : true;
  }
  return out;
}

function countFromRange(range) {
  const m = String(range || '').match(/\/(\d+|\*)$/);
  return m && m[1] !== '*' ? Number(m[1]) : null;
}

function sql(value) {
  return String(value).replace(/'/g, "''");
}

function sqlLiteral(value) {
  return `'${sql(value)}'`;
}
