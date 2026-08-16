from pathlib import Path
import json

ROOT='v801'
MAIN_SHA='66e6f7ad13c1360a1eadfdd528acdb4290957e43'
FRONTEND_SHA='d5388341c5ca0a595f80f239ebb5cafa84b6af60'

# Certification remains fail-closed while recording current evidence.
p=Path('release-certification.json')
r=json.loads(p.read_text())
r['current_version']=ROOT
r['status']='REVALIDATION_REQUIRED'
r['reason']=(
    'Exact-v801 Phase 1 and Phase 2 revalidation are complete: full visual audit, forced-login/auth scope isolation, '
    'real PIN login, authenticated game surfaces, two-human Klaverjas, natural Pikken and Paardenrace completion with '
    'reconnect/persistence rereads, and isolated Klaverjas transition/rules/persistence/roem/recovery PostgreSQL proofs. '
    'Phase 2 also live-proved one remaining production backend authorization defect: an unrelated authenticated Friends '
    "player can replay another player's Toepen client_match_id and receive the existing game_id. SQL-only v801a is "
    'merged and rollback-proven against the production schema, but is deliberately not deployed to Supabase without '
    'explicit authorization. Certification remains fail-closed until v801a is authorized/applied and fresh post-deploy '
    'owner-isolation plus deep live regression evidence passes.'
)
r['current_evidence']={
    'frontend_version':'v801','frontend_merge':FRONTEND_SHA,'audited_repository_head':MAIN_SHA,
    'full_visual_audit_run':31943987257,'phase1_live_auth_gameplay_run':31944683360,
    'phase2_deep_live_run':31952351394,'toepen_owner_defect_control_run':31952921912,
    'v801a_rollback_only_schema_proof_run':31953380650,'postmerge_live_health_run':31953491375,
    'klaverjas_postgres_persistence_run':31953687334,'klaverjas_postgres_roem_run':31953687328,
    'klaverjas_postgres_recovery_run':31953687352
}
r['required_next']=[
    'Obtain explicit authorization before applying GEJAST_v801a_toepen_idempotency_owner_guard.sql to production Supabase.',
    'After deployment, prove same-owner Toepen idempotency still returns the same game while unrelated-owner, invalid-session and wrong-scope replay fail closed, with zero residue.',
    'Rerun exact-current live health and the deep Phase-2 gameplay campaign after the backend mutation before considering PASS.'
]
p.write_text(json.dumps(r,indent=2,ensure_ascii=False)+'\n')

# Gameplay acceptance stays schema v2; strengthen evidence without violating the existing classification contract.
p=Path('gameplay-acceptance.json')
g=json.loads(p.read_text())
g['version']=2
g['site_version']=ROOT
g['last_updated']='2026-08-16'
games={x['id']:x for x in g['games']}

x=games['toepen']
x['live_status']='owner_isolation_defect_proven_fix_requires_authorization'
x['live_evidence']=(
    'Exact-v801 live owner-control run 31952921912 saved a structurally valid completed Toepen match, confirmed '
    'invalid-session denial, and proved an unrelated authenticated Friends player can replay the creator\'s '
    'client_match_id and receive already_saved=true with the foreign game_id. The foreign game is not mutated. '
    'SQL-only v801a is merged and rollback-proven but not deployed.'
)
x['remaining_gap']='Authorize and deploy v801a, then rerun same-owner idempotency, unrelated-owner denial, invalid-session/wrong-scope denial, totals consistency and zero-residue proof.'

x=games['boerenbridge']
x['live_evidence']=(
    'Historical controlled production persistence/vault proof remains valid. Exact-v801 owner-control run 31952921912 '
    'additionally proves an unrelated authenticated player cannot replay another owner\'s client_match_id. The '
    'deterministic 18-round engine matrix remains the full-match authority for all supported player counts.'
)
x=games['beerpong']
x['live_evidence']=(
    'Historical controlled production save proof remains valid. Exact-v801 owner-control run 31952921912 additionally '
    'proves unrelated-player client_match_id replay is rejected. This is persistence/authorization proof, not a full '
    'multi-device cup-by-cup browser playthrough claim.'
)

x=games['pikken']
x['live_status']='two_player_natural_completion_reconnect_proven'
x['live_evidence']=(
    'Exact-v801 Phase-2 deep live run 31952351394 used disposable authenticated identities and multiple browser contexts '
    'to create/join/start Pikken, exercise reconnect/state reread, naturally reach terminal completion, persist/reread '
    'the winner and completed state, and clean all controlled fixtures to zero residue.'
)
# Preserve exact grounded-minimum/unknown-maximum wording required by the durable contract.
x['remaining_gap']=(
    'The exact checked-in Pikken start RPC and deployed provenance ground the minimum at 2. Phase-2 now proves natural '
    'two-player completion, but no authoritative room/join constraint proves a maximum player count, so the maximum '
    'remains unknown and higher player-count live completion is not inferred.'
)

x=games['paardenrace']
x['live_status']='two_player_natural_completion_reconnect_proven'
x['live_evidence']=(
    'Exact-v801 Phase-2 deep live run 31952351394 used disposable authenticated identities and multiple browser contexts '
    'to create/join/start Paardenrace, exercise reconnect/state reread and nominations, naturally reach terminal '
    'completion, persist/reread terminal state, and clean all controlled fixtures to zero residue.'
)
x['remaining_gap']=(
    'The exact checked-in Paardenrace start RPC and shipped lobby ground the minimum at 2. Phase-2 now proves natural '
    'two-player completion, but no authoritative room/join/schema constraint proves a maximum human room size; higher '
    'player-count live completion is not inferred from the four horse suits.'
)

x=games['klaverjas_online']
# Keep established live classification and phrases because they are still true, then append current evidence.
x['deterministic_status']='repository_postgres_proven'
x['deterministic_evidence']=(
    'v792b-v792h transition, rule, persistence, roem-wrapper and hidden recovery-hand guards remain covered by static '
    'proof and are applied in production. On current v801 repository state, isolated PostgreSQL runs 31953687334, '
    '31953687328 and 31953687352 recompiled/reproved transition/rules/persistence, forged-input-resistant finished '
    'persistence/player stats, roem calculations/privilege isolation, and hidden recovery-hand rehydration/private RPC boundaries.'
)
x['live_status']='two_player_room_lifecycle_proven'
x['live_evidence']=(
    'Production v792b-v792h is applied. On 2026-08-16 a controlled production smoke used two randomized disposable '
    'player sessions to create a zero-bot room, join a second human, read state independently as both viewers, close the '
    'room as host, and physically remove room/session/player fixtures; post-cleanup counts were zero. Exact-v801 Phase-1 '
    'run 31944683360 again created a two-human room with distinct seats, and Phase-2 deep run 31952351394 exercised '
    'multi-context Klaverjas state/reconnect behavior. No full four-human production play-to-completion claim is made.'
)
x['remaining_gap']=(
    'No backend/frontend gap remains for the controlled two-human room lifecycle. Full four-seat rules/completion are '
    'covered by deterministic and isolated PostgreSQL acceptance; a full four-human production browser completion remains unclaimed.'
)
p.write_text(json.dumps(g,indent=2,ensure_ascii=False)+'\n')

# Beta tracker: actual live v801 identity + one explicit unarmed Toepen permission blocker.
p=Path('beta-readiness.json')
b=json.loads(p.read_text())
b['version']=8
b['site_version']='live v801 / current frontend release v801'
b['last_updated']='2026-08-16'
d=b['deployment_identity']
d['status']='verified_complete'; d['live_version']='v801'; d['frontend_release_merge']=FRONTEND_SHA
d['repository_head_at_audit']=MAIN_SHA; d['release_candidate_version']=''
fresh=[
    '2026-08-16 live v801: Phase-1 auth/gameplay run 31944683360 PASS with logged-out invisibility, invalid-token cleanup, real PIN login-to-main, seven authenticated game surfaces, Friends/Family isolation, two-human Klaverjas and zero residue.',
    '2026-08-16 live v801: Phase-2 deep run 31952351394 PASS with multi-context/mobile/reconnect coverage plus natural Pikken and Paardenrace completion/persistence rereads and zero residue.',
    '2026-08-16 repository head 66e6f7ad13c1360a1eadfdd528acdb4290957e43: live deployment health run 31953491375 PASS; SQL-only v801a migration record does not change frontend VERSION or deploy the production function.'
]
for item in reversed(fresh):
    if item not in d['evidence']: d['evidence'].insert(0,item)
d['note']=(
    '2026-08-16 live v801 PASS for deployment identity and current frontend health: exact-v801 visual/auth/game evidence '
    'is current, and SQL-only repository head 66e6f7ad13c1360a1eadfdd528acdb4290957e43 leaves frontend VERSION at v801. '
    'Historical Chromium/axe proof remains zero total axe violations; isolated no-write live mobile Chromium proof remains '
    'preserved with non-GET requests intercepted locally, no Drinks stats-queue ReferenceError, >=44px Drinks controls and '
    '>=24px scoped Beerpong/Pussycup targets. This deployment identity PASS does not mean release certification PASS: '
    'exact-v801 Phase 2 found a Toepen owner-replay defect and merged v801a remains deliberately undeployed pending explicit authorization.'
)
for check in b['baseline_checks']:
    if check['id']=='live_routes':
        check['evidence']='2026-08-16 live v801 deployment health run 31953491375 PASS on SQL-only repository head 66e6f7ad13c1360a1eadfdd528acdb4290957e43; public VERSION remains v801 and the protected admin perimeter is healthy. '+check['evidence']
    elif check['id']=='game_surface':
        check['evidence']='2026-08-16 exact-v801 Phase-2 deep run 31952351394 proves natural two-player Pikken and Paardenrace completion with reconnect/persistence rereads; Phase-1 run 31944683360 proves two-human Klaverjas and all authenticated game surfaces. '+check['evidence']
    elif check['id']=='live_write_safety_gate':
        check['evidence']='The live-write checklist remains fully disarmed with zero automated mutation targets. One live-proven Toepen backend repair is explicitly permission-gated and not armed; v801a requires separate human authorization before production deployment.'
for gap in b['beta_gaps']:
    if gap['id']=='toepen_backend_live':
        gap['status']='needs_permission'
        gap['proof_needed']='Current live blocker: exact-v801 run 31952921912 proved unrelated authenticated same-scope client_match_id replay returns a foreign existing Toepen game_id. v801a is merged and rollback-proven against the production schema but not deployed.'
        gap['next_action']='With explicit authorization, apply GEJAST_v801a_toepen_idempotency_owner_guard.sql to production Supabase, then rerun same-owner idempotency, unrelated-owner denial, invalid-session/wrong-scope denial, totals guard, deep gameplay regression and zero-residue checks.'
        gap['latest_probe']='2026-08-16: owner-control run 31952921912 proved the live defect and Boerenbridge/Beerpong controls; rollback-only v801a production-schema run 31953380650 passed owner/session/scope/totals assertions and proved production remained untouched after rollback.'
p.write_text(json.dumps(b,indent=2,ensure_ascii=False)+'\n')

# Current readiness checker: fail if the repository falsely returns to 12/12 before production repair is deployed.
p=Path('check-beta-readiness-current-v770d.mjs')
s=p.read_text()
start=s.index('const gaps = new Map(')
end=s.index("if (!extended.includes", start)
replacement="""const gaps = new Map((tracker.beta_gaps || []).map((item) => [item.id, item]));
for (const id of [
  'real_device_push_delivery','admin_host_security','scope_isolation','analytics_observability',
  'profile_editing','secondary_game_save_flows','badge_awards','admin_mutations','drinks_create_verify_reject',
  'boerenbridge_admin_contracts','stats_elo_predictions'
]) if (gaps.get(id)?.status !== 'verified_complete') failures.push(`${id} must remain verified_complete at current beta readiness`);
const toepenGap = gaps.get('toepen_backend_live');
if (toepenGap?.status !== 'needs_permission') failures.push('toepen_backend_live must remain explicitly needs_permission until the live-proven v801a repair is authorized and deployed');
if (!/v801a/i.test(String(toepenGap?.next_action || ''))) failures.push('Toepen permission blocker must name the v801a deployment action');
const blocked = [...gaps.values()].filter((item) => item.status === 'blocked_external');
const permission = [...gaps.values()].filter((item) => item.status === 'needs_permission');
const permissionIds = permission.map((item) => item.id).sort();
if (blocked.length) failures.push(`tracker unexpectedly has blocked_external gaps: ${blocked.map((item) => item.id).join(', ')}`);
if (JSON.stringify(permissionIds) !== JSON.stringify(['toepen_backend_live'])) failures.push(`expected only Toepen to be permission-gated, got: ${permissionIds.join(', ') || '(none)'}`);
const completeCount = [...gaps.values()].filter((item) => item.status === 'verified_complete').length;
if (completeCount !== 11 || permission.length !== 1) failures.push(`expected current readiness split 11 complete / 1 permission-gated, got ${completeCount} / ${permission.length}`);

"""
p.write_text(s[:start]+replacement+s[end:])

# Live-write safety: exactly one permission blocker, but still zero armed mutation targets.
p=Path('check-live-write-safety-v770e.mjs')
s=p.read_text()
s=s.replace(
    "if(permissionIds.length!==0) failures.push('finalized readiness must expose zero permission-gated gaps');",
    "if(JSON.stringify(permissionIds)!==JSON.stringify(['toepen_backend_live'])) failures.push('current readiness must expose only the unarmed Toepen v801a permission blocker');\nconst toepenPermission=(readiness.beta_gaps||[]).find((item)=>item.id==='toepen_backend_live');\nif(!/v801a/i.test(String(toepenPermission?.next_action||''))) failures.push('Toepen permission blocker must name v801a');\nif(checklistIds.includes('toepen_backend_live')) failures.push('Toepen v801a must remain unarmed until explicit production authorization');"
)
s=s.replace(
    "console.log(`Live-write beta safety v771e PASS at ${rootVersion}: beta readiness is 12/12, no mutation target is armed, and the completed Drinks write command is disarmed.`);",
    "console.log(`Live-write beta safety v771e PASS at ${rootVersion}: one explicit Toepen v801a permission blocker is unarmed, no mutation target is armed, and the completed Drinks write command is disarmed.`);"
)
p.write_text(s)
