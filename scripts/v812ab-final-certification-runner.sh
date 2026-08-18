#!/usr/bin/env bash
set -euo pipefail

PRODUCT_SHA="${PRODUCT_SHA:?PRODUCT_SHA missing}"
PROOF_BRANCH="${PROOF_BRANCH:?PROOF_BRANCH missing}"
SUPABASE_DB_URL="${SUPABASE_DB_URL:?SUPABASE_DB_URL missing}"
export GEJAST_BASE_URL="${GEJAST_BASE_URL:-https://kalenel.nl/}"
export GEJAST_SITE_SCOPE="${GEJAST_SITE_SCOPE:-friends}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
export PGOPTIONS="${PGOPTIONS:--c statement_timeout=20000}"

DEEP_PLAYER1_NAME=''
DEEP_PLAYER2_NAME=''
DEEP_CLEANED=0
VISUAL_PROVISIONED=0
VISUAL_CLEANED=0
ANALYTICS_CLEANED=0
export GEJAST_CERT_ANALYTICS_VISITOR_ID="cert_vis_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"

cleanup_deep() {
  if [[ -z "${DEEP_PLAYER1_NAME:-}" || -z "${DEEP_PLAYER2_NAME:-}" ]]; then return 0; fi
  timeout 30s psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -v n1="$DEEP_PLAYER1_NAME" -v n2="$DEEP_PLAYER2_NAME" <<'SQL'
begin;
delete from public.paardenrace_match_history h using public.paardenrace_rooms r
 where h.room_id=r.id and (
   r.host_name in (:'n1',:'n2')
   or r.host_player_id in (select id from public.players where display_name in (:'n1',:'n2'))
   or r.created_by_player_id in (select id from public.players where display_name in (:'n1',:'n2'))
 );
delete from public.klaverjas_online_games
 where created_by_player_name in (:'n1',:'n2')
    or created_by_player_id in (select id from public.players where display_name in (:'n1',:'n2'));
delete from public.pikken_games
 where created_by_player_name in (:'n1',:'n2')
    or created_by_player_id in (select id from public.players where display_name in (:'n1',:'n2'));
delete from public.paardenrace_rooms
 where host_name in (:'n1',:'n2')
    or host_player_id in (select id from public.players where display_name in (:'n1',:'n2'))
    or created_by_player_id in (select id from public.players where display_name in (:'n1',:'n2'));
delete from public.gejast_active_player_metadata_v679
 where lower(coalesce(player_name,'')) in (lower(:'n1'),lower(:'n2'));
delete from public.gejast_player_sessions_v746
 where player_id in (select id from public.players where display_name in (:'n1',:'n2'));
delete from public.players
 where display_name in (:'n1',:'n2') and hidden_from_public=true and is_dummy=true;
commit;
SQL
  DEEP_CLEANED=1
}

load_visual_env() {
  for key in GEJAST_PLAYER1_NAME GEJAST_PLAYER2_NAME GEJAST_FAMILY_NAME GEJAST_PLAYER1_TOKEN GEJAST_PLAYER2_TOKEN GEJAST_FAMILY_TOKEN; do
    value="$(grep -E "^${key}=" "$GITHUB_ENV" | tail -1 | cut -d= -f2- || true)"
    if [[ -n "$value" ]]; then export "$key=$value"; fi
  done
}

cleanup_visual() {
  if [[ "$VISUAL_PROVISIONED" != '1' || "$VISUAL_CLEANED" == '1' ]]; then return 0; fi
  load_visual_env
  node scripts/full-live-visual-fixtures-v801.mjs cleanup
  VISUAL_CLEANED=1
}

cleanup_analytics() {
  if [[ -z "${GEJAST_CERT_ANALYTICS_VISITOR_ID:-}" || "$ANALYTICS_CLEANED" == '1' ]]; then return 0; fi
  timeout 25s psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -v v="$GEJAST_CERT_ANALYTICS_VISITOR_ID" <<'SQL'
begin;
delete from public.site_visitor_events where visitor_id=:'v';
delete from public.site_visit_sessions where visitor_id=:'v';
delete from public.site_visitors where visitor_id=:'v';
commit;
SQL
  ANALYTICS_CLEANED=1
}

emergency_cleanup() {
  rc=$?
  trap - EXIT
  set +e
  echo "Emergency/final cleanup starting (incoming_rc=$rc)"
  if [[ "$VISUAL_CLEANED" != '1' ]]; then cleanup_visual; fi
  if [[ "$DEEP_CLEANED" != '1' ]]; then cleanup_deep; fi
  if [[ "$ANALYTICS_CLEANED" != '1' ]]; then cleanup_analytics; fi
  set -e
  exit "$rc"
}
trap emergency_cleanup EXIT

# Exact proof lineage and run identity.
test "$(git merge-base "$PRODUCT_SHA" HEAD)" = "$PRODUCT_SHA"
test "$(git show "$PRODUCT_SHA:VERSION" | tr -d '\r\n')" = 'v812'
unexpected="$(git diff --name-only "$PRODUCT_SHA"..HEAD | grep -Ev '^(\.github/workflows/ops-v812-final-certification\.yml|scripts/v812ab-final-certification-runner\.sh|\.proof/v812ab-final-cert-run-id\.txt)$' || true)"
test -z "$unexpected" || { echo 'Unexpected proof branch drift:'; echo "$unexpected"; exit 1; }
mkdir -p .proof
printf '%s.%s\n' "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" > .proof/v812ab-final-cert-run-id.txt
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add .proof/v812ab-final-cert-run-id.txt
git commit -m 'test: record exact v812ab final certification run'
git push origin HEAD:"$PROOF_BRANCH"
echo 'RESULT=V812AB_EXACT_PRODUCT_TREE_PASS'

# Deterministic dependencies/runtime.
npm ci
npm audit --omit=dev --audit-level=high
npm run verify
npm install --no-save --package-lock=false --ignore-scripts playwright@1.55.0
export GEJAST_SYSTEM_CHROME="$(command -v google-chrome || command -v google-chrome-stable || true)"
test -n "$GEJAST_SYSTEM_CHROME"
"$GEJAST_SYSTEM_CHROME" --version
echo 'RESULT=V812AB_CERT_RUNTIME_READY_PASS'

# Live read-only health.
export GEJAST_EXPECTED_VERSION=v812
export GEJAST_DEPLOY_WAIT_SECONDS=240
export GEJAST_SMOKE_TIMEOUT_MS=15000
export GEJAST_ADMIN_AUTH_TIMEOUT_MS=15000
export GEJAST_DATA_PLANE_TIMEOUT_MS=10000
export GEJAST_DATA_PLANE_ATTEMPTS=2
export GEJAST_DATA_PLANE_RETRY_DELAY_MS=750
export GEJAST_BETA_SURFACE_TIMEOUT_MS=15000
export GEJAST_PERF_TIMEOUT_MS=20000
node check-live-routes.mjs
node check-live-admin-auth-boundary.mjs
node check-live-data-plane.mjs
node check-beta-readonly-surfaces.mjs
node check-beta-readonly-extended.mjs
node check-beta-performance.mjs
echo 'RESULT=V812AB_EXACT_LIVE_HEALTH_PASS'

# Deployed v812a/v812b database contract.
analytics_boundary="$(timeout 25s psql "$SUPABASE_DB_URL" -X -At -F'|' -v ON_ERROR_STOP=1 <<'SQL'
select
  position('on conflict on constraint site_visitors_pkey' in lower(pg_get_functiondef('public.track_site_event(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,text,text,text,boolean,text,boolean,jsonb)'::regprocedure))) > 0,
  position('on conflict on constraint site_visit_sessions_pkey' in lower(pg_get_functiondef('public.track_site_event(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,text,text,text,boolean,text,boolean,jsonb)'::regprocedure))) > 0,
  has_function_privilege('anon','public.track_site_event(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,text,text,text,boolean,text,boolean,jsonb)','EXECUTE'),
  has_table_privilege('anon','public.site_visitors','SELECT,INSERT,UPDATE,DELETE'),
  has_table_privilege('anon','public.site_visit_sessions','SELECT,INSERT,UPDATE,DELETE'),
  has_table_privilege('anon','public.site_visitor_events','SELECT,INSERT,UPDATE,DELETE'),
  has_table_privilege('authenticated','public.site_visitors','SELECT,INSERT,UPDATE,DELETE');
SQL
)"
echo "ANALYTICS_BOUNDARY=$analytics_boundary"
test "$analytics_boundary" = 't|t|t|f|f|f|f'
echo 'RESULT=V812AB_ANALYTICS_BOUNDARY_PASS'

# Deep-live fixtures.
suffix="${GITHUB_RUN_ID}${GITHUB_RUN_ATTEMPT}"
DEEP_PLAYER1_NAME="V812DeepA_${suffix}"
DEEP_PLAYER2_NAME="V812DeepB_${suffix}"
export DEEP_PLAYER1_NAME DEEP_PLAYER2_NAME
pin1='4826'; pin2='7314'
echo "::add-mask::$pin1"; echo "::add-mask::$pin2"
timeout 25s psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -v n1="$DEEP_PLAYER1_NAME" -v n2="$DEEP_PLAYER2_NAME" -v p1="$pin1" -v p2="$pin2" <<'SQL'
insert into public.players(slug,display_name,active,pin_hash,approved,hidden_from_public,is_dummy,site_scope)
values
  ('v812-cert-a-'||lower(:'n1'),:'n1',true,'md5:'||md5(:'p1'||':'||current_database()),true,true,true,'friends'),
  ('v812-cert-b-'||lower(:'n2'),:'n2',true,'md5:'||md5(:'p2'||':'||current_database()),true,true,true,'friends');
SQL
sessions="$(timeout 25s psql "$SUPABASE_DB_URL" -X -At -F'|' -v ON_ERROR_STOP=1 -v n1="$DEEP_PLAYER1_NAME" -v n2="$DEEP_PLAYER2_NAME" -v p1="$pin1" -v p2="$pin2" <<'SQL'
select public.account_login_v687(:'n1',:'p1','friends','{"proof":"v812ab-final-cert"}'::jsonb)->>'session_token',
       public.account_login_v687(:'n2',:'p2','friends','{"proof":"v812ab-final-cert"}'::jsonb)->>'session_token';
SQL
)"
IFS='|' read -r DEEP_PLAYER1_TOKEN DEEP_PLAYER2_TOKEN <<< "$sessions"
[[ "$DEEP_PLAYER1_TOKEN" =~ ^[0-9a-f]{48}$ && "$DEEP_PLAYER2_TOKEN" =~ ^[0-9a-f]{48}$ ]]
echo "::add-mask::$DEEP_PLAYER1_TOKEN"; echo "::add-mask::$DEEP_PLAYER2_TOKEN"
export DEEP_PLAYER1_TOKEN DEEP_PLAYER2_TOKEN
echo 'RESULT=V812AB_DEEP_FIXTURES_PASS'

python3 <<'PY'
from pathlib import Path
src=Path('scripts/final-cert-live-browser-v792.mjs').read_text()
src=src.replace('v792','v812').replace('V792','V812')
src=src.replace("chromium.launch({ headless: true })", "chromium.launch({ headless: true, executablePath: process.env.GEJAST_SYSTEM_CHROME })")
src=src.replace("const timeout = Number(process.env.GEJAST_BROWSER_TIMEOUT_MS || 20000);", "const timeout = Number(process.env.GEJAST_BROWSER_TIMEOUT_MS || 20000);\nconst certAnalyticsVisitorId = String(process.env.GEJAST_CERT_ANALYTICS_VISITOR_ID || '').trim();")
src=src.replace("await context.addInitScript(({ tokenValue, paardCode }) => {", "await context.addInitScript(({ tokenValue, paardCode, analyticsVisitorId }) => {\n    if (analyticsVisitorId) localStorage.setItem('gejast_visitor_id_v2', analyticsVisitorId);")
src=src.replace("}, { tokenValue: token, paardCode: state.paardenCode });", "}, { tokenValue: token, paardCode: state.paardenCode, analyticsVisitorId: certAnalyticsVisitorId });")
old="""  await page.waitForTimeout(900);\n  if (/login\\.html/i.test(page.url())) throw new Error(`${label} unexpectedly redirected to login`);\n  const body = (await page.locator('body').innerText()).trim();"""
new="""  await page.waitForFunction(() => {\n    const root=document.documentElement;\n    const primary=root.getAttribute('data-gejast-auth-state');\n    const legacySettled=!root.classList.contains('gejast-auth-pending');\n    return /login\\.html/i.test(location.pathname) || (primary === 'authenticated' && legacySettled);\n  }, null, { timeout });\n  if (/login\\.html/i.test(page.url())) throw new Error(`${label} unexpectedly redirected to login`);\n  await page.waitForTimeout(150);\n  const body = (await page.locator('body').innerText()).trim();"""
if old not in src: raise SystemExit('deep auth-settle patch target missing')
src=src.replace(old,new,1)
if 'analyticsVisitorId: certAnalyticsVisitorId' not in src: raise SystemExit('deep analytics visitor patch failed')
if 'executablePath: process.env.GEJAST_SYSTEM_CHROME' not in src: raise SystemExit('system Chrome patch failed')
Path('scripts/v812ab-final-cert-deep.mjs').write_text(src)
PY
node --check scripts/v812ab-final-cert-deep.mjs
export GEJAST_PLAYER1_NAME="$DEEP_PLAYER1_NAME"
export GEJAST_PLAYER2_NAME="$DEEP_PLAYER2_NAME"
export GEJAST_PLAYER1_TOKEN="$DEEP_PLAYER1_TOKEN"
export GEJAST_PLAYER2_TOKEN="$DEEP_PLAYER2_TOKEN"
export GEJAST_BROWSER_TIMEOUT_MS=25000
node scripts/v812ab-final-cert-deep.mjs
echo 'RESULT=V812AB_DEEP_LIVE_PASS'

deep_sessions="$(timeout 25s psql "$SUPABASE_DB_URL" -X -At -F'|' -v ON_ERROR_STOP=1 -v t1="$DEEP_PLAYER1_TOKEN" -v t2="$DEEP_PLAYER2_TOKEN" <<'SQL'
with s as (
  select public.account_public_state_v687(:'t1',:'t1','friends') a,
         public.account_public_state_v687(:'t2',:'t2','friends') b
)
select coalesce(a->>'ok','false'),coalesce(b->>'ok','false') from s;
SQL
)"
test "$deep_sessions" = 'true|true'
echo 'RESULT=V812AB_DEEP_POST_GAME_SESSIONS_PASS'
cleanup_deep
deep_residue="$(timeout 25s psql "$SUPABASE_DB_URL" -X -At -F'|' -v ON_ERROR_STOP=1 -v n1="$DEEP_PLAYER1_NAME" -v n2="$DEEP_PLAYER2_NAME" <<'SQL'
select
 (select count(*) from public.players where display_name in (:'n1',:'n2')),
 (select count(*) from public.gejast_player_sessions_v746 where display_name in (:'n1',:'n2')),
 (select count(*) from public.gejast_active_player_metadata_v679 where lower(coalesce(player_name,'')) in (lower(:'n1'),lower(:'n2'))),
 (select count(*) from public.klaverjas_online_games where created_by_player_name in (:'n1',:'n2')),
 (select count(*) from public.pikken_games where created_by_player_name in (:'n1',:'n2')),
 (select count(*) from public.paardenrace_rooms where host_name in (:'n1',:'n2')),
 (select count(*) from public.paardenrace_match_history where coalesce(summary_payload::text,'') like '%'||:'n1'||'%' or coalesce(summary_payload::text,'') like '%'||:'n2'||'%');
SQL
)"
test "$deep_residue" = '0|0|0|0|0|0|0'
echo 'RESULT=V812AB_DEEP_ZERO_RESIDUE_PASS'

# Friends + Family visual fixtures.
node scripts/full-live-visual-fixtures-v801.mjs provision
VISUAL_PROVISIONED=1
load_visual_env
for key in GEJAST_PLAYER1_NAME GEJAST_PLAYER2_NAME GEJAST_FAMILY_NAME GEJAST_PLAYER1_TOKEN GEJAST_PLAYER2_TOKEN GEJAST_FAMILY_TOKEN; do
  test -n "${!key:-}" || { echo "Missing visual env $key"; exit 1; }
done

git fetch origin proof/v810-runtime-contract
git show origin/proof/v810-runtime-contract:scripts/v810-runtime-contract-live-proof.mjs > scripts/v812ab-runtime-contract-live-proof.mjs
python3 <<'PY'
from pathlib import Path
p=Path('scripts/v812ab-runtime-contract-live-proof.mjs')
s=p.read_text().replace('v810','v812').replace('V810','V812')
s=s.replace("const diagnosticNames=new Set(['track_site_event','get_public_player_unified_scoped','get_homepage_boot_bundle_scoped','save_game_match_summary']);", "const diagnosticNames=new Set(['track_site_event','get_public_player_unified_scoped','get_public_shared_player_stats_scoped','get_public_player_game_insights_scoped','get_homepage_boot_bundle_scoped','save_game_match_summary']);")
s=s.replace("['get_all_pending_drink_event_verifications_public','get_drink_event_vote_queue_public','get_public_state']", "['get_all_pending_drink_event_verifications_public','get_drink_event_vote_queue_public','get_public_state','get_public_player_unified_scoped']")
s=s.replace("['account_public_state_v687','get_drinks_page_public','get_player_site_announcements_scoped','get_player_runtime_bundle_v687']", "['account_public_state_v687','get_drinks_page_public','get_player_site_announcements_scoped','get_player_runtime_bundle_v687','track_site_event','get_public_shared_player_stats_scoped','get_public_player_game_insights_scoped']")
s=s.replace("new Set(['get_all_pending_drink_event_verifications_public','get_drink_event_vote_queue_public','get_public_state','get_player_site_announcements_scoped','get_player_runtime_bundle_v687'])", "new Set(['get_all_pending_drink_event_verifications_public','get_drink_event_vote_queue_public','get_public_state','get_public_player_unified_scoped','get_player_site_announcements_scoped','get_player_runtime_bundle_v687','track_site_event','get_public_shared_player_stats_scoped','get_public_player_game_insights_scoped'])")
s=s.replace("await context.addInitScript(({sessionToken,siteScope})=>{", "await context.addInitScript(({sessionToken,siteScope,analyticsVisitorId})=>{ if(analyticsVisitorId) localStorage.setItem('gejast_visitor_id_v2',analyticsVisitorId);")
s=s.replace("},{sessionToken:token,siteScope:scope});", "},{sessionToken:token,siteScope:scope,analyticsVisitorId:process.env.GEJAST_CERT_ANALYTICS_VISITOR_ID||''});")
if "analyticsVisitorId:process.env.GEJAST_CERT_ANALYTICS_VISITOR_ID" not in s: raise SystemExit('runtime analytics visitor patch missing')
p.write_text(s)
PY
node --check scripts/v812ab-runtime-contract-live-proof.mjs
export GEJAST_WARNING_PROOF_TIMEOUT_MS=25000
export GEJAST_WARNING_PROOF_SETTLE_MS=4500
node scripts/v812ab-runtime-contract-live-proof.mjs
echo 'RESULT=V812AB_RUNTIME_CONTRACT_PASS'

# Strong visual scan: destination state must settle before the scanner itself passes.
node scripts/prepare-visual-audit-runtime-v812.mjs
python3 <<'PY'
from pathlib import Path
p=Path('scripts/full-live-visual-audit-v792.mjs')
s=p.read_text()
s=s.replace("await context.addInitScript(({ sessionToken, savedPaardCode }) => {", "await context.addInitScript(({ sessionToken, savedPaardCode, analyticsVisitorId }) => {\n    if (analyticsVisitorId) localStorage.setItem('gejast_visitor_id_v2', analyticsVisitorId);")
s=s.replace("}, { sessionToken: tokenValue, savedPaardCode: paardCode });", "}, { sessionToken: tokenValue, savedPaardCode: paardCode, analyticsVisitorId: process.env.GEJAST_CERT_ANALYTICS_VISITOR_ID || '' });")
if 'analyticsVisitorId: process.env.GEJAST_CERT_ANALYTICS_VISITOR_ID' not in s: raise SystemExit('visual analytics visitor patch missing')
p.write_text(s)
PY
node --check scripts/full-live-visual-audit-v792.mjs
export GEJAST_VISUAL_TIMEOUT_MS=25000
export GEJAST_VISUAL_SETTLE_MS=5000
node scripts/full-live-visual-audit-v792.mjs
node scripts/refine-expected-visual-aliases-v809.mjs
node --input-type=module <<'JS'
import fs from 'node:fs';
const r=JSON.parse(fs.readFileSync('visual-audit/report.json','utf8'));
const rows=Array.isArray(r.records)?r.records:(Array.isArray(r.routes)?r.routes:[]);
const broken=rows.filter(x=>String(x.judgement||x.status||'').toLowerCase()==='broken');
const warn=rows.filter(x=>String(x.judgement||x.status||'').toLowerCase()==='warn');
console.log(`RESULT=V812AB_VISUAL_REPORT records=${rows.length} broken=${broken.length} warn=${warn.length}`);
if(broken.length){ console.error(JSON.stringify(broken.slice(0,10),null,2)); process.exit(1); }
fs.mkdirSync('certification-evidence',{recursive:true});
fs.writeFileSync('certification-evidence/visual-summary.json',JSON.stringify({records:rows.length,broken:broken.length,warn:warn.length,warnings:warn.map(x=>({route:x.route||x.label||'',reasons:x.reasons||[]}))},null,2)+'\n');
JS
echo 'RESULT=V812AB_VISUAL_AUDIT_PASS'

cleanup_visual
cleanup_analytics

# Independent full residue sweep including analytics and match history.
final_residue="$(timeout 30s psql "$SUPABASE_DB_URL" -X -At -F'|' -v ON_ERROR_STOP=1 -v d1="$DEEP_PLAYER1_NAME" -v d2="$DEEP_PLAYER2_NAME" -v v1="$GEJAST_PLAYER1_NAME" -v v2="$GEJAST_PLAYER2_NAME" -v vf="$GEJAST_FAMILY_NAME" -v av="$GEJAST_CERT_ANALYTICS_VISITOR_ID" <<'SQL'
select
 (select count(*) from public.players where display_name in (:'d1',:'d2',:'v1',:'v2',:'vf')),
 (select count(*) from public.gejast_player_sessions_v746 where display_name in (:'d1',:'d2',:'v1',:'v2',:'vf')),
 (select count(*) from public.gejast_active_player_metadata_v679 where lower(coalesce(player_name,'')) in (lower(:'d1'),lower(:'d2'),lower(:'v1'),lower(:'v2'),lower(:'vf'))),
 (select count(*) from public.klaverjas_online_games where created_by_player_name in (:'d1',:'d2',:'v1',:'v2',:'vf')),
 (select count(*) from public.pikken_games where created_by_player_name in (:'d1',:'d2',:'v1',:'v2',:'vf')),
 (select count(*) from public.paardenrace_rooms where host_name in (:'d1',:'d2',:'v1',:'v2',:'vf')),
 (select count(*) from public.paardenrace_match_history where coalesce(summary_payload::text,'') like '%'||:'d1'||'%' or coalesce(summary_payload::text,'') like '%'||:'d2'||'%' or coalesce(summary_payload::text,'') like '%'||:'v1'||'%' or coalesce(summary_payload::text,'') like '%'||:'v2'||'%' or coalesce(summary_payload::text,'') like '%'||:'vf'||'%'),
 (select count(*) from public.site_visitor_events where visitor_id=:'av' or player_name in (:'d1',:'d2',:'v1',:'v2',:'vf')),
 (select count(*) from public.site_visit_sessions where visitor_id=:'av' or player_name in (:'d1',:'d2',:'v1',:'v2',:'vf')),
 (select count(*) from public.site_visitors where visitor_id=:'av' or player_name in (:'d1',:'d2',:'v1',:'v2',:'vf'));
SQL
)"
echo "FINAL_RESIDUE=$final_residue"
test "$final_residue" = '0|0|0|0|0|0|0|0|0|0'

# No historical certification analytics residue may remain either.
historical_analytics="$(timeout 25s psql "$SUPABASE_DB_URL" -X -At -v ON_ERROR_STOP=1 <<'SQL'
select count(*) from public.site_visitor_events where coalesce(player_name,'') ~ '^(VisualA_|VisualB_|VisualFamily_|V812Deep[AB]_)';
SQL
)"
test "$historical_analytics" = '0'
echo 'RESULT=V812AB_INDEPENDENT_ZERO_RESIDUE_PASS'

mkdir -p certification-evidence
cat > certification-evidence/automated-summary.txt <<EOF
RESULT=V812AB_FINAL_CERTIFICATION_AUTOMATED_PASS
product_sha=$PRODUCT_SHA
product_version=v812
run_id=$GITHUB_RUN_ID
run_attempt=$GITHUB_RUN_ATTEMPT
analytics_boundary=t|t|t|f|f|f|f
final_residue=$final_residue
EOF

echo 'RESULT=V812AB_FINAL_CERTIFICATION_AUTOMATED_PASS'
trap - EXIT
