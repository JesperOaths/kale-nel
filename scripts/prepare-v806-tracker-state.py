from pathlib import Path
import json

p = Path('gameplay-acceptance.json')
data = json.loads(p.read_text())
data['site_version'] = 'v806'
data['last_updated'] = '2026-08-18'

games = {row.get('id'): row for row in data.get('games', [])}
toepen = games.get('toepen')
if toepen is None:
    raise SystemExit('gameplay tracker missing Toepen owner')
toepen['live_status'] = 'owner_isolation_and_persistence_proven'
toepen['live_evidence'] = (
    'Production migration 20260818001412 (v801a) is deployed. Public REST proof run 32084142660 '
    'proved first save plus same-owner idempotent replay, cross-owner rejection, invalid-session rejection '
    'and wrong-scope rejection with zero controlled residue. Post-mutation health 32084207898 and deep-live '
    'run 32085432145 passed; the deep run also revalidated authenticated Toepen desktop/mobile route behavior '
    'alongside the wider gameplay campaign.'
)
toepen['remaining_gap'] = (
    'No Toepen owner/session/scope production blocker remains. The deterministic shipped engine remains the '
    '2-8 player completion authority; fresh v806 release-wide browser revalidation is tracked by '
    'release-certification.json rather than represented as an unresolved Toepen backend defect.'
)

# Preserve the freshest certified v805 live browser evidence for the two games whose
# natural-completion claims are explicitly two-player scoped.
for game_id, label in [('pikken', 'Pikken'), ('paardenrace', 'Paardenrace')]:
    row = games.get(game_id)
    if row is None:
        raise SystemExit(f'gameplay tracker missing {game_id}')
    prior = str(row.get('live_evidence') or '')
    current = (
        f'Exact-v805 post-v801a deep-live run 32085432145 revalidated authenticated multi-context/mobile '
        f'{label} routing, reconnect/state reread and natural two-player completion; post-game sessions stayed '
        f'valid and controlled cleanup was zero residue. '
    )
    if not prior.startswith('Exact-v805 post-v801a deep-live run 32085432145'):
        row['live_evidence'] = current + prior

p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
print('v806 gameplay acceptance tracker synchronized')
