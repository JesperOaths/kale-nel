# GEJAST family/friend split blueprint v309

This is a blueprint only. It is **not** the live split itself.

## Goal
Separate the current GEJAST platform into:
- friendgroup site: current full feature set
- family site: login, profiles, klaverjassen, boerenbridge, related stats/admin flows
- no cross-interaction between the two userbases

## Safest implementation model
Use one Supabase project with a hard site-scope/tenant key carried through tables, views, and RPCs.

Recommended tenant values:
- `friends`
- `family`

## What must be split
- players / account requests / reserved names / sessions
- activation flow / login flow
- profiles / profile lookups
- canonical match history and derived stats
- ladders and homepage aggregates
- admin pages and admin RPCs
- mail jobs and templates where needed
- push subscriptions and presence

## What family site excludes
- drinks pages
- drink RPCs/views
- beerpong pages
- beerpong RPCs/stats

## Concrete backend work needed
1. Add `site_scope` to player/account/session/request tables and related unique indexes.
2. Add `site_scope` to canonical match/game tables or ensure every match row resolves to scoped players only.
3. Patch login/activation/request RPCs so they always read/write the requested scope.
4. Patch all public/player/admin aggregate RPCs to filter by scope.
5. Add separate config/domain entry points, for example:
   - `kalenel.nl` -> friends
   - `familie.kalenel.nl` -> family
6. Remove family access to drinks/beerpong pages in navigation and direct guards.
7. Create migration/backfill script assigning existing current users to `friends` by default, then explicitly migrate family accounts.

## Frontend shape
- shared codebase can stay mostly intact
- add `SITE_SCOPE` in config per deployment
- pages pass scope into request/login/profile flows
- family deployment hides drinks and beerpong routes/cards

## Recommended rollout
1. backend tenant columns + RPC patching
2. staging validation with copied test accounts
3. family domain/frontend config
4. migrate family accounts
5. verify no cross-surface leakage
6. only then expose publicly

## Important warning
This should not be hacked as a visual-only split. It must be enforced in backend RPCs and data access or accounts and stats can bleed between both sites.
