# Ice unit value repair proof - 2026-08-02

Scope: SQL-only production data repair for live `drink_event_types` drift. No frontend version bump. No Cloudflare Worker deploy.

## Repository state

- Started from current `main` at `530e12a970fb47c8501a05fa2db79015c683ca90` with a clean working tree.
- Added migration: `GEJAST_v755h_ice_unit_value_repair.sql`.
- Public frontend version remains `v761`.
- Protected admin Worker version remains `79e680cd-4baf-433f-8310-da2d1f1c2b9c`.

## Before-state inspection

Live schema inspection for `public.drink_event_types`:

- primary key: `id`
- columns:
  - `id bigint not null`
  - `key text not null`
  - `label text not null`
  - `category text not null default 'drink'`
  - `unit_value numeric not null default 1`
  - `sort_order integer not null default 100`
  - `is_active boolean not null default true`
  - `created_at timestamptz not null default now()`

Sanitized current drink type configuration before repair:

| id | key | label | category | unit_value | sort_order | is_active | created_at |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| 1 | bier | 1 Bak | beer | 1.0 | 10 | true | 2026-03-31T17:14:36.016314+00:00 |
| 2 | shot | Shot | shot | 1.0 | 20 | true | 2026-03-31T17:14:36.016314+00:00 |
| 3 | wijnfles | Fles Wijn | wine | 9.0 | 40 | true | 2026-03-31T17:14:36.016314+00:00 |
| 4 | ice | Ice | ice | 3.0 | 30 | true | 2026-03-31T17:14:36.016314+00:00 |
| 5 | liter_bier | Liter Bier | beer | 3.0 | 50 | true | 2026-03-31T17:14:36.016314+00:00 |
| 26 | 2bakken | 2 Bakken | drink | 2.0 | 11 | true | 2026-03-31T23:58:51.133858+00:00 |

Inspection found exactly one active Ice row: `id=4`, `key=ice`, `label=Ice`, `category=ice`, `unit_value=3.0`, `sort_order=30`, `is_active=true`.

## Migration applied

Applied `GEJAST_v755h_ice_unit_value_repair.sql` through the authenticated Supabase SQL editor.

Migration properties:

- one transaction;
- aborts unless exactly one active Ice row exists;
- locks primary key `id=4` with `for update`;
- asserts current `unit_value` is either drifted `3.0` or already-correct `2.8`;
- updates only `unit_value` to `2.8::numeric`;
- idempotent when rerun after correction;
- does not touch labels, sort order, active state, timestamps, other drink types, historical drink events, balances, totals, or achievements.

SQL editor returned corrected row:

| id | key | label | category | unit_value | sort_order | is_active | created_at |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| 4 | ice | Ice | ice | 2.8 | 30 | true | 2026-03-31T17:14:36.016314+00:00 |

## Independent verification

Read-back checks after repair:

- exactly one active Ice row exists;
- Ice `unit_value` is numeric `2.8`;
- other drink-event type rows remained unchanged from the before-state;
- live drinks page browser context, using `window.GEJAST_CONFIG` and Supabase REST, returned the Ice row as `unit_value=2.8`;
- live `/VERSION` remains `v761`;
- `wrangler deployments list` still shows latest/current Worker deployment `79e680cd-4baf-433f-8310-da2d1f1c2b9c`.

## Checks

- `npm run verify`: passed.
- `npm run smoke:live`: passed, including `/drinks.html` HTTP 200.
- `npm run smoke:beta:read`: all drinks routes returned HTTP 200 (`/drinks.html`, `/drinks_add.html`, `/drinks_pending.html`, `/drinks_history.html`, `/drinks_speed.html`, `/drinks_stats.html`, `/push_beta_test.html`). The command exits non-zero because protected admin routes now correctly return HTTP 401 under the Worker gate.

## Historical data

No historical drink events, balances, totals, or achievements were changed. This repair only corrects the live type configuration row used for current/future Ice unit value reads.
