## Public browser workspace

`/league/` is a public application surface and must not depend on the Kalenel player-login gate.

Each browser receives a random local Bruisienator workspace identifier. The backend hashes that identifier into an isolated internal owner ID, so saved League profiles, match cache rows and reports remain separated between browsers without requiring a Kalenel account.

Security boundary:
- anonymous/public workspaces never inherit the private server-side Riot API key,
- Fetch / update requires the visitor to supply a Riot key in the existing session-only field,
- that Riot key is sent only in the request header and is not written to the profile, report, browser workspace ID or repository,
- legacy authenticated access can remain backend-compatible, but the public `/league/` frontend must not load `gejast-auth-gate.js`, `gejast-home-gate.js` or call `requireMatchEntrySession`.

This keeps the analysis page publicly usable without turning the site's private Riot credential into a public API proxy.

Public resource bounds:
- workspace identifiers must be cryptographically random UUIDv4 or `lw1_` random-hex capability tokens,
- up to 8 profiles per anonymous workspace,
- up to 100 matches requested per public fetch,
- retain at most 100 recent cached matches per profile,
- retain at most 25 analysis runs and 20 fetch-run records per profile.

Public profile deletion is owner-scoped to the current browser workspace. Deleting a profile cascades through its match cache, fetch runs and analysis rows via the existing foreign-key relationships, so the profile cap does not strand stale data.

These limits are storage/service hygiene rather than coaching rules. They do not apply to legacy authenticated internal workspaces.

# Bruisienator web analysis model

## Habit review and result-independent learning

`league/learning-review.js` reconstructs the learning review from the report's preserved per-game evidence, so current and compact saved reports use the same calculations. It does not make an additional Riot request or require a backend schema change. Exports include the derived `learningReview` with its own model version.

Selected role and any applied mechanics cohort are filtered before measuring habits. Matches are deduplicated by ID, unknown/ambiguous roles are excluded, and timeline measurements require Summoner's Rift with explicit timeline availability. The review does not use match-only history as behavioral evidence.

Each habit exposes affected/eligible games, the mean of supported within-game rates, and the separate pooled event numerator/denominator. Missing fields and absent opportunities are excluded, never treated as observed zeros. Three supported games and five opportunities are required for the result review; first-reset and lead-window habits require three opportunities, and measured support-roam lane movement requires four. These are display coverage minimums, not significance thresholds or a skill score.

Shared habits cover risky/costly repeated deaths (union, without double counting), absent contested encounters after a death within 75 seconds, active fights with at least 1,000g stored, deaths before tracked kill/assist contribution, and post-kill windows without either supported personal or team-context conversion. Carry roles additionally expose clean measured first resets and eligible early lead givebacks. Support exposes costly empty roams using measured allied-ADC lane movement. Jungle exposes outnumbered active combat starts with known nearby numbers. Every cue retains its observational limits and a replay question.

Flagged examples use the highest observed within-game rate. Reference examples require supported exposure with no instance of that specific flag, the same queue, known matching game rules/role-quest revision, and an uncompromised final outcome; same-champion references are preferred. They are examples rather than matched causal controls. The absence of one flag is never labeled globally good play.

The result matrix separates wins/losses with tracked cues from wins/losses without cues. Only habits meeting the display minimum participate. A no-cue group requires at least three measured habits in that game; other no-cue games enter limited coverage. Only explicit `outcomeCompromised: false` and boolean results enter result groups, so AFK, early-surrender and unverified outcomes cannot inflate win-rate comparisons. Per-habit outcome comparisons need at least three uncompromised games in both groups and remain descriptive.

Repeated habit pairs require at least three shared affected games with evidence for both habits. They describe co-occurrence within a game, never an event chain or causal relationship. Opportunity counts across habits are not summed because flags can overlap.

This file is the behavioral-analysis contract for `kalenel.nl/league`.

The purpose of the web analyzer is not to produce a decorative stat page. It should identify repeatable player decisions, show the evidence behind a judgment, compare the player with relevant peers and with their own broader history, and turn those findings into specific actions to practise.

## Saved Riot profile workflow

The historical desktop wrapper is not exposed as a second browser control plane. The public page keeps Riot identity and analysis history inside the ordinary one-click request flow.

The request card contains Riot game name, tag, region, selected analysis role and the session-only Riot API key. A run reuses an existing saved profile for the same Riot identity or creates one server-backed League profile, fetches only the missing bounded Riot data, then stores a report for the selected role.

A saved-profile selector reopens that Riot identity later. Browser persistence is limited to the anonymous workspace capability and selected profile-slot pointer; Riot identity, match cache and reports remain server-side. The Riot API key is never persisted.

Legacy recent-request scratch identities are migrated in place when possible so cached matches are not cloned or discarded. A database uniqueness guard prevents duplicate saved rows for the same Riot game name + tag + platform inside one workspace.

Old reports created before role tagging are never relabeled as clean. If cached selected-role games exist but no role-specific saved report exists, the page rebuilds a fresh role-pure report from the cache without a Riot refetch.

## Patch-aware historical self baseline

Riot Match-V5 includes a game-version string for each match. The analyzer stores that raw value on each analyzed/baseline game and derives a defensive **major.minor patch key** from the first two numeric components.

Keep two patch identities separate:
- **raw build/Data Dragon key** for exact item-catalog lookup and same-patch cohort matching,
- **public Riot patch label** for user-facing text.

Riot's verified year-prefixed public naming does not always match the raw Data Dragon major. In the verified mappings used here, raw 15.x maps to public Patch 25.x and raw 16.x maps to public Patch 26.x. Do not extrapolate that offset to unverified future majors. The frontend should therefore show e.g. **Patch 26.19** while optionally retaining **Riot/Data Dragon build 16.19** as provenance.

The normal Last-20 coaching sample is **not** restricted to one patch. Recent behavior remains visible even across a patch boundary.

Only the broader historical self-trend comparison is patch-aware:

1. determine the patch key of the most recent primary-role game in the Last-20 sample,
2. collect current Last-20 primary-role games from that same patch,
3. collect **older** cached primary-role games from that same patch, excluding the current Last-20 match IDs,
4. permit broader historical trend coaching only when there are at least **3 current-patch games and 5 older same-patch games**.

Cross-patch older games remain cached and available for descriptive reporting, but they do not drive claims such as “your farming is improving/slipping versus your broader baseline.”

Data Quality exposes:
- current patch key,
- current-patch primary-role games,
- older same-patch baseline games,
- cross-patch older primary-role games excluded from trend coaching,
- patch distribution,
- whether the patch-aware historical baseline is ready.

This avoids silently attributing patch-driven systemic changes to the player's behavior.

## Peer-rank backfill for the comparable sample

Queue isolation means the final Last-20 coaching sample may contain matches deeper than raw positions 1–20 in the fetched history.

To keep rank-band comparisons aligned with the actual coaching sample without ranking every raw match, fetch_finish now:
1. reads lightweight cached metadata in recency order,
2. applies Summoner's Rift + at least 10-minute + supported-queue eligibility,
3. filters to the selected role using cached canonical player_role,
4. runs the recency-aware queue selector inside that selected-role pool,
5. takes the first 20 matches from that role+queue comparable context,
6. fetches match JSON only for final-sample rows that still need an opponent rank snapshot.

The response separates selected_role_total_cached_games from comparable_cached_games and also exposes dominant_queue_id, peer_rank_target_count and peer_rank_backfilled. This prevents total selected-role cache depth from being confused with the final same-role, same-queue cohort.

The public request starts at 30 recent match IDs and automatically deepens to 50 only when the final role+queue comparable cohort is still smaller than 20. Cached history can remain deeper than a single fetch; role and queue discovery are metadata-first so timeline blobs are not transferred simply to decide eligibility.

This keeps Riot rank lookups bounded to the final comparable sample instead of blindly ranking every fetched raw match.

## Queue-context isolation

Summoner's Rift alone is not a sufficient comparability filter because map 11 also hosts special, bot and legacy queues whose pacing/mechanics are not valid coaching peers.

The analyzer therefore keeps fetched matches cached but filters the coaching candidate pool in this order:
1. Summoner's Rift (`mapId = 11`),
2. at least 600 seconds of game duration,
3. the user-selected normalized role,
4. an **explicitly supported current PvP queue**,
5. then the dominant raw `queueId` among the supported candidates for that role.

Current supported queue IDs are Draft Pick 400, Ranked Solo 420, Blind Pick 430, Ranked Flex 440, Swiftplay 480, Quickplay 490 and Summoner's Rift Clash 700. Swiftplay remains a separate rules family. Its 2026 profile explicitly records the major divergences documented by Riot: no Void Grubs, no Rift Herald, Baron at 12:00, at most two Elemental Drakes with Soul after both, Elder at 15:00, and Swiftplay-only Minion Frenzy. These are rules context rather than inferred behavior. Any other map-11 queue fails closed out of coaching until reviewed.

Only after the selected role is isolated and unsupported queues are removed does the analyzer choose the dominant raw queue ID for the deep coaching sample. Queue selection is **recency-aware**: count queue IDs only inside the 20 newest supported candidates for that role, choose the largest count, and break a count tie in favor of the queue whose newest match is more recent. Older cached matches from that role and selected queue can still extend the same-context baseline.

This prevents three contamination modes at once: an old queue cannot override the current context, one accidental off-queue game cannot replace an otherwise consistent recent context, and matches from another role cannot decide which queue the selected-role report uses.

External **rank-population** benchmarking has a stricter eligibility rule than ordinary same-role coaching. The LegendsTracker reference corpus is ranked EUW data, so:
- queue 420 uses the player's `RANKED_SOLO_5x5` tier,
- queue 440 uses the player's `RANKED_FLEX_SR` tier,
- Draft, Blind, Quickplay, Clash and Swiftplay cohorts do **not** receive the ranked-population spider/bridge even if the account has a ranked tier.

Those non-ranked reports keep their own sample metrics and direct same-role evidence; they simply fail closed on the ranked population comparison instead of presenting unlike populations as peers.

Data Quality exposes the supported-candidate count, unsupported queue IDs excluded, selected queue family/ID, the recent selection window/counts, full-cache queue counts and the remaining excluded-other-queue count. A smaller mechanically coherent, current-context sample is preferred over a larger mixed or historically stale sample.

## Coaching-sample eligibility

The cache and the coaching sample are deliberately different.

All fetched matches can remain cached, but deep behavioral coaching currently requires:
- Summoner's Rift (`mapId = 11`),
- at least 600 seconds / 10 minutes of game duration,
- a usable normalized role for the player,
- that role to match the role explicitly selected in the request,
- one supported mechanically comparable queue context.

A game below 10 minutes is excluded as a **short / non-representative sample**. This is an analysis-quality threshold, not a claim that Riot officially classifies every sub-10-minute game as a remake.

The report's Data Quality block must expose cached games, selected-role eligible games, selected role, dominant queue context, excluded other roles/maps/queues, short games and missing/ambiguous role evidence. Excluded matches remain cached and can be used later when that role is selected.

## Data flow

1. **Load & analyze** resolves the saved Riot identity and requests 30 recent match IDs first.
2. Missing Match-V5 match/timeline rows are cached per Kalenel League profile, with the player's canonical role persisted as lightweight metadata.
3. Fetch completion filters map/duration/support, then selected role, then queue context; only final-sample peer-rank gaps need additional match JSON/rank work.
4. If fewer than 20 role+queue comparable games exist, the same action automatically scans up to 50 recent IDs.
5. **Analyze** can be rerun from cached data without Riot match/timeline calls; this is also how pre-role mixed saved reports are rebuilt safely.
6. Deep timeline behavioral analysis is limited to the newest 20 selected-role, selected-queue games.
7. Older cached selected-role/same-context rows remain available as lightweight personal-baseline evidence subject to patch/mechanics safeguards.

Missing timeline data is unknown, not zero.

### JavaScript numeric safety

JavaScript converts `null` to numeric zero through `Number(null)`. The analyzer and report formatter therefore explicitly reject `null`, `undefined`, and empty strings before numeric conversion. Do not replace those guards with a bare `Number.isFinite(Number(value))`, because that silently turns missing data into a valid zero and can generate false coaching.

## Comparison hierarchy

Use comparisons in this order:

1. **Actual same-role opponent in the same match.**
2. **Actual higher-ranked same-role opponents encountered in the sample.**
3. **The player's own wins versus losses.**
4. **Recent Last 20 versus the player's broader cached baseline.**
5. External/static population benchmarks only when the source, role, rank, patch and units are known.

Do not replace a direct match-level comparison with a generic population average.

## Units

- WR, KP, objective presence, objective-death percentage and roam success are stored/displayed on a 0–100 percentage scale.
- CS/min, DPM, GPM and VPM are rates per minute.
- `goldDiff10`, `goldDiff15`: player minus same-role opponent gold at the corresponding timeline frame.
- `csDiff10`, `csDiff15`: player minus same-role opponent CS.
- `xpDiff10`, `xpDiff15`: player minus same-role opponent XP.
- Major-item timing delta: player completion minute minus same-role opponent completion minute. Positive = player is later/slower.
- The uploaded Bruisienator V21 HTML defines **DQI** on a 0–10 scale as `10 - badDeaths×1.4 - soloDeaths×0.8 - greedyDeaths×0.8 - facecheckDeaths×1.0 - deathsNearObjective×1.2`, clamped to 0–10.
- The supplied V21 PowerShell pipeline, however, only emits `badDeaths`; it never populates the other four DQI fields. The exact **effective generated-report behavior** is therefore `clamp(10 - badDeaths×1.4, 0, 10)`. Preserve that value for compatibility/provenance instead of pretending the missing fields existed.
- The web analyzer may also expose a clearly labelled **partial intent reconstruction** using defensible modern proxies for isolated, greedy/overstay and objective-context deaths, but it must never fill the unavailable facecheck input with a fabricated value or present that reconstruction as the historical DQI.
- Current death coaching does **not** use a replacement composite DQI. It exposes the underlying evidence directly: high-risk deaths, isolation, trades, measured costly/severe consequences, pre-objective deaths, high-unspent-gold deaths, deaths while ahead/behind, and consequence-coverage rate.
- AGOR remains undefined until its historical formula is recovered.

## Role-selected samples

The report is **role-pure by construction**, not merely role-aware after aggregation.

The user selects ADC, SUPPORT, MID, JUNGLE or TOP before analysis. That choice is applied before dominant-queue selection, before the Last-20 slice, before timeline loading, before peer-rank targeting, before champion/matchup aggregation, before replay review and before saved-history comparison.

Consequences:
- an ADC report contains only ADC matches,
- a TOP match cannot decide the queue context of an ADC report,
- replay-review and champion summaries cannot reintroduce another role,
- historical progress comparisons are matched to the same selected role,
- the frontend performs a final fail-closed contamination check before rendering.

Games from other roles stay cached for future role-specific reports; they are not deleted or silently averaged into the currently selected report.

## Supported Summoner's Rift queues

Map ID 11 alone is not enough to make a match mechanically comparable. Riot's queue registry also includes special modes, bots and legacy modes on Summoner's Rift.

The coaching sample therefore admits only explicit supported current PvP queue families:
- standard Draft Pick (400),
- Ranked Solo (420),
- Blind Pick (430),
- Ranked Flex (440),
- Quickplay (490),
- Summoner's Rift Clash (700),
- Swiftplay (480), kept as its own rules family.

Other map-11 queues are cached only as raw history if fetched; they are excluded from the coaching/report cohort and their queue IDs are surfaced in Data Quality. An unknown future queue fails closed until reviewed.

When multiple supported queues are present, the report still isolates the dominant queue instead of blending queue contexts. This prevents special-mode mechanics or different pacing assumptions from contaminating standard coaching.

## Verified mechanics boundary

The rules engine has an explicit audited-through boundary: **26.19**.

An internal 2026 game version whose minor is greater than 19 is treated as `2026_minor_unverified` until its patch mechanics are audited. Mechanics-sensitive phase/role-quest assumptions are suppressed rather than inheriting 26.19 behavior merely because the major version is still 16.x.

This boundary is intentionally conservative. Updating it requires both rule review and regression coverage for the newly audited patch.

## Role normalization

- `UTILITY`, `SUPPORT`, legacy `DUO_SUPPORT` → **SUPPORT**
- `BOTTOM`, `BOT`, `ADC`, legacy `DUO_CARRY` → **ADC**
- `MIDDLE`, `MID` → **MID**
- `JUNGLE` → **JUNGLE**
- `TOP` → **TOP**

Current Match-V5 `teamPosition` and `individualPosition` are the preferred role sources. If both normalize to usable roles but disagree, the match fails closed to **GENERIC** for role-specific coaching rather than arbitrarily choosing one field. The report counts these as conflicting Riot role metadata.

Direct peer comparison is stricter still: exactly one enemy participant must normalize to the player's resolved role. Zero candidates means the role peer is unavailable; more than one candidate is treated as ambiguous. Neither case is allowed to silently pick an opponent.

For **coaching and benchmarks**, uniqueness is not enough. Both the player and that unique enemy counterpart must have **high-confidence Riot position evidence** from `teamPosition` or `individualPosition`. Legacy `role`/`lane` fallbacks may remain visible for match traceability, but they are withheld from direct-role gold/CS checkpoints, same-role peer deltas, role-duel conversion, item-timing comparisons and rank-band benchmarking. Data Quality exposes both fallback labels and the number of low-confidence direct-peer comparisons withheld.

Role-aware conclusions must use the normalized role, and direct-role comparative conclusions must also satisfy this confidence boundary.

All opponent-relative **deltas** must use matched denominators on both sides. The player's all-game descriptive rate may still be shown separately, but it must never be subtracted from an opponent rate measured on a smaller trusted-peer subset. This applies to plate pressure, first-reset timing/economy, major-item readiness, second-major timing, first impact, repeat-death recurrence, role-level fight state, objective-setup vision, and post-kill conversion. The report labels all-valid and matched-peer values separately whenever both are useful.

Metric-specific same-role means also export their exact contributing-game count.

Rank-band summaries retain a broad matched-game count only as context. Higher/same/lower-rank bands separately export `laneGames`, `csMinGames`, `dpmGames`, `vpmGames` and `majorItemGames`; every displayed band mean must show the count that actually contributed to that metric. A broad rank-band game count must never be presented as the denominator for a thinner metric-specific mean.

Metric-specific same-role means also export their exact contributing-game count. `avgCsMinDelta`, `avgDpmDelta` and `avgVpmDelta` must not borrow `sameRoleGames` as a denominator label unless every contributing delta is present. Clean direct-role duel rates are normalized by `directPeerTimelineGames`, not by all timeline-complete games; unresolved/missing direct-role games cannot dilute a role-opponent event rate. Clean direct-role duel **rates per game** use the trusted `directPeerTimelineGames` denominator. Recurrence coaching is stricter: the relevant kill/death outcome must also repeat across multiple trusted direct-peer games, and recurrence confidence uses that outcome-specific game-spread count rather than the broader eligible-game denominator. Evidence copy should disclose both the trusted-peer context and the games in which the repeated outcome occurred.

## Early lane outside pressure

For **TOP, MID, ADC and SUPPORT**, the analyzer separates ordinary lane-opponent pressure from early home-lane deaths involving an additional enemy role.

A death enters this comparison when:
- it occurs inside the queue-aware early phase,
- the player's mapped position is in their normalized home lane,
- the selected role is TOP, MID, ADC or SUPPORT.

The lane-opposition set is role-aware:
- **TOP / MID:** the ordinary lane opponent is the actual same-role opponent.
- **ADC / SUPPORT:** both ordinary enemy bot-lane counterparts are lane opposition. For an ADC, the enemy Support is not “outside pressure”; for a Support, the enemy ADC is not “outside pressure.”

An **outside-pressure death** means at least one supported enemy participant in the kill event falls outside that ordinary lane-opposition set. In bot lane this therefore points to additional Jungle/Mid/Top or other extra-role pressure rather than normal 2v2 participation. The report preserves the attacker-role set where Riot participant data supports it.

Global coaching requires repeated evidence rather than one chaotic game: at least 4 early home-lane deaths across at least 3 affected games, with at least 3 outside-pressure deaths spread across at least 2 games and an outside-pressure share of at least 60%.

If outside-pressure deaths dominate that sufficiently distributed sample, coaching should focus on:
- wave depth while enemy positions are unknown,
- ward timing before vulnerable waves,
- jungle/roam tracking,
- whether a trade is still safe when extra pressure is missing from the map.

This distinction prevents the report from misdiagnosing ordinary bot-lane 2v2 pressure as a gank/roam problem, while still allowing ADC/SUPPORT reports to identify genuinely additional enemy pressure.

## Solo-kill structure conversion

A clean solo kill is useful only if the player converts the temporary advantage intelligently.

The primary window is the **queue-aware early phase**, not an obsolete turret-plate timer. For 2026 standard Summoner's Rift that early phase ends at 14:00 because the map's macro cadence changes there; turret plates themselves do **not** expire at 14:00. For 2026 Swiftplay the early window follows its accelerated rules profile.

For each clean early-phase solo kill on the actual same-role opponent, inspect structure evidence for the next 90 seconds.

Structure evidence now has two deliberately different confidence classes:

- **strong involvement** — direct Riot participant credit, or supported event-position proximity within roughly 2200 world units;
- **lane-presence-only signal** — when the event has lane/tower metadata but no usable coordinates or participant credit, and the nearest supported timeline frame merely places the player in that same lane.

Only **strong involvement** may count as:
- plate/turret involvement,
- solo-kill → structure conversion,
- player-supported post-kill structure conversion,
- turret-tier pressure used by coaching.

Lane-presence-only evidence is still retained because dropping it would hide useful uncertainty, but it is shown separately and can never by itself earn conversion credit. Being somewhere in the same lane within a coarse timeline frame is not proof that the player participated in that turret event.

Since Patch 26.1, the analyzer treats plate rewards as a persistent turret-system mechanic rather than a pre-14 mechanic. Preserve:
- player and direct-role-opponent **strong** plate involvement through the fixed 20-minute coaching slice,
- full-match strong plate involvement,
- lane-presence-only plate signals separately for both the player and peer,
- direct-credit counts as provenance diagnostics,
- the number of unattributed plate events,
- strong plate involvement split by turret tier: outer, inner, inhibitor, Nexus, and unknown,
- strong turret-kill involvement.

The 20-minute slice is a coaching comparison window, **not** an expiry rule. Full-match and tier breakdowns are required because later/deeper turret pressure now matters.

The 2026 rules profile also records the related system reset explicitly: Atakhan and Feats of Strength are disabled, First Blood again carries its +100g bonus, and the first turret again carries its +300g bonus. These values are rule context only; the analyzer must not synthesize timeline gold that Riot did not expose.

This metric complements, rather than replaces, solo-kill → @15 economy conversion and post-kill reset/banking metrics. Resetting can be the correct conversion after a kill, so low structure conversion is not automatically a mistake. Coaching should ask whether the player deliberately chose wave denial, a clean reset, a strong structure hit, or another supported map conversion rather than grading every kill by turret damage alone.
## Direct-role solo duels

Timeline champion-kill events isolate **clean 1v1 outcomes against the actual same-role opponent**.

A direct-role solo duel event requires:
- the player and same-role opponent to be killer/victim,
- **zero assisting participants** on the kill event.

The report preserves:
- all-game solo kills/deaths against the direct role opponent,
- queue-aware early-phase solo kills/deaths,
- event timestamps and supported direct-role economy state,
- a legacy `≤14m` compatibility flag only where a fixed @15 conversion calculation needs enough time before the checkpoint.

The old pre-14 subset is therefore **not** the primary laning definition and is never a plate-expiry proxy.

For bot lane, outside-pressure classification must treat both ordinary enemy bot-lane counterparts as lane opposition. The enemy support should not be mislabeled as "outside pressure" on an ADC simply because the direct-role peer is the enemy ADC, and vice versa.

This intentionally separates matchup execution from ganks/roams and other assisted pressure. Repeated queue-aware early solo deaths can support matchup review; repeated early solo kills can be a sampled strength. Small samples remain low confidence.

## Lane and peer comparisons

For each match, identify the opposing participant with the same normalized role.

Where timeline frames exist, compare gold, CS, XP and level around 10 and 15 minutes.

Aggregate coaching can use:
- average gold/CS delta at 15,
- percentage of games ahead on gold at 15,
- CS/min, DPM and VPM deltas versus the direct role opponent,
- percentage of peer-comparable games in which the player beats the peer on those metrics.

The UI should always make clear that these are **same-role direct opponents**, not a global average.

## Higher-ranked direct peers

### Rank-band context

Rank-pressure coaching is valid only when the player and direct same-role opponent have snapshots on the **same Riot ranked ladder**.

Rank snapshots retain both Solo/Duo and Flex entries when Riot provides them. Comparison selection is queue-aware:
- Ranked Solo matches require `RANKED_SOLO_5x5`,
- Ranked Flex matches require `RANKED_FLEX_SR`,
- other supported PvP queues use the first ranked ladder both players actually share (Solo/Duo first, then Flex),
- if no shared ladder exists, that game is excluded from rank-band coaching rather than comparing unlike ladders.

Old single-ladder peer snapshots are refreshed for the recent comparable sample so missing `byQueue` evidence does not silently persist.

Where a shared ladder exists, classify the opponent by **tier/division band**:

- higher tier/division,
- same tier/division,
- lower tier/division.

LP differences inside the same division are deliberately ignored for this classification.

For each band preserve at least:
- number of comparable opponents,
- average gold differential at 15,
- percentage of games ahead on gold at 15,
- average CS/min delta,
- average DPM delta,
- average VPM delta,
- measurable first-major completion games,
- average first-major timing delta versus the direct role opponent,
- percentage of those games where the player's first major completes earlier.

This lets the report distinguish "performance drops against stronger peers" from "inconsistency even against lower-ranked peers."

Rank is a **fetch-time snapshot**, not the opponent's historical rank at the exact match date. The report exposes which ranked ladders supplied comparisons and how many peer games were excluded for rank-context mismatch. Phrase conclusions accordingly and do not overstate small samples.



During Fetch / update, the newest 20 games may cache the current rank of the actual same-role opponent.

Rank ordering is used only to classify whether that direct opponent is above the player's current rank. The report can then summarize the subset of actual higher-ranked peers:
- average gold differential at 15,
- percentage of those games where the player is ahead on gold at 15,
- average DPM delta,
- first-major completion timing versus that actual higher-ranked same-role opponent,
- percentage of measurable games where the player's first major completes first.

This directly preserves the useful intent of the historical "item spike vs rank above" analysis without inventing a static timing table. A first-major timing value exists only when both players have supported completion events in the same match.

This is preferable to inventing a static "rank above" benchmark table.

Rank is a snapshot and can change after the match; present this comparison as the opponent rank observed at fetch time.

## Patch-aware 2026 role-quest context

### Queue-level quest certainty

Standard Summoner's Rift **map mechanics** and Role Quest **assignment certainty** are separate facts.

Riot's queue registry identifies Draft (400), Ranked Solo (420), Blind Pick (430), Ranked Flex (440), Quickplay (490), Swiftplay (480), and Clash (700) as Summoner's Rift queues. The analyzer accepts the ordinary PvP SR queues for timeline analysis, but only treats Draft, Ranked Solo, Ranked Flex, and Quickplay as queues with verified assigned-position semantics for the 2026 lane Role Quest package. Swiftplay is explicitly excluded from standard Role Quests. Blind Pick and Clash keep standard SR macro/mechanics analysis but quest-specific economy/reward interpretation fails closed unless stronger evidence is added later.

This prevents an ambiguous queue from contaminating quest-sensitive economy comparisons while preserving useful map/timeline evidence.



The 2026 role-quest system is a mechanics dependency for interpretation, not a hidden source of invented events. The analyzer therefore derives a **role-quest rules revision from the match patch** and attaches it to each game.

Standard Summoner's Rift revisions currently distinguished are:
- **26.1–26.8:** initial 2026 role-quest package,
- **26.9–26.10:** role-quest reward rework,
- **26.11–26.18:** mid-lane reward revision with the later +8% bonus AD/AP value,
- **26.19:** verified cohort including the shorter top-lane Teleport cooldown revision.
- **26.20+ (until audited):** fail closed as a newer unverified 2026 minor; do not inherit 26.19 mechanics merely because the internal major is still 16.x.

The role-specific context records the mechanics that can affect interpretation:
- **TOP:** quest XP/level-cap and Teleport package; XP/level checkpoints can include quest reward effects after completion,
- **JUNGLE:** 35-stack quest and post-completion large-monster gold/XP plus jungle/river movement reward,
- **MID:** free tier-3 boots plus the patch-specific post-quest reward, which changed during 2026,
- **ADC/BOT:** quest-completion and post-completion gold package plus boots-slot handling; the takedown bonus changed in 26.9,
- **SUPPORT:** the support quest remains; after completion Control Wards are discounted and can be stored through the quest system.

Swiftplay is deliberately separate: do **not** apply the standard lane-role quest package to Swiftplay games.

Riot timeline data used here does not provide a reliable universal role-quest-completion event that can be assigned to every role and patch. Therefore:
- the report does **not** invent an exact quest completion minute,
- real @10/@15/@25 gold, XP and level states remain valid observed states but may already include quest rewards,
- patch/revision context is shown beside those checkpoints,
- cross-patch interpretation must acknowledge material reward changes,
- support Control Ward purchases after quest completion can make static Data Dragon shop-cost estimates too high; these visits are marked **approximate** rather than silently repriced.

The report exports revision counts so a Last-20 sample spanning multiple role-quest revisions is visible as a data-quality caveat. If Riot's internal game-version minor is missing, the game is marked `2026_revision_unknown`; the analyzer keeps generic 2026 quest context but does not guess which patch-specific reward revision applied.

Revision identity is **role-specific**, not merely patch-specific. A patch that changes TOP must not fragment an ADC mechanics cohort when ADC mechanics did not change. Current explicit role boundaries include:
- TOP: 26.1 initial package → 26.9 XP revision → 26.19 Teleport-cooldown revision,
- MID: 26.1 empowered-Recall package → 26.9 +6% bonus AD/AP → 26.11 +8% bonus AD/AP,
- ADC/BOT: 26.1 initial income package → 26.9 40g post-quest takedown bonus,
- SUPPORT: 26.1 core support economy → 26.7 rapid-minion-farming gold penalty removed → 26.16 stronger early-roaming penalty / normalized quest progress,
- JUNGLE: no later 2026 role-quest boundary is currently asserted unless Riot documents one.

This prevents two opposite errors: mixing genuinely incompatible same-role games, and discarding valid same-role games merely because another role changed on that patch.

An **unknown** mechanics revision is never treated as a verified cohort identity. Even if five or more recent games share `2026_revision_unknown`, that only means the version evidence is missing; it does not prove those games share the same mechanics. In that case the analyzer keeps the broader role sample and marks the mechanics fallback as unverified rather than filtering on an unknown label.

For mechanics-sensitive coaching, the report builds a **current mechanics cohort** from the newest primary-role game's rules profile plus that role's own mechanics revision. If that cohort contains at least five primary-role games, coaching models use it instead of blending older incompatible mechanics into the same conclusions. The Last-20 overview remains visible separately. If fewer than five current-mechanics games exist, the analyzer keeps the broader primary-role sample rather than manufacturing certainty and explicitly marks the mixed-mechanics fallback as a data-quality limitation.

### Verified rules boundary

The 2026 rules profile is intentionally **audited-through**, not open-ended. The current verified mechanics boundary is public patch **26.19**. If Riot Match-V5 reports a 2026 internal minor newer than the verified boundary, the analyzer fails closed into `2026_minor_unverified` rather than silently treating the game as if 26.19 mechanics still applied. Mechanics-sensitive coaching/checkpoint interpretation is suppressed until that newer patch is explicitly audited. This prevents future patch drift from becoming invisible analysis error.

## Mid-game farm routing

For TOP, MID and ADC, the analyzer separately tracks the change in **same-role CS differential from 15→25 minutes**.

This is intentionally separate from gold-differential swing:
- gold can change through kills, objectives and shutdowns,
- CS swing more directly describes who is collecting farm after lane.

The per-game report compares `csDiff15` with `csDiff25`. Aggregate coaching requires multiple comparable games.

Current interpretation:
- repeated negative swing of roughly **8 CS or more on average** → review post-macro-transition wave assignments/routing,
- repeated positive swing of roughly **8 CS or more** → potential post-macro-transition farming strength.

A large positive CS swing is not automatically good if it makes the player late to objectives or fights. Coaching must therefore frame this as **routing efficiency**, not “maximize CS at all costs.”

## 25-minute role-lead closing

A direct-role advantage at 25 minutes is a useful conversion checkpoint **only for rules profiles where @25 is still a comparable ordinary-game checkpoint**. It is not the same thing as the whole team being ahead.

For 2026 standard Summoner's Rift, @25 closing remains enabled. For 2026 Swiftplay it is disabled as a closing model because 25:00 is the Sudden Death transition; the raw @25 frame can still be displayed for traceability but must not be interpreted as normal closing performance.

Current role-relative classifications:

- **role lead @25:** at least +500 total gold versus the actual same-role opponent,
- **role deficit @25:** at most -500 total gold versus the actual same-role opponent.

For role-lead games preserve:
- lead-game count,
- wins/losses,
- win rate,
- how many losses contain at least one late (25+) high-risk or costly-death event,
- total late high-risk and costly-death events in those losses.

Strong negative coaching requires multiple role-lead games and a low closing rate. A specific late-risk explanation is only used when repeated late high-risk/costly-death evidence exists. Otherwise the report must say the cause is unresolved and direct review toward objective setup, side-wave timing and reset/fight conversion.

For role-deficit games, a meaningful win rate can be highlighted as recovery strength.

Do not describe these metrics as whole-team lead conversion or infer that the player's role-relative state alone caused the final result.

## Mid-game routing efficiency

For ADC/MID/TOP, raw CS swing and neutral-objective attendance should be interpreted together.

For **2026 standard Summoner's Rift**, the dedicated routing comparison remains a fixed **15→25** checkpoint model:
- compute the direct-role CS differential change from @15 to @25,
- count grouped neutral-objective encounters whose start falls in the dedicated routing window,
- compute supported nearby presence for those encounters.

This routing model is deliberately independent from the strategic phase buckets. The strategic late/Baron-era phase starts at 20:00 in 2026 standard SR, while the routing checkpoint still asks what happened to role-relative farm from 15→25.

Swiftplay is excluded from this fixed 15→25 routing comparison because its pacing is accelerated enough that the standard checkpoints are not comparable.

Current coaching cases:
- **inefficient routing:** CS differential worsens by at least ~8 CS and objective presence is below 50%,
- **balanced routing strength:** CS differential improves by at least ~8 CS and objective presence is at least 60%,
- **side-farm / low-presence tradeoff:** CS differential improves by at least ~8 CS, at least two grouped neutral-objective encounters occur, and presence is below 35%.

The side-farm case is a tradeoff, not automatically a mistake. Conceding a low-value or uncontestable objective for guaranteed resources can be correct; the coaching goal is intentional timing rather than universal attendance.

## Early-lead preservation before 15

The 10-minute and 15-minute checkpoints can hide volatility inside the lane, but only when the active rules profile marks @15 as a comparable lane checkpoint. Preserve direct-role gold differential on supported timeline frames from roughly 3:00 until just before 15:00 for those compatible profiles.

For 2026 Swiftplay, @15 is already the Elder era. The analyzer therefore keeps the raw @15 frame available for traceability but does **not** use it for lane-lead, early-lead-giveback, repeated-matchup lane-economy, or champion-lane coaching.

For each game:
- find the largest positive direct-role gold differential before 15,
- treat a peak of at least **+500g** as a meaningful early-lead opportunity,
- compare that peak with the true 15-minute direct-role gold differential,
- classify a **give-back** when at least **500g** of that peak has disappeared by 15,
- classify the lead as **preserved** when no more than **250g** of the peak has disappeared,
- preserve deaths and high-risk deaths that occur after the peak and before 15 as context.

The aggregate coaching signal is the share of meaningful early-lead opportunities that become give-backs. This is intentionally per-game rather than an average 10→15 comparison: a player can build and lose a large lead between the two fixed checkpoints while the sample averages hide it.

Deaths inside the window are supporting context, not proof that a death caused the full economy swing. Replay review should examine the complete peak→15 sequence: wave state, reset timing, movement, fight selection and deaths.

## Lead preservation from 15 to 25

Where a real timeline frame exists near 25 minutes **and the rules profile marks fixed 15→25 checkpoints comparable**, preserve the same-role opponent comparison at 25 as well as 10/15.

Use the change in direct-role gold differential from 15→25 to answer a different question from lane performance:

**Did the player preserve/extend the advantage after lane, or surrender it during the first rotations?**

Current aggregate coaching requires multiple comparable games. A repeated drop of roughly 500g or more from a positive 15-minute state is treated as a lead-preservation concern; a repeated positive swing can be highlighted as strong mid-game conversion/recovery.

Do not manufacture a 25-minute value for games that ended before an appropriate 25-minute timeline frame. Missing remains unknown.

## Lane-lead conversion and recovery

This model only runs on rules profiles with `lane15Comparable=true`. A raw @15 state in an accelerated queue is not automatically a lane state.

A working sample classification is:
- lane/economy lead: at least **+250 gold at 15** versus the same-role opponent,
- lane/economy deficit: at most **-250 gold at 15**.

The analyzer can compare:
- win rate when the player has a lead,
- win rate when the player has a deficit.

This is descriptive. Do not claim the gold state alone caused the win or loss.

## Game-phase behavioral risk

The analyzer uses **rules profiles** rather than one timeless set of minute cutoffs.

For 2026 standard Summoner's Rift:
- **early:** before 14:00,
- **transition:** 14:00 through 19:59,
- **late / major-objective era:** 20:00 and later.

The 14:00 boundary is a macro-cadence marker in the current season, including the minion-wave cadence change. It is explicitly **not** a turret-plate expiry boundary. The 20:00 boundary aligns the late phase with Baron's return.

For 2026 Swiftplay:
- **pre-Baron:** before 12:00,
- **Baron era:** 12:00 and later.

Do not fabricate a standard-SR-style transition bucket for Swiftplay. Its rules profile also retains the 15:00 Elder and 25:00 Sudden Death anchors for context.

Historical pre-2026 games and future rules that have not been verified are preserved for raw reporting but excluded from current cross-game phase coaching. This prevents today's logic from silently rewriting old matches or guessing future mechanics.

Fixed checkpoint interpretations are separately gated:
- `lane15Comparable` controls @15 lane-economy / early-lead interpretation,
- `fixed15to25Comparable` controls 15→25 preservation and routing interpretation,
- `closing25Comparable` controls ordinary @25 closing interpretation.

Raw checkpoint values may still be shown when a flag is false, but they are descriptive only and do not trigger those coaching models.

Per phase, preserve:
- deaths,
- high-risk deaths,
- costly and severe death-consequence events,
- kill/assist impact events,
- joined grouped neutral-objective encounters,
- attended multi-kill fight clusters,
- first-allied-death fight events.

Aggregate risk rates are normalized by **actual minutes of phase exposure**, reported per 10 minutes. This avoids comparing a short transition phase with a much longer late phase using raw per-game counts.

Phase coaching requires enough games and enough exposure time, plus a material separation from the next-highest phase. The purpose is localization: identify whether decision risk is concentrated in the current early lane period, the transition, or the major-objective era.

## Rapid repeat-death recovery

A **rapid repeat death** is a second player death occurring within **4 minutes** of the previous player death.

The same calculation is performed for the actual same-role opponent in each analyzed match.

For the player, preserve whether the repeat death is:
- high-risk under the normal multi-signal death model,
- costly/severe under the death-consequence model,
- traded or untraded,
- early/mid/late phase.

The aggregate repeat-death rate uses:

`repeat deaths / death-to-next-death opportunities`

A game with zero or one death therefore does not invent a denominator.

Coaching should not treat every repeat death as a mistake. Strong negative advice requires enough opportunities plus repeated high-risk or costly second deaths. The direct-role opponent rate is useful context: it distinguishes a player-specific recovery pattern from a match environment where both roles are repeatedly dying.

The recommended intervention is a **post-death recovery protocol**: spend, identify the safest guaranteed resource, restore information, and avoid immediately re-entering the same contested area unless the state has changed.

## Death aftermath / consequence analysis

Death quality and death consequence are separate questions.

For each death where the timeline supports a later comparison, preserve the direct-role economy state at death and target a **bounded ~60-second aftermath sample**. Use the nearest supported Riot frame within ±35 seconds of that target. Do not let the economy window drift arbitrarily later.

If the player dies again before that aftermath frame, the first death's gold/CS aftermath is **suppressed as contaminated** rather than allowing the second death's losses to be counted against both deaths. Preserve the number of suppressed economy samples as evidence-quality metadata.

Current consequence signals include:
- direct-role gold differential worsens by at least ~300g,
- direct-role CS differential worsens by at least ~6 CS,
- an enemy **neutral objective** is converted inside the post-death neutral-objective window,
- an enemy **structure** is converted inside the post-death structure window **and is geographically local to the death or matches the death lane when event coordinates are unavailable**.

Neutral objectives and structures are retained as distinct signals. A turret/plate loss elsewhere on the map must not become a death-consequence signal merely because it happened within the same 75-second clock window.

A death is **costly** when at least one supported consequence signal is present and **severe** when at least two are present. Also preserve whether the death was traded.

The post-death gold/CS swing is observational. It describes what follows the death; it does not prove the death alone caused every subsequent resource change. Coaching uses this model to prioritize replay review of deaths with the strongest supported aftermath.

## Risk discipline by direct-role economy state

At each death, compare the player's total gold with the **actual same-role opponent** at that timeline moment:

- **ahead:** at least +500g,
- **roughly even:** between -500g and +500g,
- **behind:** at most -500g.

This is a **role-matchup economy state**, not a claim about the whole team's game state.

Preserve both total deaths and high-risk deaths in each bucket. The most actionable contrast is often:

- high-risk deaths while ahead → lead-protection / comeback-prevention problem,
- high-risk deaths while behind → deficit-compounding / excessive-variance problem.

A behind-state death is not automatically wrong. Strong negative coaching requires repeated deaths that also cross the multi-signal high-risk threshold. Conversely, if a player has enough behind-state deaths but very few high-risk ones, that can be highlighted as recovery discipline.

## Lead-protection deaths

A separate lead-protection signal identifies deaths taken while the player is **materially ahead of the actual same-role opponent**.

Current working threshold:
- at least **+500 total gold** versus the direct role opponent at the death timestamp.

For those deaths preserve:
- role gold differential at death,
- whether the death also crosses the multi-signal high-risk threshold,
- current/unspent gold,
- map zone,
- whether an enemy objective follows,
- where supported, the change in direct-role gold differential roughly one timeline frame later.

A death while ahead is not automatically bad. The strongest coaching signal is a **high-risk death while ahead**, because it combines an earned resource advantage with avoidability evidence.

Repeated high-risk lead deaths should be coached as **lead protection / comeback prevention**, not merely as a generic KDA problem.

## Death-quality heuristic

Do **not** call every death bad.

For a player death, inspect timeline context:
- isolated from nearby allies,
- deep on enemy side,
- outnumbered nearby,
- enemy objective taken shortly after,
- at least 1000 current/unspent gold,
- whether it occurs in objective context.

Current weighted signals:
- isolated: +1
- deep enemy side: +1
- outnumbered: +1
- enemy objective shortly after: +2
- high unspent gold: +1

A death is labelled **high-risk / likely avoidable** only when the combined score is at least 2.

The report should expose the contributing tags and nearby ally/enemy counts so the player can inspect the judgment.

### Post-play give-back risk

A successful kill/assist does not end the decision sequence. The analyzer separately tracks deaths that occur **within 30 seconds after the player's own kill/assist contribution**.

Preserve whether the follow-up death:
- crosses the normal high-risk threshold,
- is traded,
- is followed by an enemy objective,
- occurs with a known role-economy state.

The strongest negative signal is a **high-risk, untraded death within 30 seconds after a player-involved kill/assist**. This is coached as post-play discipline: after the first successful action, reassess health, cooldowns, reinforcements, spendable gold and the value of continuing the chase.

Do not imply that every post-impact death is bad. Some are correct trades or necessary fight continuations.

## Side-lane timing risk

Side pressure after the first major macro transition is useful, so the analyzer must not label every side-lane death as bad.

The start of this risk window is **rules-driven**, but it is deliberately called a **macro-transition** rather than a literal "lane phase ends" timestamp:
- 2026 standard Summoner's Rift: 14:00, anchored to the documented faster minion-wave cadence,
- 2026 Swiftplay: 12:00, aligned with its accelerated major-objective era,
- historical/future rules use their stored compatibility profile.

A **post-macro-transition side-lane death** requires:
- game time at or after that rules profile's macro-transition anchor,
- death in the coarse top-lane or bot-lane zone.

A death is additionally **isolated** when no allied participant is within 3,000 map units at the supported timeline frame.

A **pre-neutral-objective side-lane death** requires:
- a post-macro-transition side-lane death,
- isolated/no ally within 3,000 units,
- a neutral-objective event within 90 seconds afterward whose grouped objective window has supported team-contest evidence (the team secured it or at least one allied participant was present in the supported objective radius).

The old `post15SideLaneDeaths` field and `postLaneSideLaneDeaths` name are retained only for compatibility. New coaching and rates use `macroTransitionSideLaneDeaths`; this avoids presenting the timing anchor as proof that laning has literally ended.

This is a timing/macro signal, not a blanket criticism of split pushing. Coaching should emphasize reconnect timing when the next neutral-objective window matters. If an objective is intentionally conceded, dying on the cross-map trade can still erase the value of the side pressure.

The Summoner's Rift renderer uses Riot/Data Dragon map assets. The live page first requests the current Data Dragon version and carries an explicit verified fallback matching the analyzer's audited public patch boundary (currently 16.19.1 / Patch 26.19). Never fall back to a historical map image such as 6.8.1, because that can make modern death/ward/roam coordinates visually misleading even when the coordinate transform itself is unchanged.

## Spatial clustering of high-risk deaths

Preserve a coarse map context for flagged high-risk deaths. Current labels include:
- top lane,
- mid lane,
- bot lane,
- river,
- own jungle,
- neutral jungle,
- enemy jungle.

If at least three high-risk deaths exist and one area contains roughly half or more of them, surface that location as a repeated behavior pattern.

The coaching action should depend on the location. For example:
- enemy jungle → information, lane priority and teammate proximity before invading,
- river → establish vision before entering contested fog,
- lane → respect side-lane depth and missing opponents.

These zone labels are intentionally coarse for behavioral clustering. The separate real-map renderer provides point-level review on Riot's Summoner's Rift minimap; zone clustering remains useful because it summarizes repeated location patterns across games.

A death occurring near an objective is contextual information; it is not automatically a bad death.

## Deaths before enemy objective conversion

In addition to broad objective context, track whether an enemy objective is actually taken within **75 seconds after the player's death**.

For each qualifying sequence preserve:
- death minute,
- seconds until the objective,
- objective type,
- current/unspent gold when available.

This is a stronger coaching signal than simply dying near an objective, because it describes a concrete loss-of-availability sequence. It is still not proof that the death caused the objective loss.

Use wording such as:

"Your death was followed by an enemy dragon 42 seconds later."

Do not write:

"Your death lost the dragon."

## Post-kill map conversion

Group player-involved champion kills/assists into short skirmish windows rather than counting every kill separately.

A kill window has two deliberately separate conversion readings within roughly 75 seconds:

- **player-supported conversion** — a neutral objective requires supported player proximity, while a structure requires supported involvement/attribution;
- **team conversion context** — the team secured a tracked objective or structure in the window even if the player was not supported as present/involved.

Only the player-supported rate is suitable for individual coaching. Team conversion stays visible as context. This prevents an objective taken elsewhere on the map from being silently credited to the player's kill window. The same split is calculated for the actual same-role opponent.

Useful aggregate comparison:
- player-supported post-kill conversion rate,
- team conversion after the player's kill windows,
- opposing-role supported conversion rate,
- opposing team conversion context,
- supported percentage-point delta between the player and role opponent.

The two readings have different interpretation limits. **Player-supported conversion** is individual participation evidence: it shows that the player was supported as present/involved when map value followed the kill window, but it still does not prove the player caused that conversion alone. **Team conversion** is broader context only and must never be turned into individual credit or blame.

Negative coaching should be conservative: a kill window is treated as a missed map-conversion opportunity only when neither player-supported nor team conversion is observed in the 75-second window. If the team converts elsewhere while the player is not supported at that event, keep that as team-only context rather than calling the player's decision a failure.

The action recommendation is decision-oriented: after winning a skirmish, scan immediately for objective, structure and wave value before chasing or resetting.

## Neutral-objective recent-shop timing

For tracked **team-contested** neutral-objective encounters, preserve whether the player was present and the timing of their most recent detected shop visit.

A **recent-shop objective absence** requires all of the following:
- the encounter is in the team-contested objective denominator,
- the player is not within the supported objective action radius,
- the player was not recently dead,
- the last detected shop visit ended within 60 seconds before the objective encounter.

This is an **association signal**, not a causal diagnosis. Riot item-purchase events support that shopping ended recently; they do not prove that the reset/shop timing caused the absence. Coaching may suggest testing an earlier purchase deadline, but must judge that hypothesis by whether the pattern subsequently changes.

Also preserve **fresh-purchase joins** where the player attends the objective within roughly two minutes of a detected shop visit. These show that recent shopping and objective attendance can coexist; they do not prove the reset itself was optimal.

The shop event is an approximation based on Riot item-purchase events, not an exact recall-channel timestamp. The legacy `lateResetMisses` / `lateResetObjectiveMissRate` fields remain compatibility aliases only; new coaching and UI use `recentShopAbsences` / `recentShopObjectiveAbsenceRate`.

## Death trade context

A death can still be high-risk even when teammates trade it back, but the immediate strategic cost is different from an untraded death.

A death counts as **traded** only when:
- an ally kills an enemy after the player's death,
- the return kill occurs within 15 seconds,
- the return kill is spatially near the death (within roughly 3500 world units).

Preserve:
- traded death count,
- overall death trade rate,
- high-risk untraded death count,
- per-game high-risk untraded deaths.

A nearby return kill should soften the interpretation of the death, not erase the original risk evidence. An **untraded high-risk death** is a stronger improvement signal because the opposing team receives tempo/value without an immediate exchange.

## Objective evidence explanation

When primary-role objective presence is low enough to trigger coaching, rank the supported setup explanations rather than showing disconnected metrics.

Current supported explanations include:
- **recent-shop absence pattern** — repeated objective absences within 60 seconds of a detected shop visit; this is explicitly an association, not proof that reset timing caused the miss,
- **death before the contest** — deaths followed by enemy objective conversion,
- **setup-vision deficit** — materially lower objective-setup ward share than the actual same-role peer sample.

Do not compare these clues on one mixed-unit "severity" scale. Order them by **evidence specificity** first: direct death→objective event sequences, then peer-relative setup-vision gaps, then recent-shop timing associations. Within the same evidence class, magnitude may break ties. Expose the first item as the **highest-confidence supported clue**, not as a proven cause.

If no shop/death/vision signal crosses its threshold, do not manufacture certainty. Report **arrival/pathing as the remaining hypothesis**, explicitly marked as unresolved.

This is an evidence-ranking model, not causal proof. The UI must show the concrete evidence and interpretation limits for each ranked explanation.

The report contract uses `primaryExplanation` as the canonical field. `primaryCause` and `causes` remain compatibility aliases only so saved reports from older revisions continue to render; new analysis and practice routing must prefer `primaryExplanation` and `clues`.

## Neutral-objective setup timing

Attendance and setup are separate behaviors.

For team-contested neutral-objective encounters, the analyzer checks event presence and a deliberately conservative pre-objective position band. A setup sample is eligible only when a Riot timeline frame places the player within the setup radius **45–105 seconds before** the encounter. If multiple eligible frames exist, use the latest one.

Current evidence labels:

- **prior setup presence:** player is supported as present at the encounter and a supported position frame 45–105 seconds earlier places them within the setup radius,
- **event-frame-only join:** player is present at the encounter but has no supported position frame in that 45–105 second band,
- **absent:** player is not supported as nearby at the encounter.

The upper bound avoids rewarding an incidental pass nearly two minutes earlier. The lower bound distinguishes genuine prior setup evidence from simply being near the objective at the event frame. Because Riot timeline positions are coarse, these labels must not be presented as second-perfect arrival timestamps. `setupLeadSec` is the distance between the selected sampled frame and the encounter, not an exact pathing arrival time.

Aggregate coaching can distinguish a player who attends objectives but often appears only at the event from one with supported pre-contest positioning. The setup-rate denominator is joined **team-contested** neutral objectives; setup coverage uses all team-contested encounters.

## Objective context

Neutral-objective context and structure context are modeled separately.

For neutral-objective presence:
- use Riot `ELITE_MONSTER_KILL` timeline evidence,
- group multi-kill objective sequences into one encounter when they belong to the same objective family and occur in the same short contest window,
- retain the raw event count inside the grouped encounter,
- preserve split ownership in contested multi-kill encounters instead of forcing a single owner,
- inspect supported player position across the encounter window rather than only one exact event frame.

This grouping matters for objectives such as multi-kill Void Grub camps: three monster-kill events should not automatically become three separate attendance opportunities.

Building kills and turret-plate events remain available for structure conversion and death-consequence context, but they do **not** inflate neutral-objective attendance or objective-setup ward denominators.

Objective-death percentage therefore refers to neutral-objective contest context. Post-death consequences separately preserve:
- enemy neutral-objective conversion,
- enemy structure conversion.

Do not invent gold values for dragons, Baron, Herald, towers, plates, or grouped objective encounters when the timeline does not support that value.

## First meaningful map impact

For each timeline-complete match, track the earliest supported meaningful impact for both the player and the actual same-role opponent.

Supported first-impact events are:
- champion kill or assist,
- proximity to a grouped neutral-objective encounter.

The comparison is stored as:

`player first impact minute - same-role opponent first impact minute`

So:
- negative = player impacts first,
- positive = opponent impacts first.

Aggregate coaching is currently restricted to roles where early map influence is a particularly useful decision signal (JUNGLE, SUPPORT, MID) and requires multiple comparable games.

This is not a mechanical instruction to roam earlier. The coaching should point back to the decision window—lane priority, pathing, recall timing, or river setup—because sacrificing a high-value wave for an earlier timestamp can still be a bad play.

## Early involvement

Early KP uses the player's kill/assist participation through the active rules profile's early boundary. In 2026 standard SR that is 14:00; in 2026 Swiftplay it is 12:00.

When wins and losses have enough valid samples, the analyzer may report an association such as:
"early involvement is higher in wins."

Use **associated with**, not causal wording.

## Pooled event denominators

Aggregate event-presence rates use pooled numerators and denominators rather than averaging per-game percentages.

The primary Last-20 neutral-objective coaching rate is **team-contested presence**:

`sum(player joins to team-contested objective encounters) / sum(team-contested objective encounters)`.

A grouped neutral-objective encounter is team-contested when either:
- the player's team secures at least one unit in that grouped encounter, or
- Riot participant-frame positions support at least one allied champion near the encounter window.

This deliberately excludes fully conceded cross-map objectives from the coaching denominator while still including lost objectives the team actually contested. The older **team-secured presence** rate remains separately visible as outcome context:

`sum(player joins to team-secured encounters) / sum(team-secured encounters)`.

Do not use the secured-only rate as the primary coaching metric; doing so creates survivorship bias because lost contests disappear from the denominator.

The same rule applies to other event percentages:
- **Early KP** = pooled early player kill/assist involvements / pooled early team champion kills.
- **Objective-context death %** = pooled objective-context deaths / pooled deaths actually classified from Riot timeline events.
- **Death before enemy objective %** = pooled deaths followed by an enemy neutral objective inside the configured evidence window / pooled classified timeline deaths.

A game with one relevant event therefore does not receive the same weight as a game with six. The analyzer keeps means of per-game percentages only as separately labelled descriptive diagnostics.

For timeline-derived death classifications, the denominator is the number of deaths actually represented/classified in the timeline evidence, not blindly the match-summary death total. The full reported death total remains available for coverage checks. This keeps missing or incomplete timeline evidence from silently entering the denominator as if it had been classified.

Mid-routing objective presence follows the same pooled-denominator principle and uses team-contested encounters for coaching; secured-objective presence remains separate descriptive context. Derived comparisons preserve that distinction: win-vs-loss and recent-5 versus prior-15 coaching objective presence pool contested-event numerators/denominators, while secured presence is exported separately. Early KP is likewise pooled from event counts rather than per-game percentages. The derived objects retain numerator, denominator, contributing-game count and aggregation provenance so UI and future coaching can disclose how the rate was formed.

Ordinary continuous metrics such as CS/min, DPM or gold difference remain means over comparable games; they are not event proportions and should not be forced through the pooled-event helper.

Temporal labels such as "death before enemy objective" describe sequence only; they do not claim the death caused the objective loss. For objective-consequence coaching, an enemy objective must also belong to a **team-contested** grouped encounter. An objective that the team fully concedes elsewhere on the map does not retroactively turn an unrelated death or side-lane death into an objective mistake.

## Objective-family evidence

The old Bruisienator report exposed separate Dragon/Herald/Baron-style presence concepts, but several of those fields were not reliably produced by the supplied PowerShell pipeline. The web analyzer reconstructs the underlying information directly from grouped Riot neutral-objective events.

For each supported family, preserve:
- total grouped encounters,
- encounters won by the player's team and by the enemy team,
- units secured by each team (important for multi-unit Void Grub encounters),
- player presence in team-won encounters and the secured-encounter join rate,
- team-contested encounters,
- player joins to those contested encounters,
- family-specific team-contested presence rate.

The secured and contested rates answer different questions and must not be collapsed into one field.

Normalize Riot families conservatively:
- `RIFTHERALD` → **HERALD**,
- `HORDE` → **VOID_GRUBS**,
- `BARON_NASHOR` → **BARON**,
- ordinary dragons → **DRAGON**,
- a Dragon group whose event subtype identifies Elder → **ELDER_DRAGON**.

These are descriptive control/presence facts, not proof that the player caused the objective result.

Objective-setup vision also counts supported ward **clears** in the setup window, in addition to placements. A clear is not treated as equivalent to a placement; both remain separately visible.

The old report also referenced `controlWardsBought` without reliably producing it. The web analyzer counts **committed** Control Ward purchases from Riot item timelines (catalog name, with item ID 2055 as a compatibility fallback) and subtracts an `ITEM_UNDO` that reverses the purchase. It keeps committed purchases separate from Control Wards actually **placed**. This matters because purchase discipline and placement/use are different questions, and an immediately undone shop click should not be presented as a real purchase.

## Roaming

Roaming is not "a kill outside lane."

For non-jungle lane roles on Summoner's Rift:
- begin movement sampling around minute 3,
- end the roam-detection window at the rules profile's **major-objective-era boundary** rather than assuming every queue uses 20:00,
- use 20:00 for 2026 standard Summoner's Rift,
- use 12:00 for 2026 Swiftplay,
- determine the normalized role's home lane,
- use timeline movement samples to detect a sustained departure from home lane into another meaningful zone,
- ignore base movement and ordinary home-lane activity.

Each detected roam now preserves a **per-window evidence bundle** rather than only an aggregate count:
- sampled Riot timeline path points (`time`, `x`, `y`, zone) for map rendering, including the last supported home-lane sample before departure and the supported return/end sample when available,
- player kill/assist contributions during the window,
- player deaths during the window,
- team champion kills as context,
- neutral objectives during the window with player **present vs away** evidence,
- structure/turret-plate events with supported player involvement and attribution quality,
- plates gained through supported player involvement and **home-lane** plates/turrets lost while the player is away, rather than every structure loss elsewhere on the map,
- lane-cost differential from departure to return, using **player vs direct role peer** for TOP/MID/ADC and **allied ADC vs enemy ADC** for SUPPORT when that evidence is available.

Outcomes:
- player kill/assist, a team neutral objective with supported player presence, or supported structure involvement during the departure → success,
- player death during the departure with no supported successful event → failure,
- otherwise neutral.

This intentionally improves on the supplied V21 browser-side enrichment: an unrelated dragon or turret taken elsewhere on the map must not make a roam "successful" merely because its timestamp falls inside the roam window.

For SUPPORT, also inspect the change in allied ADC versus enemy ADC CS differential during the roam. A roam that gives no supported return and costs the ADC substantial lane CS can be highlighted as expensive.

The cutoff is a behavior-analysis window, not a claim that rotations stop when Baron becomes available. After the major-objective-era boundary, movement is better interpreted as broader macro/side-lane/objective routing rather than an early roam.

### Roam lane cost

For TOP, MID and ADC with a valid same-role opponent, measure direct-role CS differential at roam departure and return:

`(player CS - peer CS at return) - (player CS - peer CS at departure)`

For SUPPORT, support-vs-support CS is not a meaningful lane-cost proxy. When both bot carries are identifiable, use the allied ADC versus enemy ADC CS differential instead:

`(allied ADC CS - enemy ADC CS at return) - (same differential at departure)`

Every roam stores the basis used as provenance. Negative means the relevant lane state moved against the player's team while the player was away.

Current coaching treats a loss of roughly 6 or more CS as materially costly. A roam is considered **empty costly** only when that lane loss has no tracked player kill/assist, no supported neutral-objective return, and no supported structure contribution. A roam can still be economically expensive even if it produced value; do not equate "successful event" with "good roam."

The action should focus on wave preparation and abort timing, not simply "roam less."

These are movement-based heuristics, not perfect ground truth. Use medium confidence unless supported by a larger sample.

## First-major-item spike utilization

Item timing and item utilization are different questions.

When both the player and the actual same-role opponent have a detected first major completed item, define a measurable **earlier-item window** only if the player's completion is at least 45 seconds earlier.

The window runs from:
- the player's first major completion,
- until the direct role opponent completes their first major item.

Within that temporary advantage window, count supported player impact:
- kill/assist involvement,
- neutral-objective participation only when the nearest supported Riot position frame places the player within the objective evidence radius,
- structure impact only with strong involvement evidence: direct Riot event credit or event-position proximity. Same-lane frame presence alone is retained elsewhere as weak context and does **not** make the item-spike window "used."

Every tracked objective/structure spike event preserves the support-evidence method so the UI can distinguish why it counted.

Also preserve whether the player dies inside the window **before any tracked impact**.

The aggregate utilization rate is:

`utilized earlier-item windows / measurable earlier-item windows`

This metric does not require the player to force a fight just because an item was purchased. Coaching should ask whether the temporary breakpoint was used to create pressure or map value before parity, while still respecting wave state and objective availability.

A window shorter than 45 seconds is not considered meaningfully actionable and is excluded rather than counted as a failure.

## First-reset sequence quality

The first meaningful purchase sequence is analyzed separately from later recalls and item spikes.

Current detection:
- reconstruct committed Riot item transactions and exclude resolved `ITEM_UNDO` reversals,
- group committed purchases into shop visits,
- estimate cash spend from patch item recipes and components actually owned before each purchase,
- find the first purchase group by 12 minutes whose **conservative spend lower bound** reaches at least 250g,
- require timeline evidence that the player had **already left base** before that purchase group,
- do not impose an arbitrary 2.5-minute lower bound,
- compare direct-role gold/CS differential before the shop with the next supported post-shop frame,
- preserve timing versus the direct same-role opponent's first comparable return purchase.

The sequence is marked:
- **economy loss** when no death contaminates the measurement and direct-role differential worsens by at least ~6 CS or ~350g,
- **economy gain** when no death contaminates the measurement and the player gains at least ~4 CS and ~150g of direct-role differential,
- otherwise neutral/mixed/unmeasured.

A death in the evidence window makes the clean economy classification unsuitable for aggregate reset coaching. The game remains visible but is excluded from the clean loss-rate denominator.

Aggregate coaching uses:
- measured and clean game counts,
- loss/gain counts,
- first-reset loss rate,
- average post-reset direct-role gold/CS swing,
- average reset timing delta versus the same-role opponent.

The instruction is not simply "recall earlier." The useful question is whether the player prepared the wave and return path so the first purchase improved or at least protected the next lane-economy window.

## Resets, shop visits and item timing

Riot timeline item purchases are grouped into approximate shop visits.

The current major-item comparison:
- identifies a meaningful completed item from patch-appropriate Data Dragon item data,
- excludes boots, consumables and trinkets,
- compares the first major completion with the actual same-role opponent.

## Committed shop ledger

Reset, shop-spend, Control-Ward purchase and major-item timing logic share one item-event ledger.

**Mechanics-sensitive item analysis also requires an exact patch-matched Data Dragon item catalog.** If only a fallback/latest catalog is available, item IDs/names may still be shown for traceability, but the analyzer withholds recipe spend thresholds, first-reset spend qualification, major-item completion timing, affordability/readiness and item-spike coaching. A fallback catalog must never silently stand in for historical/current patch mechanics.

- `ITEM_PURCHASED` enters the provisional purchase stream.
- `ITEM_UNDO` invalidates the matching transient purchase rather than leaving it counted as spend.
- sold/destroyed/undone items are handled by the reconstructed inventory ledger.
- shop-group cash spend is a **recipe-aware estimate**: current Data Dragon total cost minus supported owned build-component credit immediately before the purchase.
- dynamic discounts that Data Dragon cannot infer from timeline state remain explicitly approximate rather than silently rewritten.

The first-reset sequence therefore means the first **committed** ≥250g recipe-aware purchase group after supported base departure, not the first cluster of raw purchase clicks.

### Second major-item completion

The historical report tried to expose `item2TimeMin` while also retaining the now-obsolete `mythicTimeMin` label. The web analyzer keeps the useful timing question and retires the obsolete item class:

- identify major items from patch-appropriate Data Dragon item metadata,
- reconstruct the owned item ledger across purchase, sale, destruction and undo events,
- record the first and second milestones only when the player actually owns at least one, then at least two major items simultaneously,
- preserve the first and second major completion separately,
- compare second-major completion time with the actual same-role opponent when both are measurable,
- aggregate sample size, average second-major completion minute, and average timing delta versus the direct role peer.

This is descriptive purchase timing. It does not assume that every champion wants the same two-item curve or that faster is always better. A sold-and-rebought first item or a one-for-one upgrade must not create a false "second item" timestamp.

### Recipe-aware first-major completion readiness

The historical desktop specification described this as "Mythic gold threshold + the first recall after the threshold." Modern League no longer has a stable Mythic-item class, so the web analyzer implements the underlying decision question against the **actual first major completed item** instead of hard-coding obsolete role costs.

For the first major completion:
1. resolve the completed item's current Data Dragon recipe,
2. reconstruct item ownership from purchase, sale, destruction and undo events, and require the direct recipe components to be **simultaneously present** rather than merely purchased at some point earlier,
3. use the item's remaining combine cost (`gold.base`) as the supported completion threshold,
4. while those direct ingredients are actually present, find the first pre-purchase timeline frame where **current spendable gold** covers that remaining combine cost,
5. compare that supported affordability time with the actual completed-item purchase event.

The result preserves:
- ingredient-ready minute,
- first supported affordable minute,
- actual completion-purchase minute,
- affordability-to-purchase delay,
- whether the delay is at least 1.5 minutes,
- the same measurement for the actual same-role opponent when supported,
- the player's delay minus the opponent's delay.

This is deliberately stricter than comparing total earned gold with a fixed item cost. Total gold includes gold already converted into components, while current gold alone is insufficient until the relevant recipe pieces are owned. Requiring both the observed direct ingredients and enough current gold for the remaining combine cost better reconstructs when the completed breakpoint was actually fundable.

The purchase event is the supported shop-completion marker; it is **not** treated as an exact recall-channel timestamp. Timeline frames are coarse, so the affordability minute is an estimate. If the item recipe, a coherent component inventory state, item transaction events or a qualifying frame are missing, the measurement fails closed rather than manufacturing a timing. This also avoids treating a component that was sold, destroyed into another recipe, or undone as if it were still available for the final completion.

The existing direct-role completed-item comparison and earlier-item utilization window remain separate:
- **readiness delay** asks whether a fundable completion sat unbought,
- **completion delta** asks who completed the first major item earlier,
- **spike utilization** asks whether an earlier completion produced supported map impact before role-opponent parity.

### Greedy-stay candidate

During roughly 6–22 minutes, a timeline state can be flagged when:
- current gold is at least 1200,
- player is not in base,
- next detected shop visit is more than two minutes away.

This is a **candidate high-gold stay window**, not proof the player should have recalled immediately. Coaching should combine it with objective/death context rather than overstate it.

## Vision-action safety

For SUPPORT/JUNGLE especially, total vision is not enough; the route used to create that vision matters.

A **vision-action death** requires all of the following:

- the player placed a ward or cleared a ward,
- the player died within 20 seconds of that action,
- the death location is within 2,500 map units of the vision-action location.

The event also preserves:
- placement versus clear,
- ward type / territory when known,
- whether the action was part of objective setup,
- whether any ally was within 3,000 units at death,
- whether the death crossed the normal high-risk threshold,
- whether the death was traded.

The vision action itself does not increase the bad-death score. It is contextual evidence explaining *what the player was doing* immediately before the death.

Aggregate coaching is primarily for SUPPORT/JUNGLE and should require a meaningful number of vision actions. The recommended change is to improve route/team timing, not to ward less: establish teammate proximity, use safe information first, and then enter the ward location.

## Vision quality versus vision volume

For SUPPORT/JUNGLE especially, ward count and VPM are not enough. Preserve the share of tracked wards that qualify as objective-setup wards.

Compare:
- player's objective-setup wards / all tracked wards,
- same-role opponent's objective-setup wards / all tracked wards,
- percentage-point delta.

This distinguishes genuinely useful pre-objective vision from high raw vision volume placed too late or away from the next contest.

Aggregate coaching requires a meaningful ward sample on both sides. A lower setup share should produce a timing recommendation, not simply "place more wards."

## Vision

Preserve raw ward coordinates and ward type.

Current spatial classification distinguishes:
- offensive,
- defensive,
- river.

Also count wards near an upcoming objective as objective setup when supported by the timeline.

For SUPPORT/JUNGLE, same-role VPM comparison is especially useful. Do not assume lower VPM is always wrong without role/sample context.

### Objective setup versus the direct peer

For timeline-complete games, count wards placed shortly before and near a subsequent tracked objective for both the player and the actual same-role opponent.

Use the per-game difference:

`player objective-setup wards - same-role opponent objective-setup wards`

For SUPPORT/JUNGLE, aggregate this across enough games and report:
- average setup-ward difference,
- percentage of games in which the player places more setup wards.

This is a better coaching signal than raw vision score alone because it rewards **timely, contest-relevant setup**. It still does not measure whether a ward survived, was redundant, or was placed in the strategically perfect brush, so do not call it complete vision quality.

## Same-role level readiness in shared fights

Fight clustering first preserves **supported presence**, then separates **active involvement** from proximity-only context.

Definitions:
- **present:** the player died in the cluster, contributed to a tracked kill/assist, or a supported timeline frame places them near a kill event;
- **active:** the player died in the cluster or contributed to a tracked kill/assist;
- **proximity-only:** supported nearby position evidence exists, but Riot records neither a player death nor a kill/assist contribution in that cluster.

The legacy `attended` field remains as a compatibility alias for **active** involvement. Coaching denominators must use active involvement, never proximity-only presence.

Fight-start level differential is treated as a readiness signal only when the player is actively involved **and** the actual same-role opponent is locally present in that same fight cluster.

Current implementation:
- use the first kill-event position as the fight anchor,
- require the role opponent's timeline position to be within roughly **5000 world units**,
- compare player level with that same-role opponent,
- classify a readiness disadvantage when the player is at least **one level lower**.

This is stricter than simply comparing global role levels while the opponent may be elsewhere on the map.

Repeated active fights entered a level down can support coaching to include **level** in the pre-fight readiness check alongside items, gold and local numbers. The recommendation should be to take a nearby XP breakpoint or trade the play when the contest is optional—not to imply every level-down fight must be abandoned.

## Local numbers and fight selection

For each **active** multi-kill fight cluster, inspect the local participant count around the first kill event.

Current implementation:
- anchor on the first kill-event position, falling back to the player's timeline position,
- count allied and enemy champions within roughly **4500 world units**,
- classify the fight as locally outnumbered when there are at least **two fewer nearby allies than enemies**,
- preserve the kill score of the resulting cluster and whether the outnumbered cluster ended with more enemy kills.

Proximity-only clusters remain visible as positioning context but do not enter the outnumbered-start denominator.

This is a **fight-context** signal, not proof that the player initiated the fight. Coaching should therefore focus on the controllable follow/re-enter decision: count who is actually in fight distance and who can arrive next, rather than treating distant allies on the minimap as present.

Aggregate coaching requires repeated active samples. A local-numbers concern currently needs repeated outnumbered active clusters and a high loss rate among them before it becomes a priority finding.

## Fight readiness and purchase state

For each **active** multi-kill fight cluster, preserve the player's approximate state at fight start:
- current/unspent gold,
- gold differential versus the direct same-role opponent,
- level differential versus the direct same-role opponent,
- whether the player has completed the first major item,
- whether the opponent has completed the first major item.

Useful readiness flags include:
- **high-unspent start:** at least 1000 current gold at fight start,
- **role-gold deficit start:** at least 600g behind the direct role opponent,
- **major-item disadvantage start:** the direct role opponent has completed the first major item and the player has not.

These readiness rates use active fight involvement only. A player who is merely near a fight cannot improve or worsen the readiness denominator.

These flags do not prove the player chose the fight; some contests are forced. Coaching should therefore say the fight **began under a resource disadvantage** and recommend earlier reset/purchase planning, rather than claiming the player mechanically misplayed merely because the fight happened.

## Fight order and carry survival

The timeline analyzer groups nearby champion-kill events into approximate **multi-kill fight clusters** using time and map proximity.

For every supported-presence cluster preserve whether it is active or proximity-only. For **active** clusters preserve:
- whether the player survived,
- whether they were the first allied death,
- whether they died before a tracked kill/assist contribution.

Only active clusters enter:
- fight survival,
- first-allied-death rate,
- pre-contribution-death rate,
- high-unspent/item-disadvantage/gold-deficit start rates,
- local outnumbering rates,
- phase fight counts used by coaching.

A nearby player with no tracked contribution/death is therefore no longer credited as having "survived" a fight. Their proximity remains visible, but it cannot inflate execution metrics.

For ADC/MID/TOP, repeated first-allied-death or pre-contribution-death patterns can be treated as a positioning/entry-timing improvement signal. Do not apply the same negative interpretation mechanically to engage/support roles, where dying first can be role-contextual.

Fight clustering is heuristic rather than ground-truth teamfight labeling. Aggregate coaching therefore requires multiple **active** fight samples and should expose active, supported-presence, and proximity-only counts separately.

## Team-context comparisons

Per match, preserve:
- damage share,
- gold share,
- vision share,
- rank on team for damage/gold/vision.

A frequent #1 damage rank can be highlighted as a strength, while also explaining that dying early may be unusually costly to the team.

## Wins versus losses

Only produce strong win/loss contrasts when both groups have enough games.

Useful comparisons include:
- gold differential at 15 when the rules profile marks that checkpoint comparable,
- high-risk death count,
- objective presence,
- early KP,
- greedy-stay candidates,
- major-item timing.

These are correlations inside the player's sample. Wording must not imply causation.

## Session and requeue behavior

The analyzer may test whether performance changes within a play session or immediately after a previous result.

### Session definition

A session continues while the gap between the **end of the previous game** and the **start of the next game** is at most 90 minutes.

Each game keeps:
- session ID,
- game number within the session,
- minutes since the previous game ended,
- previous game result.

The aggregate comparison contrasts:
- session-opening games,
- game 3+ within the same session.

Current useful dimensions include:
- gold differential at 15 **only on rules profiles where @15 is a comparable lane checkpoint**,
- flagged high-risk deaths,
- DPM,
- CS/min.

The session model preserves separate coverage counts for @15-compatible games, timeline-complete games, DPM observations and CS/min observations in every session bucket. A displayed subgroup with fewer than three games is explicitly marked **thin sample** and remains traceability/context only.

A cross-bucket delta requires at least **two valid observations in both compared groups for that specific metric**. Gold@15 therefore needs two @15-compatible games per side; risky-death deltas need two timeline-complete games per side; DPM needs two valid DPM observations per side. One-game subgroup differences must never be promoted to an observed session/requeue pattern.

### Quick requeue comparison

A quick requeue is defined as the next analyzed game starting within 45 minutes after the previous game ended.

When enough examples exist, compare quick requeues after a loss with quick requeues after a win using the same behavior metrics.

The report must describe this as an **observed requeue pattern**. Do not label the player as tilted, fatigued, angry, unfocused, or otherwise infer a mental state from the data.

If the post-loss pattern is materially weaker, the recommended intervention can be behavioral and concrete: brief review, stand up, then make an intentional decision about whether to queue again.

## Session-length and requeue patterns

The analyzer may group primary-role games into play sessions using timing only:
- a session continues when the next game starts within roughly 90 minutes of the previous game ending,
- a quick requeue comparison uses a gap of roughly 45 minutes or less.

Useful descriptive comparisons include:
- session-opening game versus game 3+,
- quick requeue after a loss versus quick requeue after a win.

Compare concrete fields such as eligible gold differential at 15, high-risk deaths/game, DPM and CS/min. If a queue's rules profile marks @15 non-comparable, omit the gold@15 session signal instead of treating that raw frame as lane performance.

Do **not** diagnose tilt, fatigue, mood or motivation from these patterns. The report can say later-session or quick-post-loss performance is weaker when the sample supports it, then recommend an intentional break/checkpoint as a practical experiment.

Require multiple games in both comparison groups before producing a strong coaching statement.

## Short-term direction inside the Last 20

When the sample is large enough, compare the newest five games with the preceding games in the Last-20 sample.

Current trend dimensions include:
- CS/min,
- gold differential at 15 only for @15-compatible rules profiles,
- flagged high-risk deaths,
- DPM.

Trend conclusions need at least four valid observations in the latest five and at least five valid observations in the preceding sample. The comparison is intended to identify a recent change, not to declare that five games define the player's new true level.

Current material-change triggers are deliberately conservative:
- CS/min: about 0.6 or more,
- gold @15: about 300g or more,
- high-risk deaths: about 0.6 deaths/game or more,
- DPM: about 120 or more.

The output must show both recent and preceding values so the user can inspect the conclusion.

## Recent versus broader self

When more than 20 matches are cached, compare the Last 20 with the broader cached sample for compatible full-game metrics such as:
- WR,
- CS/min,
- KP,
- DPM,
- GPM,
- VPM.

Do not compare a timeline-only Last-20 field with an unavailable baseline field.

## Repeated opponent-champion matchups

The analyzer can aggregate repeated games against the **same opposing champion in the player's primary role**.

A matchup profile is emitted only when the opposing champion appears at least **three times** in the current primary-role coaching sample.

Preserve:
- games and win rate,
- gold and CS differential at 15,
- high-risk deaths,
- clean queue-aware early-phase solo kills/deaths versus that actual role opponent,
- queue-aware early home-lane deaths involving outside pressure,
- the player's own champion mix across those games.

This distinction is important. If the player used multiple champions, the result is **performance against that opposing champion**, not a claim about one exact champion-vs-champion matchup.

Coaching can distinguish:
- repeated direct 1v1 trouble → matchup execution review,
- repeated assisted/outside-pressure deaths → wave depth, tracking and vision review,
- repeated economy advantage → a sampled matchup strength.

Do not emit matchup coaching from one or two games. Three games remain low-confidence; five or more can reach medium confidence.

## Champion-specific behavior

Do not assume an overall weakness applies equally to every champion.

Where at least three games exist for the same champion **and role**, calculate a small champion-role behavior profile. Useful dimensions include:
- gold differential at 15 versus same-role opponent,
- CS/min,
- DPM,
- high-risk deaths per timeline game,
- first-major-item timing versus direct peer.

Champion-specific coaching compares that champion-role sample primarily with the player's own Last-20 primary-role baseline. This avoids confusing champion differences with role differences.

A three-game champion sample is low confidence; five or more can reach medium confidence. Do not make strong mastery claims from win rate alone.

## Evidence-led practice-theme synthesis

The report should not present every triggered heuristic as a separate practice objective.

Related findings are consolidated into broader coaching themes before the **Next 5 games** plan is built. Examples include:
- post-play give-backs → **Risk & death discipline**,
- side-lane timing → **Mid-game routing**,
- late resets / item windows / fight readiness → **Resets & power windows**,
- objective attendance / setup / conversion / closing → **Objectives & closing**.

A priority theme preserves:
- representative highest-priority finding,
- number of supporting findings,
- up to several supporting finding titles,
- comparison sources,
- confidence and priority.

The browser should expose the supporting finding titles beneath a selected practice theme so the player can see why it outranked the other themes.

## Measurable Next-5 practice targets

### Evidence-specific practice targets

When a priority theme has a stronger supported explanation, the five-game target should measure the corresponding observable signal rather than a looser neighboring statistic.

Current mappings include:
- post-play give-back theme → high-risk untraded post-impact deaths/game,
- side-lane timing theme → pre-objective side-lane deaths/game,
- objective explanation **recent-shop absence** → recent-shop objective absence rate,
- objective diagnosis **death before contest** → pre-objective death rate,
- objective diagnosis **setup vision** → objective-setup ward share,
- unresolved objective arrival/pathing → prior-frame objective setup rate.

Targets remain self-relative, short-term and sample-gated. The evidence explanation selects the measurement; it does not convert an association into causal proof.



The **Next 5 games** plan may attach a measurable short-term success target to a high-priority coaching theme.

Targets are **self-relative**, not population benchmarks. Each target must carry:
- coaching theme key/label,
- report metric path,
- current baseline,
- short-term goal,
- direction (higher/lower),
- unit,
- relevant sample size and minimum sample,
- five-game practice horizon,
- rationale,
- source marker `self_relative_short_term`.

The target builder may emit at most one target per selected coaching theme and at most three targets total.

Targets are only emitted when the relevant evidence count meets a metric-specific minimum. If the sample is thin or the baseline is missing, omit the target rather than fabricating a goal.

Current target magnitudes are deliberately modest and directional, for example:
- about 150g improvement in direct-role gold differential @15,
- about +0.3 CS/min,
- about -0.25 costly/high-risk deaths per game,
- about ±10 percentage points for objective/fight/repeat-death rates,
- about +15 percentage points for item-spike utilization,
- about -5 percentage points for vision-action death rate.

These are **practice checkpoints**, not claims about the player's true skill level or a universal optimal value.

The frontend should render the current baseline and target together, e.g. `0.72/game → aim ≤ 0.47/game`, and state how many relevant observations support the target.

### Scoring a previous practice target

When a later **distinct** analysis exists, the frontend may evaluate the targets saved in the previous report against the current report.

A previous target is scored only when these contexts still match:
- primary role,
- dominant Riot queue ID when both reports have one,
- major.minor patch cohort when both reports have one.

If any of those contexts changed, the target remains unscored and the UI explains why.

For a comparable target:
- **met** — current value reaches/passes the saved goal in the required direction,
- **moving closer** — at least 20% of the saved baseline→goal distance has been recovered,
- **moved away** — at least 20% of that distance moved in the wrong direction,
- **unchanged** — movement is smaller than that descriptive threshold.

This is a descriptive coaching checkpoint, not a statistical significance test. Always show the current value, the saved baseline, and the saved target together.

## Replay Review Queue

The report should turn aggregate findings into a small, ranked set of **specific replay moments**.

The queue is built only from event evidence already present in the analyzer. Current candidate sources include:
- severe/costly death aftermath,
- high-risk deaths while materially ahead,
- late-reset neutral-objective misses,
- first-allied-death / pre-contribution / outnumbered fight entries,
- clean queue-aware early direct-role solo deaths,
- expensive failed roams,
- high-risk vision-action deaths,
- first-major-item windows that are wasted or end in death before impact.

Each item preserves:
- match ID,
- game timestamp,
- champion/role and direct opponent champion,
- event minute,
- category,
- evidence,
- a concrete replay question,
- the most relevant detail tab.

Ranking prioritizes supported consequence and decision value. Duplicate findings at roughly the same moment are collapsed and the queue is capped at **two moments per match** and **ten moments total**, so one chaotic game cannot dominate the review plan.

The frontend's **Open match** action should jump to the correct Last-20 row and open the evidence tab associated with the recommendation.

This queue is a review aid, not a claim that the highest-scored event is objectively the player's single worst play.

## Coaching output contract

A coaching insight should carry:
- category,
- title,
- evidence,
- action,
- confidence,
- priority,
- comparison source.

Good form:

**What:** "Major item timing is slower than your direct opponent."

**Evidence:** "Across 8 comparable games, first major completion is 1.2 minutes later on average."

**Action:** "Look for a clean reset once carrying completion gold; do not automatically stay for another wave."

**Comparison:** "Actual same-role opponents."

Avoid vague text such as "play better around objectives."

## Confidence

Current guideline:
- 10+ relevant observations → high,
- 5–9 → medium,
- fewer than 5 → low / avoid strong aggregate claims.

A total 20-game sample does not mean every metric has 20 valid observations.

## Per-game judgments

Expanded match rows may show compact action judgments. They must:
- cite the concrete game evidence,
- distinguish strengths from improvement opportunities,
- avoid a confident label where timeline evidence is insufficient,
- never replace raw match data.

Examples currently supported:
- materially behind/ahead at 15,
- multiple high-risk deaths,
- major-item timing versus peer,
- repeated high-gold stay window,
- roam conversion,
- objective attendance,
- DPM versus peer,
- team damage rank.

## Maps

Raw Riot `{x,y}` coordinates and `mapId` are preserved.

The historical 0–15000 square heatmap is retired.

The supplied V21 still contains heatmap and roam-path canvas renderers. Heatmap parity is intentionally satisfied by the newer real Summoner's Rift map renderer rather than reintroducing a coarse synthetic square. V21's useful **roam path** capability is preserved separately: each per-game map can draw the server-derived roam paths on the same Riot map projection used for deaths and wards.

The web renderer now uses Riot's Summoner's Rift minimap asset with one shared map-11 world→image transform:
- min X = -120
- min Y = -120
- max X = 14870
- max Y = 14980
- Y axis inverted for image coordinates.

Only `mapId = 11` is plotted. Coordinates outside a small tolerance around those world bounds are rejected rather than forced onto the image.

The report currently plots:
- a Last-20 aggregate map of multi-signal high-risk deaths, with materially-ahead deaths visually distinguished,
- a Last-20 aggregate map of player ward placements, classified as offensive / river / defensive,
- a per-game **Map** tab inside every expanded match on mapId 11,
- every player death in that match, numbered chronologically so the visual points correspond to the event order,
- high-risk deaths and deaths while materially ahead as distinct visual states,
- every supported ward placement in that match with offensive / river / defensive and objective-setup distinctions.

The aggregate and per-game views use the exact same shared projection. A game whose `mapId` is not 11 is never silently projected onto Summoner's Rift: its raw coordinates stay in the analysis payload and the Map tab explicitly reports that the renderer is unavailable for that map.

The source of the map asset is Riot Data Dragon. The explicit world bounds follow the established Summoner's Rift transform used by Cassiopeia/Meraki Analytics rather than the old generic square approximation.

## Historical metrics not present in the recovered working package

The recovered November 2025 Bruisienator project was inspected directly:
- `Analyze-Playstyle.ps1`
- `Analyze-AllMatches.ps1`
- the Last-20 / Phase-2 report templates

None of those working files defines or references a DQI or AGOR formula. They therefore remain compatibility fields only and are not shown as active metrics in the web report.

Do not invent:
- DQI,
- AGOR,
- a fake static rank-above item benchmark,
- exact recall channel start/end when Riot timeline evidence does not supply it,
- causality from simple win/loss correlations.

These should remain visibly unavailable until supported by recovered code or stronger data.

## Uploaded Bruisienator V21 parity audit

The supplied archive includes `Bruisienator_ROAMS_V21_PHASE2_SAFE_STATS_ENRICH`, whose functional changes are concentrated in `template_playstyle_report_last20_phase2b.html`; the launcher/PowerShell analysis files are otherwise byte-identical across the bundled V18/V20/V21 snapshots.

A second-pass producer/consumer audit is required before declaring a legacy UI feature "implemented." The V21 HTML reads several fields that its supplied PowerShell producer does not emit. In particular, `soloDeaths`, `greedyDeaths`, `facecheckDeaths` and `deathsNearObjective` are referenced by DQI but absent from the generated per-game rows. The same audit found several intended objective/vision fields that were incompletely wired in the desktop pipeline.

Parity decisions:
- **implemented / upgraded:** departure→path→return roam rendering; per-window kill/death/objective/structure evidence; home-lane-specific plate/turret cost while roaming; support ADC lane-movement context; source-accurate V21 DQI provenance; sortable per-game evidence table; objective-family control/presence (Dragon, Elder, Herald, Void Grubs, Baron when exposed by Riot); objective-setup ward clears; Control Ward purchases distinct from placements; and second major-item completion timing versus the direct role opponent;
- **already superseded:** old win/loss profile, per-game narrative, objective/death/macro/vision/laning/teamfight/tempo text analyzers, static role thresholds, crude support-roam share, and square heatmaps are covered by richer same-role peer comparisons, evidence-backed judgments, objective evidence explanations, replay review, session/trend models and real-map spatial rendering;
- **intentionally retired:** the first-pass invented `consequence_aware_v1` DQI score. Its evidence inputs remain useful, but arbitrary overlapping weights are not a trustworthy replacement metric;
- **not fabricated:** AGOR stays unavailable because no defensible formula is present in the supplied source.

The V21 report also computed longest/current win and loss streaks. The web analyzer restores these as descriptive Last-20 facts only: contiguous results are measured inside the eligible displayed sample, but they are never used as evidence of tilt, momentum, confidence, fatigue, or any other psychological state.

When a legacy feature is superseded, preserve its underlying information need rather than duplicating a weaker heuristic under a second label. When a legacy consumer references data its producer never emitted, record that as an incomplete historical feature rather than silently inventing the missing data.


## Game-arc reconstruction

The report may derive a coaching-readable game arc from already-exported per-game evidence. This is a presentation/interpretation layer; it must not invent events or bypass the backend sample rules.

Game arcs use the same selected-role, selected-queue Last-20 games as the report. When `dataQuality.mechanicsCohortApplied` is true, aggregate arc patterns, outcome fingerprints, advantage-conversion funnels and recurring turning points use only the backend-selected current-mechanics cohort. Older-mechanics matches may remain visible in match history as context, but are labelled context-only and do not enter those coaching aggregates.

Game arcs are role-aware.

For **ADC, MID and TOP**, role-gold states use the same bands as the evidence-table filters:
- **ahead:** direct-role gold differential > +100g,
- **close:** -100g through +100g,
- **behind:** direct-role gold differential < -100g.

The @15 state requires `lane15Comparable`. The @15→@25 transition additionally requires `fixed15to25Comparable`, a supported @25 frame and a coaching-safe @25 state. Closing interpretation requires `closing25Comparable`. These carry-role arcs use:
1. **Lane @15** — same-band direct-role economy state.
2. **Reset / power** — first-reset aftermath or earlier-first-major power window.
3. **15 → 25** — direct-role gold-state transition.
4. **Teamplay** — supported side-lane/objective/fight-entry evidence.
5. **Finish** — result plus supported @25 state and late-risk context.

For **SUPPORT**, do not force a carry-lane gold conversion story. The per-match sequence is:
1. **Roam / lane** — detected roam return together with associated ADC-vs-ADC lane movement.
2. **Vision vs peer** — direct-role VPM and pre-objective setup-ward differences when the opposing Support is high-confidence.
3. **Objective setup** — supported prior setup and contested-objective presence.
4. **Teamplay** — pre-contribution fight deaths, high-risk vision deaths or rapid repeat-death evidence.
5. **Finish** — result plus late-risk context, without causal attribution.

For **JUNGLE**, the per-match sequence is:
1. **Farm vs Jungle** — direct-jungle CS/min difference.
2. **Tempo vs Jungle** — first tracked impact and, when available, first-major timing versus the enemy Jungler.
3. **Objective setup** — supported prior setup and contested-objective presence.
4. **Teamplay** — the same supported fight/risk evidence.
5. **Finish** — result plus late-risk context.

SUPPORT/JUNGLE aggregate patterns require at least two known role-sequence components in a game and at least two games with the same sequence before it is called repeated. Their aggregate arc panel shows role-sequence evidence coverage instead of the carry-role ahead/close/behind funnel.

For ADC/MID/TOP, a transition is called **repeated** only when the same @15→@25 state transition occurs in at least two coaching-cohort games. A recurring turning point for any role likewise requires the defined signal in at least two timeline-complete coaching games. Counts are games containing evidence, not raw event totals.

Carry-role advantage-conversion funnels remain descriptive state-conversion summaries, not causal models or significance tests. SUPPORT/JUNGLE role-sequence patterns are also descriptive and must never be interpreted as causes of match outcomes.

Missing timeline or checkpoint evidence must remain explicit. It must never be converted into a clean-risk claim, a preserved lead, successful setup, or any other positive coaching conclusion.


For SUPPORT and JUNGLE role-sequence arcs, objective-setup state and setup-coverage counts use `objectiveReadiness.contestedJoined`. The team-secured `objectiveReadiness.joined` field must not define setup timing or whether a game has setup evidence. The per-match `roleArcObjectiveStage()` follows the same rule for every role: `earlySetupJoins / contestedJoined`; its directional setup tone requires at least two joined team-contested encounters. Legacy team-secured joins may be printed only as traceability and never enter the setup percentage.

## Decision-card evidence thresholds

The prominent fight/reset/risk/power-window cards may display a measured value before it is mature enough for a directional coaching judgment, but thin samples must remain visually neutral.

Use the analyzer's own coaching floors:
- contested-objective context: at least 5 supported contested encounters before directional coloring,
- fight survival: at least 8 attended fight clusters,
- high-risk deaths/game: at least 5 timeline-complete games,
- first-reset economy-loss rate: at least 4 clean measured reset sequences,
- earlier-item-window utilization: at least 4 eligible first-major advantage windows,
- early-lead give-back rate: at least 4 measured ≥500g pre-15 lead opportunities.

Below those floors, show the value and sample count for traceability, label it **thin sample — descriptive only**, and keep the card neutral. A small denominator must not visually impersonate high-confidence evidence.


## Recent-direction evidence parity

The **Recent direction** card and recent pulse compare the latest five selected-role coaching games with the preceding role sample. They are short-window descriptive signals, not an independent trend experiment, and they must not quietly switch populations or use looser evidence than the role analysis they summarize.

Prior objective setup uses each game's `earlySetupJoins / contestedJoined` percentage and then averages those valid game percentages, matching the main equal-weight team-contested setup model. Contested-objective presence follows the same per-game-then-mean rule. The historical `objectiveReadiness.joined` field is team-secured presence context and must not be used as the denominator for this coaching trend.

Event-rate trends such as roam conversion and vision-action safety remain pooled over opportunities but require both opportunity volume and contributing-game spread. Objective setup and contested-objective presence are different: their headline recent/prior values are equal-weight means of valid per-game percentages, while pooled encounter counts remain coverage evidence only. For SUPPORT, latest-five roam conversion requires at least 4 attempts across 3 games; ADC lane movement requires at least 4 measured windows across 3 games; vision-action safety requires at least 12 actions across 4 games; prior setup and contested-objective presence require at least 5 qualifying encounters across 3 games. The prior comparison side requires at least 5 contributing games and the configured opportunity floor. JUNGLE objective setup/presence and MID roam/setup use the same denominator-family rules.

Support ADC lane movement remains a mean of per-game means. Its trend object carries measured-window counts separately from measured-game counts so a few event-heavy matches cannot manufacture directional confidence.


## Report information hierarchy

The prominent report layers have deliberately different jobs and should not duplicate one another:

1. **What should drive the next games?** — strongest supported limiter, bankable strength and recent direction.
2. **Direct-role comparison** — actual same-role opponents from analyzed matches. ADC/MID/TOP emphasize role gold, CS/min and DPM; SUPPORT/JUNGLE replace weak carry metrics with VPM and pre-objective setup-ward differences. First-major timing, first tracked impact and peer-matched repeat-death recurrence remain available when supported. Directional coloring uses the analyzer’s existing evidence floors.
3. **Raw selected-role output** — the player's own win rate, KDA, CS/min, KP, DPM and deaths/game. These cards remain neutral and contain no benchmark inference.
4. **ADC rank comparison** — the external population/rank reference, kept separate from actual per-match opponents.

Do not duplicate external ADC benchmark claims in the raw KPI strip or direct-role comparison. Do not present direct same-role opponents as population rank averages.


## Combined-intelligence evidence floors

Compound cards join multiple metrics into one interpretation, so their tone must be at least as conservative as the underlying coaching rules. A compound card may remain visible below threshold for traceability, but it stays neutral and is marked **thin sample — descriptive only**.

Current minimums:
- lead → preservation: 4 measured early-lead games,
- farm ↔ map trade-off: 4 comparable mid-routing games,
- item timing → impact: 4 comparable first-major timing games / 4 eligible earlier-item windows when utilization is interpreted,
- resources → fight uptime: 8 attended fight clusters and at least 5 coaching games,
- death → recovery stability: 8 measured repeat-death opportunities.

Combining metrics must never make a thin input look more certain than it was individually.


## Rolling progress comparison

Saved-report development comparisons are **rolling Last-20 comparisons**, not independent before/after experiments. The UI must show how many match IDs overlap, how many new games entered and how many older games dropped.

General metric comparison is withheld when the selected primary role, selected queue context or verified mechanics cohort changes. A patch change does not automatically erase every descriptive comparison, but it is disclosed prominently; saved Next-5 target scoring remains stricter and is withheld across patch changes.

Headline progress uses denominator-safe metrics only. Each metric must meet its own analyzer-aligned evidence requirements in **both** reports before a delta is eligible. A simple metric may have one denominator; event-based role metrics can require multiple paths, such as roam attempts **and** contributing games, or objective encounters **and** objective-event games. Materiality is expressed as the observed directional change divided by that metric's predefined practical change band. The UI calls material movement **favorable shift** or **unfavorable shift**, not proof of improvement/decline.

Support rolling progress uses the same floors as the live Support lens: roam conversion needs 4 attempts across 3 games; ADC lane movement needs 4 measured windows across 3 games; vision-action death rate needs 12 actions across 4 games; contested-objective presence needs 5 encounters across 3 games. Jungle/Mid recent-shop objective absence and Jungle contested-objective presence likewise require 5 contested encounters across 3 games.

Only the strongest material shifts are kept prominent. Metrics that remain inside their practical change bands are placed in a collapsible stable/smaller-shifts section. Missing or thin metrics are counted as withheld rather than silently converted to zero.

Heavy Last-20 overlap, analyzer-version changes and patch changes must remain visible context. No rolling comparison should be described as an independent experiment or causal development estimate.


## Frontend direct-peer fail-closed rule

Backend direct-peer eligibility is authoritative all the way through presentation. A per-game peer-relative coaching state exists only when `directPeerComparable === true`, meaning both player and opponent role resolution passed the high-confidence Riot-position requirement.

When that flag is not true:
- Ahead / Close / Behind @15 filters must not include the game.
- Match-history role-gold badges and game-arc @15/@25 states are withheld.
- The evidence-table role-gold coaching cell stays neutral and displays **peer withheld** rather than classifying the raw delta.
- Peer-relative first-reset economy, early-lead and first-major power-window arc signals are withheld.
- Peer-dependent recurring turning points cannot count the game.
- Compact match-history copy must not call the inferred champion a direct role opponent.

Raw checkpoint/opponent material may remain in the technical traceability view with its confidence context, but it must not leak back into coaching summaries through frontend-derived logic. Legacy saved reports without an explicit trusted-peer flag therefore fail closed until re-analysis rather than being assumed comparable.


## Champion and repeated-matchup evidence gates

Champion diagnostics may combine self-only and opponent-relative fields, but their eligibility is different. Champion DPM and high-risk-death context can use the player's own valid champion games; role-gold @15 and first-major timing versus peer use only games where `directPeerComparable === true`.

Repeated opponent-champion matchup groups are stricter: a game may enter the group only when the opponent is a trusted direct-role peer. An inferred or low-confidence opponent champion must not define a repeated matchup.

Every diagnostic chip uses its own support count. Directional coloring requires at least 3 relevant observations: 3 lane-comparable trusted-peer games for role-gold chips, 3 measurable DPM games for DPM chips, 3 timeline-complete games for champion risk, 3 first-major peer comparisons for item timing, and at least 3 relevant home-lane deaths before an outside-pressure share is directionally colored. Backend champion highlights use the same metric-specific denominator: a high-output DPM highlight requires at least 3 measurable DPM games, not merely 3 total champion games. Below those floors the value may remain visible for traceability but the chip is neutral.


## Death-pattern review priority

High-risk death maps classify each flagged death into one primary supported pattern. The page separates **recurring patterns** (at least two deaths) from one-off patterns; one-offs remain available in a collapsed traceability section and are not promoted as recurring behavior.

Recurring pattern cards are ordered lexicographically by bounded consequence evidence:
1. more **severe** measured aftermath,
2. then more **costly** measured aftermath,
3. then more **untraded costly** aftermath,
4. then raw recurrence count.

This is a review-priority ordering, not a numeric severity score and not a causal model. A pattern does not become "worse" merely because unlike consequence types have larger numeric values.

Pattern cards disclose aftermath measurement coverage and repeat-death-contaminated economy samples. Contaminated economy windows must not be presented as clean post-death gold/CS loss evidence. Objective/structure aftermath may still remain independently supported when its own bounded attribution rule is satisfied.


## Practice-to-replay bridge

The practice plan may attach up to two ranked replay-review moments to each priority. This bridge is navigation over already-supported evidence; it does not create a new finding.

Replay categories are matched conservatively from the practice theme:
- reset/shop themes → reset and item-spike moments,
- lane/duel themes → early-lead and matchup moments,
- lead-preservation themes → early-lead and lead-protection moments,
- objective/setup themes → objective-setup moments,
- fight/output themes → teamfight and fight-selection moments,
- death/recovery/risk themes → death-consequence and lead-protection moments,
- vision themes → vision-safety moments,
- roam themes → roaming moments.

Only moments already present in the backend-ranked `replayReviewQueue` are eligible. The practice card never manufactures a replay example just to fill the UI. If no ranked moment matches a priority, the priority remains aggregate-only.

Opening a linked moment must preserve the backend-selected evidence tab and match ID so the user lands on the relevant death, reset, fight, objective, or macro context directly.


## Next-5 target outcome scoring

A saved practice target is not scored merely because a later report exists.

Each target stores:
- the exact metric path,
- the baseline and goal,
- direction and unit,
- the legacy baseline sample size/minimum fields for compatibility,
- the denominator path(s) needed to re-evaluate the same metric later,
- explicit `sampleRequirements` for new reports, with an independent minimum for every required denominator or game-spread path,
- a requested practice horizon (currently 5 new games).

Before scoring a target:
1. role, queue, verified mechanics cohort and patch context must remain comparable;
2. at least the target's requested number of **new match IDs** must have entered the current rolling Last-20 since the baseline report;
3. every saved current-evidence requirement must still pass. A target can therefore require combinations such as **4 roam attempts across 3 games**, rather than collapsing unlike denominators into one synthetic sample count.

Until both the new-game horizon and all current evidence requirements are satisfied, the target is shown as **pending**, with each current requirement displayed separately. It must not be called met, moving closer, moved away, or unchanged.

New targets use `coachingSummary` for non-peer self metrics such as CS/min, but role-relative Gold @15 now uses `peerComparison.avgGoldDiff15` with `peerComparison.laneGames15`. Legacy `summary.csMin` targets are still remapped to `coachingSummary.csMin`. Legacy `summary.goldDiff15` / `coachingSummary.goldDiff15` practice targets are not force-migrated: their stored baseline may include peer observations that current coaching correctly withholds, so follow-up scoring marks them **re-baseline required** and a new trusted-peer target must be created.

Session Gold @15 practice targets use the trusted/comparable subgroup-specific `lane15Games` counts both when the target is created and when it is later scored. Support roaming targets prefer `meanGameSupportRoamAdcLaneMovementCs` with separate measured-window and measured-game requirements, keeping Next-5 semantics aligned with the main Support coaching surfaces.


## Match-story filters

The expandable Recent match story can be filtered without changing any report calculation or saved sample.

Supported filters:
- wins / losses,
- ahead / close / behind @15 using the **same** direct-role gold bands as the evidence table,
- **Risk flagged**: only timeline-complete games containing at least one high-risk death flag or at least one measured costly-death aftermath,
- **Replay priority**: only games with at least one backend-ranked item in `replayReviewQueue`.

The filter chips display counts from the full selected-role report sample. The 10-row default and Show all control apply *after* the story filter, so filtering does not silently change analysis; it changes only which rows are visible.

A game with a missing timeline must never enter **Risk flagged** merely because another field is absent or zero. Conversely, an unflagged game must not be described as proven safe; the filter means only that the analyzer has supported risk evidence for included games.


## Coaching-cohort evidence surfaces

Any surface that tells the player what to practise or what to rewatch must use the same mechanics-filtered coaching cohort as the backend coaching model when `mechanicsCohortApplied` is true.

This includes:
- replay-review priority,
- practice-to-replay links,
- high-risk death-pattern maps,
- ward spatial summaries,
- game-arc aggregates,
- outcome fingerprint analysis.

Older-mechanics games may remain visible in ordinary match history as **context only**, but they must not generate current replay priorities, recurring death-pattern conclusions, ward-pattern conclusions or practice evidence.

If no mechanics cohort is applied, these surfaces use the full selected-role coaching sample as before.


## Overlapping late-risk categories

Late closing evidence distinguishes **high-risk** deaths from **costly** deaths. The same death may satisfy both definitions.

Game-arc finish text must therefore display the two category counts separately and must never add them together as though they were unique deaths. For example, `1 high-risk · 1 costly` can describe one death carrying both labels.

The presence of either category may flag a game for late-risk review, but category overlap must remain explicit and neither category is assumed to be the sole cause of a win or loss.


## Population benchmark freshness

External population references must disclose their capture age and patch context separately from the current analyzed Riot sample.

The current LegendsTracker rank corpus was captured on **2026-03-23**, during Riot patch **26.6**. The analyzer exports `sourceCapturedAt`, `sourceCapturedPatch`, `calibrationAgeDays` and `freshnessStatus`.

A reference older than 90 days is labeled **Historical reference** in both the ADC radar and benchmark bridge. Historical rank references may remain useful for broad cross-tier context, but:
- they are not current-patch expected values,
- they do not feed coaching priorities or practice targets,
- they do not become promotion/rank predictions,
- their age must be visible before the user interprets the comparison.

A newer public dataset should replace the formal corpus only when its rank/role selection, sample provenance and values are reproducibly retrievable. Freshness alone is not enough reason to replace a transparent benchmark with an opaque one.


## Turning-point outcome association

Recurring game-arc turning points may show a **descriptive outcome association** only when both comparison groups are large enough:

- at least 3 timeline-complete coaching games **with** the signal,
- at least 3 timeline-complete coaching games **without** the signal.

When eligible, the card shows:
- win rate in games containing the signal,
- win rate in timeline-complete coaching games without it,
- the signed percentage-point difference.

This comparison is never labelled causal impact. A signal can co-occur with game state, champion choice, opponent strength or other unmeasured context. If either side has fewer than three games, the card may show the signal's own win rate for traceability but must withhold the with-vs-without difference.

Turning-point cards remain ordered by recurrence, not by observed win-rate difference, to avoid ranking noisy associations as if they were validated drivers.


## Coaching charts and visual snapshots

Surfaces that summarize a "typical" current game must use the same mechanics-filtered coaching cohort as the coaching model when a mechanics cohort is active.

This includes:
- lane/economy trend charts,
- consistency medians and middle-50% summaries,
- champion snapshot counts/win rates,
- first-major item snapshot timing.

These are coaching interpretation surfaces, not archival history. Older-mechanics games remain visible in the Recent match story and technical Game evidence table as context, but must not shift current chart distributions, consistency bands or first-major timing summaries.

The report header may still state the full selected-role report depth alongside the coaching-comparable count so the distinction remains visible.


## Practice-plan continuity

Development reporting should distinguish metric movement from **plan continuity**.

Compare the current and previous top-three actionable priority themes only when the saved reports share the same role, queue and verified mechanics context. Show:
- how many prior top-three themes remain in the current top three,
- which themes are newly promoted,
- which prior themes dropped out,
- the status of the previous Next-5 targets.

A dropped priority is **not** evidence that the underlying problem is solved. It may have improved, become lower priority relative to another issue, lost evidence support, or moved outside the current rolling window.

The continuity read is marked early until at least five genuinely new match IDs have entered the current report. Before that point, large Last-20 overlap can make plan turnover unstable.

Use the labels **focus mostly retained**, **focus partly shifted**, and **focus set changed** as descriptive plan-state summaries only. Do not treat plan persistence as proof that coaching failed, and do not treat plan turnover as proof that coaching succeeded.


## Priority-to-match evidence linkage

The top coaching priority should lead directly to concrete replay evidence.

Use the same category mapping that links practice themes to the ranked replay-review queue. The **Current focus** match-history filter contains only matches with at least one ranked replay moment whose category matches the current top priority. This is intentionally narrower than a fuzzy stat/text match.

The primary-limiter card may show a **Review matching games** action only when at least one such match exists. Activating it changes only the visible match-history filter and never changes the report sample or recalculates coaching conclusions.

A focus-match badge means "this game contains ranked replay evidence relevant to the current top priority." It does not mean that the game caused the priority, that every mistake in the game belongs to that theme, or that games without the badge are irrelevant.


## Priority evidence chain

The top priority should expose an auditable coaching chain rather than appear as a black-box verdict:

1. **Signal** — the representative evidence statement from the highest-scoring supported priority theme.
2. **Reinforcement** — additional finding titles grouped into the same coaching theme.
3. **Replay proof** — the highest-ranked replay-review moment whose category maps to that theme, when available.
4. **Next-5 measure** — the denominator-safe self-relative practice target, baseline and goal.
5. **Action** — the coaching prescription attached to the priority theme.

Missing links remain explicit. A priority can be evidence-supported even when no replay-queue moment or denominator-safe short-term metric is available.

This chain is an evidence trace, not a causal proof. The replay example illustrates the supported theme; it does not establish that the replay event caused the aggregate pattern. Priority rank can change as genuinely new games enter the rolling Last-20 sample.


## Phase-risk diagnostic

The report may surface early / transition / late decision risk using the backend `phaseRisk` model. Rates are normalized by **actual phase exposure minutes**, not by games alone.

A phase is eligible for a hotspot comparison only with at least 5 compatible timeline games and at least 20 exposure-minutes.

Use the analyzer's existing hotspot rules:
- **high-risk hotspot:** at least 0.35 high-risk deaths per 10 phase-minutes and at least 0.15/10m above the next-highest eligible phase;
- **costly-death hotspot:** at least 0.30 costly deaths per 10 phase-minutes and at least 0.12/10m above the next-highest eligible phase.

If no phase clears both the absolute-rate and separation conditions, say **no hotspot call**. Lower-risk phases remain neutral; they are not automatically labelled strengths.

Phase context may pair the normalized risk with existing supported evidence: direct-role gold / reset evidence early, 15→25 farm/objective routing in transition, and @25 lead/deficit conversion late. These contextual metrics do not alter hotspot classification.

Phase boundaries are rule-profile aware. Do not hard-code standard-SR timestamps onto accelerated or otherwise incompatible rules profiles.


### Reviewing repeated arcs

Each repeated @15→@25 state-transition card may link directly to the collapsible match-history rows that generated that transition.

The temporary **Game arc** filter matches games by the exact `gameArcTransition().key`; it is not a text search and does not recalculate the report. If the selected arc no longer exists after another report/profile is loaded, the filter must reset to **All** rather than leave an invisible empty filter active.

Reviewing a repeated arc exposes examples of the state transition. It does not imply that the transition caused the game result; win rate and late-risk context remain descriptive.


## Canonical priority ordering

When the backend exports `priorityThemes`, its order is authoritative. The backend has already combined source priority, confidence and supporting-finding count into the theme score and sorted the result.

All action surfaces must consume that same order:
- Primary limiter,
- priority evidence chain,
- Current focus replay/match filter,
- Next-5 practice plan,
- practice-plan continuity.

The frontend must not re-sort grouped `priorityThemes` by raw source priority, because doing so can make different sections disagree about what priority #1 actually is. Only the legacy `recentFocus` fallback may be locally ordered by its raw priority/score fields.


### Mid-routing replay evidence

The ranked replay queue includes a dedicated **mid routing** category for supported isolated side-lane deaths after the macro-transition boundary.

A pre-objective side-lane review moment requires:
- a recorded top/bot-lane death after the role/rules-aware macro-transition boundary,
- no ally within 3,000 units,
- and a tracked neutral-objective event within 90 seconds.

The replay evidence preserves the exact death minute, lane, time to objective, direct-role gold state when available, and high-risk classification. Other isolated side-lane deaths enter this replay category only when they already cross the high-risk threshold.

The Mid-game routing priority maps directly to this category. This prevents the Current focus filter from substituting generic death clips for routing-specific evidence.


### Evidence-specific replay mapping

Current-focus replay matching must use the **representative and supporting finding titles** inside a priority theme before considering its broad grouped key.

Broad groups such as `early-lane` or `objectives-closing` deliberately cover multiple behaviors. The group name alone must not make:
- a farming problem look like a matchup/duel problem,
- a closing/lead-protection problem look like an objective-setup problem,
- or another non-replayable aggregate signal inherit unrelated clips.

Narrow key-level fallbacks are allowed only when the grouped theme has a single defensible replay family (for example death-risk, reset-power, mid-routing, teamfights, vision or roaming).

If no replay category is supported by the actual finding, show no matching replay rather than manufacturing a loose connection.


## Rate uncertainty

Prominent binomial coaching rates should expose denominator uncertainty rather than only a point estimate. The frontend uses a two-sided **95% Wilson score interval** for supported success/total pairs such as:
- contested-objective joins / contested encounters,
- survived active fights / active fight involvements,
- first-reset economy-loss sequences / clean measured first resets,
- utilized earlier-item windows / eligible earlier-item windows,
- early-lead give-backs / measured early-lead opportunities.

The interval is a sampling-uncertainty aid for the observed proportion. It is **not** a confidence score for the coaching interpretation, is not a causal estimate, and does not override the analyzer's minimum evidence floors. A below-threshold card remains neutral even if its point estimate looks extreme.

The visual meter keeps the point estimate and overlays the Wilson interval. Wider intervals make small denominators visibly less certain; narrower intervals reflect more observed opportunities, not stronger causal proof.


## Per-match chronological evidence ledger

Expanded Recent match story rows may include a collapsed chronological evidence ledger. Its purpose is to bridge the five-stage game arc and the full technical tabs without dumping every timeline event.

Eligible ledger entries are supported milestones already present in the report:
- first meaningful committed shop and its bounded post-reset evidence,
- first and second major item ownership milestones when exact item mechanics are available,
- measured early direct-role lead peak / give-back state,
- comparable @15 and @25 direct-role checkpoints,
- first tracked supported impact,
- supported events inside an eligible earlier-item power window,
- ranked replay-review moments.

Direct-role timing/economy language is gated by the same high-confidence role-peer requirement used elsewhere. If the role peer is withheld, own-item/shop milestones can remain visible but peer-relative deltas are omitted. Missing timeline evidence must produce an explicit unavailable state rather than a fabricated ledger.

The ledger is chronological, collapsible by default, and capped to a compact set of key moments. It is an evidence navigation aid, not a claim that the listed moments caused the match result.


## Live practice triggers

Each displayed practice priority may include a compact **If → Then** trigger. The trigger is a usability layer over the already-selected coaching theme; it must not create a new diagnosis or outrank the analyzer.

Trigger families are keyed to the existing grouped coaching themes:
- early lane & matchup,
- risk & death discipline,
- resets & power windows,
- mid-game routing,
- objectives & closing,
- teamfights & output,
- consistency & session habits,
- recovery play,
- vision,
- roaming.

The trigger may inspect the representative/supporting titles to choose a narrower instruction inside that family (for example lead preservation vs farming inside early lane, or item-spike use vs first-reset quality inside reset/power). It must stay consistent with the analyzer's supported semantics and must not invent hidden game state.

The goal is operational recall: a player should be able to recognize the condition in-game and execute one simple response. The full evidence, replay links, Next-5 metric and longer coaching action remain available immediately around it.


## High-level objective-family overview

The main decision section may summarize the existing objective-family summary so Dragon, Elder, Baron, Rift Herald and Void Grub evidence does not remain hidden in Advanced Metrics.

For each observed family, show:
- player joins / supported contested encounters and the contested-presence point estimate,
- a 95% Wilson interval for that contested-presence proportion,
- team-controlled vs enemy-controlled encounters,
- units secured by each team, preserving multi-unit objective semantics such as Void Grubs,
- presence in team-secured encounters when available.

Objective-family presence is descriptive context, not a generic role grade. A family with fewer than three contested encounters remains thin/context-only. A "review clue" may identify the lowest contested-presence point estimate only among families with at least three contested encounters, and must explicitly remain a replay-priority clue rather than a causal statement.

This surface consumes the existing rules-aware objective-family model. It does not reconstruct or rename objective families from raw event strings in the browser, and preserves Elder Dragon as distinct when the backend can identify it.


### Objective-family match linkage

A sufficiently observed objective-family card may link into Recent match story using a visibility-only objective-family filter.

The link is driven by the existing per-game objectiveFamilyStats key from the backend. A match qualifies when that exact family has at least one supported contested encounter. The browser must not infer family identity from free-text objective labels.

Keep event and game denominators separate:
- the family card's joined / contested values count supported contested objective encounters,
- the review button states the number of matching games,
- filtering changes only which match-story rows are visible and never recomputes the report sample or coaching aggregates.

The temporary family filter should be visible only while active, just like repeated-arc review. Returning to All restores the ordinary match-story view.


## Top-level evidence health

The action-first section may expose a compact Evidence health strip so the coverage behind top conclusions is visible before the user reaches the full Trust & coverage panel.

Do not collapse evidence health into one synthetic score. Keep at least these dimensions separate:
- timeline-complete coaching games,
- high-confidence direct-role peer games,
- comparable @15 games with timeline + trusted peer + compatible lane checkpoint,
- mechanics-cohort status,
- timeline games with an exact patch-matched item catalog.

Use analyzer-aligned readiness floors for the compact state labels: 5 timeline behavior games, 5 trusted direct-peer comparisons, 5 comparable @15 games and 4 exact-catalog item-window games. Mechanics is Limited when the newest mechanics revision is unverified or the analyzer must use a broader/mixed fallback.

Ready means the dimension clears its minimum evidence floor; it does not mean the conclusion is certain, causal or immune to sample variance. Limited and Withheld must remain explicit rather than being averaged away by stronger dimensions.


## Support-specific lens

SUPPORT reports may surface a dedicated role lens rather than merely hiding ADC-only benchmark UI.

The Support lens uses analyzer-exported evidence only:
- detected early roam conversion inside the queue-specific roam-analysis window,
- change in ADC-vs-ADC CS differential during measured Support roam windows,
- repeated ADC-costly roams (at least 6 CS lost without a supported roam return),
- vision-action death evidence,
- prior neutral-objective setup presence,
- team-contested neutral-objective presence.

Use event floors together with game-spread floors: roam conversion needs at least 4 attempts across 3 games; ADC lane movement needs at least 4 measured windows across 3 games; vision safety needs at least 12 actions across 4 games; and objective setup/presence needs at least 5 supported encounters across 3 games. Two or more costly roam windows below the combined window/game floor may be shown as a **review cue**, but must remain visually and textually thin evidence rather than being promoted to a stable negative pattern.

ADC lane movement is the observed change in ADC-vs-ADC CS differential during the detected Support roam window. Positive movement favors the allied ADC; negative movement is lane cost. It is useful opportunity-cost evidence, but it does not prove the Support alone caused every CS change.

This panel must remain hidden unless the selected report role is SUPPORT. Other roles retain their own generic/role-appropriate report surfaces without Support-specific assumptions.


A stable ADC lane-movement read requires 4 measured ADC lane-movement windows across 3 games. Below the combined window/game floor, repeated costly windows remain a review cue only.

## Top, Mid and Jungle role-specific lenses

TOP, MID and JUNGLE reports should not fall back to an ADC-shaped interpretation after ADC population widgets are hidden. Each role may surface a dedicated lens, but only from analyzer-exported evidence that already has a defensible role interpretation.

### TOP lens

The TOP lens focuses on **lane state → lead preservation → side-lane timing**:
- direct-role gold differential at 15 versus the actual TOP opponent, minimum 5 comparable @15 games,
- CS/min delta versus the actual TOP opponent, minimum 5 direct-role comparable games,
- clean direct-role solo-duel K/D as a review signal, minimum 3 supported duel events before directional coloring,
- give-back rate among measured ≥500g pre-15 role leads, minimum 4 lead opportunities,
- supported side-lane deaths shortly before contested neutral objectives, minimum 5 timeline-complete games before directional coloring.

Side-laning itself is never treated as an error. Only supported death/timing evidence is judged. A death while split does not prove the split decision was wrong without the event context.

### MID lens

The MID lens focuses on **lane resources → first map impact → reconnect**:
- direct-role gold differential at 15 versus the actual MID opponent, minimum 5 comparable games,
- CS/min delta versus the actual MID opponent, minimum 5 direct-role comparable games,
- first tracked kill/assist/objective impact timing versus the actual MID opponent, minimum 5 comparable impact games,
- early roam conversion from detected roam windows, minimum 4 attempts,
- supported 15→25 objective presence inside comparable mid-routing games, minimum 4 routing games.

Roam conversion is not a command to roam more. A converted roam can still be expensive; read it together with role-gold/CS state and the 15→25 routing evidence.

### JUNGLE lens

The JUNGLE lens focuses on **farm/item tempo → map impact → objective readiness**:
- CS/min delta versus the actual enemy jungler, minimum 5 direct-role comparable games,
- first tracked kill/assist/objective impact timing versus the enemy jungler, minimum 5 comparable impact games,
- first-major completion timing versus the enemy jungler, minimum 4 comparable item games,
- supported prior objective setup presence 45–105 seconds before joined neutral-objective events, minimum 5 joined observations,
- supported presence in team-contested neutral-objective encounters, minimum 5 contested observations.

Objective presence/setup is not a smite-skill score, objective ownership score or proof that the jungler caused the objective result. It is readiness/presence evidence only.

### Shared rules

TOP/MID/JUNGLE role lenses use the same selected-role, selected-queue, mechanics-filtered coaching cohort as the rest of the report. Thin samples remain neutral and explicitly descriptive. Direct-role comparisons always mean the actual same-role opponent from analyzed matches, not population rank averages.

The role-specific lens panel must remain hidden for ADC and SUPPORT. ADC keeps its dedicated external rank-reference layer; SUPPORT keeps the separate roam/vision/objective Support lens.


## Role-aware outcome fingerprint

The win-versus-loss fingerprint is descriptive and must use a metric set appropriate to the selected role rather than applying one ADC-shaped set to every report.

Current role sets:
- **ADC:** role gold @15, DPM delta versus the actual ADC opponent, high-risk deaths/game, kill participation.
- **TOP:** role gold @15, CS/min delta versus the actual TOP opponent, measured early-lead give-back, pre-objective side-lane deaths.
- **MID:** role gold @15, first tracked impact timing versus the actual MID opponent, detected early-roam conversion, 15→25 objective reconnect.
- **JUNGLE:** CS/min delta versus the actual enemy jungler, first tracked impact timing versus the enemy jungler, contested-objective presence, prior objective setup.
- **SUPPORT:** detected roam conversion, measured ADC-vs-ADC CS change during Support roams, vision-action death rate, prior objective setup.

Per-metric win/loss means may be shown when both outcome sides have at least 2 valid observations. Directional color and "largest standardized separation" require at least **3 valid observations in wins and 3 in losses for that metric**. Thin metrics remain neutral and explicitly say that directional color is withheld.

Standardized separation remains Hedges-corrected and descriptive only. It is not a causal estimate, significance test or prescription to optimize the displayed metric.


For SUPPORT and JUNGLE, the **Prior objective setup** fingerprint is calculated per game as `earlySetupJoins / contestedJoined`. The historical team-secured `objectiveReadiness.joined` field is not a valid denominator for this coaching metric.

ADC, MID and TOP Role gold @15 fingerprint observations require `trustedDirectPeer(g)`, a compatible @15 checkpoint, and a finite gold delta. Low-confidence or inferred role opponents therefore cannot enter the win/loss gold separation.

Directional coloring still requires at least 3 valid games in wins and 3 in losses. Event-based fingerprint metrics additionally require their opportunity floor on **each** outcome side: roam conversion ≥4 attempts; Support ADC lane movement ≥4 measured roam windows; vision-action death rate ≥12 vision actions; contested-objective presence ≥5 contested encounters; prior objective setup ≥5 joined contested-objective encounters. The means remain equal-weight per-game values; opportunity counts gate interpretation rather than reweighting the effect-size calculation.

Hedges-corrected standardized separation is displayed only when the card passes the complete readiness gate. Thin cards may retain raw win/loss means and the raw mean gap for traceability, but standardized `g` is explicitly withheld.

## Role-aware report framing

A selected-role report must not retain headings that imply every role is a laner.

The main economy section uses role-specific framing:
- ADC: lane & economy,
- TOP: lane & side economy,
- MID: lane → map economy,
- JUNGLE: jungle economy & tempo,
- SUPPORT: support economy & setup.

This is a copy/information-hierarchy rule, not a change to the underlying evidence. Direct-role lane/economy metrics, routing evidence, objective evidence and support roam/vision evidence remain separately defined.

Because reports are role-pure upstream, a generic "Role sample" block is redundant. That space instead shows **cohort context**: selected role, exact queue cohort, mechanics-cohort depth, timeline coverage, trusted direct-peer coverage and current patch context. This block describes evidence construction and must not be scored as performance.


## Role-aware phase context

Phase-risk rates remain queue/rules-profile aware and normalized by exposure time. The contextual sentence shown beside each phase must also respect the selected role:

- **ADC / MID / TOP early:** direct-role @15 economy plus first-reset evidence.
- **JUNGLE early:** first tracked impact timing and first-major timing versus the enemy jungler.
- **SUPPORT early:** detected roam conversion plus vision-action death rate.
- **JUNGLE transition:** prior objective setup plus contested-objective presence.
- **SUPPORT transition:** prior objective setup plus vision-action safety.
- **ADC / MID / TOP transition:** 15→25 role-CS swing plus objective reconnect.
- **JUNGLE late:** fight survival plus contested-objective presence.
- **SUPPORT late:** fight survival plus prior objective setup.
- **ADC / MID / TOP late:** role-relative @25 lead/deficit conversion context.

The phase label is **Late strategic phase**, not a universal "Baron-era" label, because verified queue/rules profiles can use different phase boundaries. Context fields do not change the hotspot calculation; they only make the interpretation role-appropriate.


## Role-specific economy chart sets

The four-chart economy/tempo surface must reflect the selected role rather than merely relabeling one universal laner chart set.

Current chart sets:
- **ADC:** trusted direct-role gold @15, trusted direct-role CS @15, DPM, KP.
- **TOP:** trusted direct-role gold @15, trusted direct-role CS @15, DPM, KP.
- **MID:** trusted direct-role gold @15, trusted direct-role CS @15, first tracked impact timing versus the MID peer, KP.
- **JUNGLE:** CS/min delta versus the enemy Jungler, first-major timing versus the enemy Jungler, first tracked impact timing versus the enemy Jungler, contested neutral-objective presence. Raw gold @15 remains technical context rather than a primary Jungle coaching chart.
- **SUPPORT:** vision/min delta versus the opposing Support, pre-objective setup-ward delta versus the opposing Support, detected early-roam conversion, and ADC-vs-ADC lane CS movement during detected Support roam windows. Raw VPM/KP remain descriptive context rather than the primary coaching chart set.

Peer-relative checkpoint charts must use only trusted direct-peer games and coaching-comparable checkpoints. Missing or unsupported per-game denominators remain missing; they are never converted to zero.

Signed chart semantics are direction-aware. Gold/CS deltas treat positive as favorable. Timing deltas such as first impact treat **negative as favorable** because negative means earlier. The chart engine must flip both the shaded favorable/unfavorable side and point coloring for inverse signed metrics. Recent-vs-sample summary wording should say **more favorable recently / less favorable recently**, not assume numerically higher always means improvement.

The consistency snapshot must be generated from the same role-specific chart specifications so its medians/IQR and favorable-close-unfavorable counts cannot drift from the plotted metric definition.


A chart being drawable is not the same as its coaching evidence being mature. Role chart and consistency surfaces therefore use report-level evidence requirements before drawing a trend line, recent-shift summary, median/IQR, or favorable/close/unfavorable split. A thin-but-valid sample is shown as a neutral withheld card with the missing evidence requirement instead of a directional chart.

Current chart floors mirror the report semantics: direct-role @15 charts need 5 comparable lane games; peer VPM/CS-min/impact/setup charts need 5 comparable peer games; first-major timing needs 4; Support roam conversion needs 4 attempts across 3 games; Support ADC lane movement needs 4 measured windows across 3 games; and contested-objective presence needs 5 encounters across 3 games. DPM/KP sample charts require 5 selected-role coaching games.

Signed zero-line wording is metric-specific. Peer deltas may label zero as even with the direct role opponent, but Support ADC lane movement must label zero as no measured ADC lane movement. Trend summaries use the latest valid observations rather than implying that missing games were observed values.

## Role-aware combined intelligence

Compound-intelligence cards must not reintroduce role assumptions that the dedicated role lenses have already removed. Joined evidence is role-gated before interpretation:

- **Lead → preservation:** available to ADC, TOP, MID and JUNGLE when the supported early-lead model exists; hidden for SUPPORT.
- **Farm ↔ map trade-off:** ADC, TOP and MID only. It uses the defined 15→25 routing model and must not be repurposed as Jungle/Support economy.
- **Item timing → impact:** ADC, TOP, MID and JUNGLE only; hidden for SUPPORT because the Support role lens uses roam/vision/setup evidence instead of carry-style first-major conversion.
- **Resources → fight uptime:** ADC, TOP and MID only. Damage-share-minus-gold-share coaching must not leak into SUPPORT or JUNGLE simply because the raw fields happen to exist.
- **Death → recovery stability:** role-agnostic when the repeat-death evidence floor is met.

JUNGLE additionally gets **Tempo → objective readiness**, joining direct-jungle first-impact timing with prior objective setup and contested-objective presence. A directional read requires at least 5 comparable impact games, 5 supported setup joins and 5 contested encounters. First-major timing may be displayed as additional context but is not allowed to manufacture readiness when those three core denominators are thin.

SUPPORT additionally gets:
- **Roam value ↔ ADC lane movement:** at least 4 detected roam attempts across 3 games and 4 measured ADC-vs-ADC lane-movement windows across 3 games. The headline lane-movement value is the mean of per-game means so a roam-heavy match cannot dominate the report. This remains association evidence; it does not assign sole causation for ADC CS movement to the Support. Positive movement favors the allied ADC; negative movement is lane cost.
- **Vision safety → objective setup:** at least 12 vision actions and 5 joined objective encounters.

Compound cards remain neutral below their joined evidence floors. Combining several weak inputs must never make a role-specific conclusion look mature.


## Role-aware champion and repeated-matchup diagnostics

Champion and repeated-opponent cards use the same selected-role coaching cohort and must not force lane-carry diagnostics onto every role.

For **ADC, MID and TOP**, champion/repeated-matchup interpretation may use:
- direct-role gold state at 15,
- DPM versus the player's usual role sample or direct role peer,
- clean early 1v1 evidence,
- outside-pressure share of early lane deaths,
- first-major timing,
- high-risk death rate.

For **SUPPORT**, champion diagnostics instead prioritize:
- supported roam conversion,
- associated ADC-vs-ADC CS movement during measured roam windows,
- VPM versus the opposing Support,
- pre-objective setup wards versus the opposing Support,
- high-risk deaths versus the player's Support baseline.

For **JUNGLE**, champion diagnostics prioritize:
- first tracked impact timing versus the enemy Jungler,
- first-major timing,
- VPM versus the enemy Jungler,
- pre-objective setup wards versus the enemy Jungler,
- high-risk deaths versus the player's Jungle baseline.

Repeated SUPPORT/JUNGLE opponent cards likewise use direct-peer VPM, objective-setup vision, first-impact/item timing and role-appropriate resource context. Carry-only “lane economy suppressed” and clean-lane-1v1 diagnoses are gated to ADC/MID/TOP.

Champion and repeated-matchup groups still require at least three games before they enter these diagnostic surfaces. Individual colored chips additionally require at least three valid observations for their own metric. Win rate remains descriptive and is never used by itself to label a champion or matchup good/bad.

Event repetition must also be game repetition when the wording claims a recurring champion or matchup pattern. A Support champion roam-conversion limiter needs at least 4 detected roam attempts spread across at least 3 games; confidence is based on contributing roam games, not the number of roam events. Associated ADC lane movement is only added to that champion finding when at least 4 measured windows are spread across at least 3 games, and the displayed value is the mean of per-game means.

For repeated opponent matchups, a “repeated 1v1 problem” needs clean solo deaths in at least 2 different games. An outside-pressure lane-death pattern likewise needs affected home-lane deaths and outside-pressure deaths spread across at least 2 games. Multiple events in one unusually bad match remain replay evidence, not a recurring matchup diagnosis.

## Saved-report analyzer freshness

A saved role-pure report is not automatically analytically current merely because its match cache is current. The frontend reads the live backend `analyzer_version` from the health endpoint and compares it with the saved report's `analyzerVersion`.

When those revisions differ, and cached games for the selected role exist, the page automatically calls the cache-only `analyze_basic` path to rebuild the report with the live analyzer. This rebuild must:
- preserve selected-role isolation,
- use existing cached match/timeline data,
- require no Riot refetch and no Riot API key,
- save the refreshed report so subsequent loads use the current analyzer,
- retain the previous report for rolling comparison with the analyzer-change caveat.

If the automatic rebuild fails or the role cache is unavailable, the existing saved report remains visible as stale context and is labelled as an older analyzer result. Analyzer freshness must never turn a recoverable saved report into an empty/broken page.


## Chronological match evidence ledger

Each expandable match-story row contains a chronological evidence ledger. It is a reconstruction from already-supported per-game evidence, not a new event detector.

The ledger may include:
- first meaningful shop and supported post-reset economy swing,
- first and second major-item completion,
- early direct-role lead peak,
- direct-role @15 and @25 checkpoints when comparable,
- first tracked impact,
- earlier-item power-window impact,
- high-risk deaths with trade/consequence context,
- supported team-contested neutral-objective windows,
- active fight involvement with readiness/execution context,
- ranked replay-review moments.

Fight execution entries use **active involvement only**. Proximity-only clusters may remain visible in the dedicated fight detail tab, but they cannot become survival, first-death, readiness or chronological execution judgments.

Objective ledger entries use supported contested windows. Fully conceded cross-map objectives must not be converted into personal absence events. Death entries remain evidence-specific: tags, unspent gold, trade status and measured consequence signals are shown without inventing a single causal explanation.

The ledger is capped to the newest/earliest supported key moments after chronological sorting and de-duplication so an expanded game remains readable.

## Top-driver confidence semantics

The three top driver cards are intentionally stricter than the long supporting lists.

- A primary limiter is visually red only when its representative finding is not low-confidence, or when a low-confidence representative is reinforced by at least **two distinct evidence channels beyond the representative finding**.
- A low-confidence single-source limiter remains visible as a **Provisional limiter** with neutral styling.
- A strength is visually green as **Bankable strength** only when its selected highlight is not low-confidence.
- If only low-confidence strengths are available, the card is labelled **Emerging strength**, remains neutral, and uses **Keep testing** rather than **Preserve**.
- When several strengths exist, prefer the first non-low-confidence highlight before falling back to the top low-confidence item.

This affects presentation priority, not the underlying evidence record. Low-confidence findings remain available in the supporting coaching evidence and can become stronger as the rolling sample grows.


Theme synthesis records total related findings separately from independent reinforcement. The representative finding does not count as its own reinforcement, and multiple findings with the same comparison/evidence channel do not increase independent support. Theme ranking also uses the number of distinct channels rather than raw duplicate finding count, preventing repeated formulations of one signal from inflating priority.

## Role-aware recent match story

The collapsible recent-match story must use a role-appropriate collapsed comparison instead of forcing every role into carry-lane gold framing.

- **ADC / MID / TOP:** direct-role gold state at @15 using the same ±100g bands as the evidence table.
- **JUNGLE:** first tracked impact timing versus the trusted enemy Jungler. ≤-1.5m is the favorable/earlier band, ≥+1.5m is the unfavorable/later band. If impact timing is unavailable but a trusted Jungle peer CS/min delta exists, that farm delta may be used as neutral fallback context.
- **SUPPORT:** vision score per minute versus the trusted opposing Support. >+0.15 VPM is a favorable vision edge; <-0.15 VPM is an unfavorable vision deficit; values between remain close.

The recent-story summary and its positive/neutral/negative filter chips must use the exact same role metric as the collapsed row. Unknown/untrusted peer evidence stays neutral context and must not be counted into positive/negative role-state filters.

The technical game-evidence table may continue to expose raw @15 economy for traceability, but the coaching-oriented match-story surface must not present SUPPORT/JUNGLE as though lane-gold state were their primary role diagnostic.


## Technical game table role safety

The lower game-evidence table is an audit/traceability surface, not the primary coaching summary. Direct-role @15 gold may remain visible for every role when a trusted peer/checkpoint exists, but it is treated differently by role:

- **ADC / MID / TOP:** @15 role-gold may retain ahead/close/behind coloring and the three matching table filters.
- **SUPPORT / JUNGLE:** @15 role-gold remains neutral **context only**. The ahead/close/behind table filters are hidden, and a stale carry-role filter is reset to all when the selected role changes.

This preserves the raw evidence without turning carry-lane economy into a SUPPORT/JUNGLE coaching target. The role-aware recent-match story remains the preferred coaching surface for those roles.


## Focus-aligned match-story reads

The recent-match story may mark games that contain replay evidence matching the current top practice theme. For those **current-focus games**, the collapsed judgment should prefer the supported per-game judgment that maps to the same practice category instead of showing an unrelated generic strongest read.

Theme-to-judgment matching reuses the existing replay-category mapping. It may connect resets/item spikes, mid routing, laning/matchup, lead protection, objectives, teamfights/fight selection, death consequences, vision safety and roaming to their corresponding per-game judgment categories.

If no per-game judgment matches the active focus, the row falls back to the normal strongest supported improvement/strength judgment and is labelled as a current-focus game rather than pretending the displayed judgment is focus-aligned.


## Expanded match-story signal alignment

The first signal inside an expanded recent-match row must reuse the same role-aware metric as the collapsed row: carry-role @15 economy for ADC/MID/TOP, first-impact/farm peer context for JUNGLE, and Support vision peer context for SUPPORT. The expansion must not silently revert to generic lane-gold framing.

Fight-uptime signals use **active involvement only**. Proximity-only fight clusters remain visible as positioning context elsewhere, but they are excluded from survival and died-before-contribution judgments in the expanded story signal grid.


## Role-aware evidence health

The top Evidence Health strip must reflect the evidence actually used by the selected role lens rather than always reporting a carry-style @15 checkpoint.

- **ADC / MID / TOP:** the role-specific health card measures coaching games with timeline data, a trusted direct-role opponent and a compatible @15 role-gold checkpoint.
- **JUNGLE:** it measures timeline-complete games with a trusted enemy Jungler and a supported first-impact timing comparison.
- **SUPPORT:** it measures games with a trusted opposing Support and a valid VPM comparison. VPM is match-summary/direct-peer evidence, so timeline completeness is **not** required. This must match `peerComparison.vpmGames` and the Support Quick Read evidence floor.

All three use an evidence floor of five comparable games for a ready state. The generic trusted-peer card remains separate so users can distinguish overall peer resolution from the role-specific metric needed by the coaching lens.


## Support Quick Read role safety

The SUPPORT Direct-role comparison surface is built around role-relevant peer evidence: vision/min, objective-setup wards, first tracked impact, first-major timing and peer-matched death recovery. Direct-role gold @15 remains available only in the raw technical evidence layer for traceability; it is not a prominent Support coaching card.


## Role-aware raw KPI strip

The neutral KPI strip follows the selected coaching role before any comparison or judgment is shown. Role resolution uses `dataQuality.selectedRole` first, then the coaching/summary role fallbacks, matching the other top-level report surfaces and preventing a stale saved summary role from changing the KPI family. ADC, MID and TOP retain CS/min and damage/min because those are useful raw carry/lane outputs. JUNGLE keeps CS/min but replaces the carry-style damage card with vision/min. SUPPORT does not foreground CS/min or damage/min: it shows kill participation, vision/min, assists/game and deaths/game alongside win rate and KDA. These are still descriptive self-sample values; vision/min is explicitly volume rather than vision quality or objective control.


## Role-aligned economy and tempo charts

The chart/consistency layer must use the same role semantics as Quick Read and the role lenses rather than reverting to one carry-oriented chart set.

- **SUPPORT:** direct-peer vision/min, direct-peer pre-objective setup wards, detected roam conversion, and ADC-vs-ADC lane CS movement during Support roam windows. Raw VPM/KP can remain elsewhere as descriptive context but must not replace the peer/setup evidence in this primary chart layer.
- **JUNGLE:** direct-peer CS/min, first-major timing versus the enemy Jungler, first tracked impact versus the enemy Jungler, and supported presence in team-contested neutral-objective encounters. Gold @15 remains traceable technical context but is not the primary Jungle economy/tempo chart.
- **ADC / MID / TOP:** retain their lane/economy chart families where role-relative gold/CS and damage or map-impact signals are materially interpretable.

Missing peer, setup, roam, item, or objective evidence stays missing. The chart layer must not synthesize zeroes. Support ADC lane movement is descriptive association over the detected roam window and must not be described as caused by the roam.


## Role-specific rolling progress comparison

Rolling Last-20 development comparisons must use metrics appropriate to the selected role instead of a single carry-biased list.

- **SUPPORT:** direct-peer VPM, direct-peer objective-setup wards, roam conversion, ADC-vs-ADC lane movement during detected roam windows, vision-action death rate, contested-objective presence, first-major/spike timing, and shared risk/recovery metrics.
- **JUNGLE:** direct-peer CS/min, first tracked impact, direct-peer objective setup, contested-objective presence, recent-shop objective absence, first-major/spike timing, and shared risk/recovery metrics.
- **MID:** direct-role lane economy, CS/min, first impact, mid-routing economy/presence, objective-timing absence, item timing and shared risk/recovery metrics.
- **TOP:** direct-role lane economy, CS/min, early-lead preservation, pre-objective side-lane death exposure, mid-routing objective presence, lead conversion, item timing and shared risk/recovery metrics.
- **ADC:** retains the carry-oriented gold/CS/output/conversion family plus item timing and shared risk/recovery metrics.

Every progress metric continues to require its own current and previous sample floor before a directional card is shown. A metric changing across two overlapping rolling Last-20 windows is descriptive development evidence only, not an independent before/after experiment.


Rolling-comparison role compatibility resolves `dataQuality.selectedRole` first, then the coaching/summary role fallbacks, so a saved legacy summary field cannot make two differently selected role reports look comparable.

## Role-aware session habit model

Session grouping remains descriptive: a session continues while the gap after the prior game end is at most 90 minutes, and the quick-requeue comparison uses at most 45 minutes. The model now carries per-subgroup KP and vision/min alongside CS/min, DPM, role-gold @15 and timeline risk, with explicit valid-game counts for each metric.

Presentation follows the selected role:

- **SUPPORT:** subgroup KP, vision/min and risky-death rate; supported deltas compare KP/VPM and risk only when both session groups have at least two valid observations for that metric.
- **JUNGLE:** subgroup CS/min, KP, vision/min and risky-death rate; supported deltas compare CS/min/KP and risk with the same paired-sample rule.
- **ADC / MID / TOP:** retain role-gold @15, DPM, CS/min and risk, with the new CS/min paired delta available alongside the existing gold/DPM reads.

Session deltas are behavioral context only. They must not be framed as fatigue, tilt, mental-state diagnosis, or causation.


## v203 audit corrections

A full in-memory rerun of both League source-contract suites exposed stale assertions and two denominator/role-source inconsistencies that spot checks had not caught.

- **Session @15 peer safety:** session-level Gold @15 samples now require `directPeerComparable === true` in addition to the compatible @15 mechanics checkpoint. A low-confidence or unresolved role opponent cannot enter session Gold @15 deltas.
- **Rolling-progress role source:** progress metric families resolve the selected role from `dataQuality.selectedRole`, then `coachingSummary.primaryRole`, then `summary.primaryRole`, matching the rest of the report instead of relying on the legacy summary field alone.
- **TOP side-lane denominator:** pre-objective side-lane deaths per game are divided by timeline-complete coaching games, so rolling-progress evidence readiness also uses valid timeline games. The number of side-lane deaths is not an evidence denominator.
- **Support roam sign semantics:** the stored legacy field name contains “cost,” but its value is signed ADC-vs-ADC CS-differential movement. Positive movement favors the allied ADC; negative movement is cost. Prominent UI copy therefore says **lane movement** and reserves **cost/costly** for negative windows.

These repairs do not change historical stored field names; they correct eligibility, evidence denominators and interpretation at analysis/presentation boundaries.


## Next-5 practice target denominator integrity

Saved practice targets must carry sample paths that match the metric they score. Event counts may be useful supporting evidence, but they cannot replace a game denominator for a per-game metric.

The following per-timeline-game targets use `behaviorSummary.timelineGames` as their sample path and generation sample: high-risk post-play give-backs/game, high-risk deaths while behind/game, high-risk deaths while ahead/game, costly deaths/game, high-risk deaths/game, and pre-objective side-lane deaths/game. The analyzer exports `behaviorSummary.timelineGames` directly from the current mechanics coaching cohort.

Pre-objective death percentage uses `classifiedTimelineDeaths`, matching its actual rate denominator. Session Gold @15 targets use the subgroup-specific `lane15Games` counts rather than total subgroup games.

This matters when a target improves toward zero: the target must not become “under-sampled” merely because the unwanted event stopped occurring, and it must not become “well sampled” merely because many bad events happened in a few games.


## Event-count plus game-spread evidence

Role coaching that uses pooled opportunities must also disclose and gate on how many games supplied those opportunities. This prevents one event-heavy match from creating a mature-looking cross-game conclusion.

For Support/Mid roaming, directional roam-conversion interpretation needs at least 4 detected attempts spread across at least 3 games. Support ADC lane movement needs at least 4 measured roam windows across at least 3 games. Support vision-action safety needs at least 12 actions across at least 4 games. Prior objective setup and contested-objective presence need at least 5 relevant encounters across at least 3 games when used for Support/Jungle directional coaching.

The analyzer exports `roamAttemptGames`, `supportRoamAdcLaneMovementWindows`, `supportRoamAdcLaneMovementGames`, `visionActionGames`, `objectiveSetupGames`, and `objectiveContestGames`. Saved older reports can derive the same game-spread counts from their per-game ledgers when those aggregate fields are absent.

Support ADC lane movement also exports `meanGameSupportRoamAdcLaneMovementCs`. Prominent cross-game surfaces use this game-weighted mean, while the legacy pooled-window average remains available for compatibility and technical inspection.

Stable harmful Support-roam styling requires at least two harmful ADC lane-movement windows occurring in at least two different games. Two harmful windows concentrated in one match remain a replay cue, not a stable cross-game pattern.

Generic roam lane-movement targets distinguish the legacy measured-window count (`roamLaneCostGames`) from the explicit contributing-game count (`roamLaneCostMeasuredGames`). A multi-game target must use the latter for spread rather than treating any roam game as measured lane-movement evidence.


## Action-first cross-game evidence spread

The backend action-first findings must not promote an event-heavy single match into a recurring coaching conclusion. Analyzer v4.112 applies game-spread gates before emitting prominent objective/roam findings.

- Low or strong team-contested objective presence for JUNGLE/SUPPORT requires at least 5 contested encounters across at least 3 contributing games.
- Prior objective setup requires at least 5 joined contested-objective encounters across at least 3 setup-contributing games.
- MID/SUPPORT/TOP roam-conversion findings require at least 4 detected queue-specific roam attempts across at least 3 games.
- MID/TOP lane-movement roam findings require at least 4 measured roam windows across at least 3 measured games; a no-return costly-roam pattern requires at least 2 qualifying windows across at least 2 games.
- SUPPORT no-return ADC-costly roam findings require at least 2 qualifying windows across at least 2 games.
- Recent-shop objective-absence findings require the general contested-objective evidence floor and at least 2 recent-shop absences across at least 2 games.
- A positive fresh-purchase/objective-attendance finding requires the general objective evidence floor plus at least 3 attended fresh-purchase encounters across at least 2 games.
- A pre-objective-death clue requires at least 2 supported deaths across at least 2 games; setup-vision peer-gap clues require at least 5 comparable setup games in addition to ward-volume evidence.

Confidence for these action-first findings is based on contributing-game counts where appropriate, not raw event counts. The analyzer exports the relevant game-spread counters so the evidence remains auditable.


## Game-weighted generic roam lane movement

For MID/TOP direct-role roam economy, cross-game coaching uses a **mean of per-game means** rather than averaging every measured roam window together. This prevents a match with many measured roams from receiving disproportionate weight simply because it contributed more windows.

The analyzer exports both:
- `avgRoamLaneCostCs`: legacy pooled-window average, retained for technical traceability and previously saved targets;
- `meanGameRoamLaneMovementCs`: game-weighted cross-game average used by new prominent MID/TOP action-first conclusions and newly created generic roaming practice targets.

The evidence floor remains at least 4 measured roam windows across at least 3 measured games. Repeated no-return costly-roam findings separately require at least 2 qualifying windows across at least 2 games.


## Game-weighted objective outcome association

The prominent action-first finding **Objective attendance is strongly associated with your wins** compares equal-weight per-game team-contested objective presence, not a pooled count of every objective encounter. This keeps one unusually long objective-heavy match from dominating the win/loss comparison.

The backend still exports the pooled event-rate win/loss object as `winLoss.objectiveJoin` for technical traceability. The action-first association uses `winLoss.objectiveJoinGameMean`, which is the mean of each game's supported contested-objective presence rate. Both outcome sides require at least 4 games with contested-objective evidence, and the finding remains explicitly descriptive/associational rather than causal.


## Coaching-facing objective presence aggregation

Prominent Support/Jungle objective-presence coaching uses the equal-weight **mean per-game** contested-objective presence rate. The pooled encounter rate remains available as technical traceability and is shown separately in the appendix.

Analyzer v4.115 exports `objectiveCoachingPresenceRate` as the coaching-facing alias of `meanGameObjectiveContestPresenceRate`. The report's `advanced.objectivePresence` uses this game-weighted value and also exposes `objectivePresencePooled` plus `objectivePresenceAggregation: "mean_games"`.

Action-first low/strong objective-presence findings, Support/Jungle role cards, compound Jungle objective-readiness context, rolling progress and newly created generic objective-presence practice targets all use the game-weighted coaching value. The target still requires at least 5 contested encounters across at least 3 contributing games. Legacy saved pooled-rate targets remain readable through their historical metric paths.


As with mean-game setup, prominent mean-game contested-objective presence cards do not render a Wilson interval calculated from pooled encounter counts; pooled joined/contested counts remain visible only as traceability. The generic Decision metrics **Contested objective presence** card follows the same rule: it prefers `objectiveCoachingPresenceRate`, requires at least 5 contested encounters across at least 3 contributing games, shows the pooled joined/contested counts only as traceability, and does not attach a pooled Wilson interval to a mean-of-games headline.

## Coaching-facing prior objective setup aggregation

Prominent cross-game **Prior objective setup** coaching uses an equal-weight mean of each game's supported setup rate, where the per-game denominator is `objectiveReadiness.contestedJoined`. The pooled `earlySetupObjectiveJoinRate` remains available for technical traceability and legacy saved targets.

Analyzer v4.116 exports `meanGameEarlySetupObjectiveJoinRate` and the coaching-facing alias `objectiveSetupCoachingRate`. Action-first setup findings and newly created setup practice targets use this game-weighted coaching value, subject to at least 5 joined contested-objective encounters across at least 3 setup-contributing games.

Support/Jungle role lenses, decision cards and compound coaching prefer `objectiveSetupCoachingRate`, then the mean-game field, then the pooled legacy rate for older saved reports. Because a Wilson binomial interval computed from pooled encounters does not describe a mean of per-game rates, those prominent mean-game setup cards do **not** render the pooled Wilson band. Pooled numerator/denominator counts remain visible as traceability.

The short-window Recent direction setup signal intentionally remains a pooled event-rate trend with explicit opportunity and game-spread gates; it is separately labelled and documented as such. The Recent Pulse UI must also disclose the aggregation inline: pooled event-rate cards say **pooled event rate**, while the Support ADC lane-movement trend says **equal-weight game mean**. This prevents same-named short-window and full-sample coaching percentages from looking like contradictory copies of one statistic. Outcome Fingerprint remains an equal-weight per-game comparison using `earlySetupJoins / contestedJoined` within each game.

Phase-driver context text also uses the same coaching-facing setup rate, so a phase summary cannot silently fall back to the pooled encounter percentage while adjacent setup cards show a mean-game value.


## Mid-routing objective-presence aggregation

The 15→25 routing model distinguishes three objective-presence populations and must not collapse them:

- `midRouting.contestPresenceRate` is the per-game coaching rate: joined **team-contested** neutral-objective encounters divided by team-contested encounters during the routing window.
- `midRouting.coachingObjectivePresenceRate` is the equal-weight mean of those per-game contested-presence rates across comparable routing games. This is the canonical coaching/progress/practice value so one objective-heavy match cannot dominate the cross-game headline.
- `midRouting.pooledObjectiveJoinRate` is the pooled team-contested event rate and remains a technical diagnostic. The legacy `avgObjectiveJoinRate` alias retains this pooled meaning for saved-report compatibility.
- `securedObjectivePresenceRate` and each game’s legacy `objectiveJoinRate` describe team-secured objective context and remain separate outcome/traceability fields.

MID outcome fingerprint **15→25 objective reconnect** uses each game’s `contestPresenceRate` when available, with the legacy secured rate only as a saved-report fallback. New practice targets and rolling-progress cards use `coachingObjectivePresenceRate`; old saved targets keep their original pooled metric path so historical baseline semantics are not silently rewritten.


## Coaching versus raw timeline coverage

The report intentionally exposes two timeline counts with different scopes:

- `dataQuality.validTimelineGames` is raw availability across the selected-role Last-20 before an optional current-mechanics cohort is applied. It belongs in coverage/quality displays.
- `behaviorSummary.timelineGames` is timeline coverage inside the actual mechanics-filtered coaching cohort. Any directional coaching readiness or rolling-progress sample gate for timeline-derived metrics must use this count.

TOP pre-objective side-lane risk, high-risk deaths/game, and other mechanics-sensitive timeline coaching therefore use `behaviorSummary.timelineGames`. The cohort/breakdown panels continue to show the raw Last-20 timeline count so users can see the difference between data availability and coaching eligibility.


## Objective target continuity safeguards

Objective diagnosis and Next-5 follow-up must use compatible evidence maturity. A diagnosis that required cross-game or peer-comparable evidence must not later be scored from a concentrated raw count alone.

- **Pre-objective death target:** the metric remains the pooled share of classified deaths that are followed by an enemy-secured, team-contested neutral objective inside the supported evidence window, but target scoring requires at least 5 classified deaths **and** at least 3 timeline-complete coaching games. The bad event itself is not required to keep occurring, so reaching zero pre-objective deaths can still be scored.
- **Objective-setup ward-share target:** target scoring requires at least 12 tracked player wards and at least 5 direct-role comparable setup games, preserving the peer/game context that originally supported a setup-vision diagnosis.

New reports persist these as explicit `sampleRequirements`. Older saved targets for the same metric paths are upgraded on read to the same safe requirements rather than retaining the earlier single-count fallback.


## Zero-safe recovery practice target

The **Recovery play** Next-5 target must remain measurable when the unwanted behavior disappears. The explanatory diagnosis may still report the share of deaths taken while behind that were high-risk, but the practice target uses `behaviorSummary.highRiskBehindDeathsPerGame` over timeline-complete coaching games.

That means a successful five-game block with zero high-risk behind-state deaths produces a valid target value of `0/game` rather than an undefined percentage caused by a zero-event denominator. New recovery targets require at least 5 timeline-complete coaching games and use the same per-game metric already used by the death-risk target family.


## Zero-safe repeat-death practice target

The repeat-death diagnosis remains opportunity-based: it can still report what share of measured death-to-next-death opportunities become another death within four minutes, including peer context. The **Next-5 practice target** uses `behaviorSummary.repeatDeathsPerTimelineGame` instead.

This makes the practice target scoreable when repeat-death opportunities disappear entirely. New targets require at least 5 timeline-complete coaching games and aim for a self-relative reduction of about `0.2/game` (roughly one fewer rapid repeat death per five games), bounded at zero. A zero-opportunity block therefore remains measurable rather than becoming an undefined percentage.


## Zero-safe closing practice target

The closing diagnosis may still describe the share of **lead@25 losses** that contain late high-risk or costly-death evidence. That diagnostic is conditional on a loss and is useful for explaining *why* some leads fail.

The Next-5 practice target instead uses `behaviorSummary.closing25.leadLateRiskPerLeadGameRate`: the number of ≥+500g direct-role lead@25 games that both end in a loss and contain late-risk evidence, divided by **all** lead@25 games. New targets require at least 4 lead@25 games.

This keeps the target measurable at zero when every lead closes successfully or when remaining lead losses contain no late-risk evidence. It avoids treating a zero-loss sample as “missing evidence” for a short-term closing target.


## Zero-safe pre-objective death practice target

The objective diagnosis can continue to explain a **pre-objective death rate** as a share of classified deaths, because that is useful evidence about the pattern when deaths occur. The Next-5 practice target uses `behaviorSummary.preObjectiveDeathsPerTimelineGame` instead.

New targets require at least 5 timeline-complete coaching games and aim for a self-relative reduction of about `0.2/game`, bounded at zero. A five-game block with zero deaths—or simply zero supported pre-objective deaths—therefore remains scoreable instead of becoming undefined because the classified-death denominator disappeared.


## ADC benchmark role eligibility

The LegendsTracker-derived external population reference is **ADC-only**. Eligibility is therefore decided in the analyzer from three independent conditions: the selected coaching role is canonical ADC, the selected cohort is Ranked Solo/Flex, and a matching ranked-queue tier is available.

A non-ADC report exports `externalBenchmarks.eligible = false` with `eligibilityReason = "selected_role_not_adc"`, even when the account has a valid ranked tier. The frontend independently resolves `dataQuality.selectedRole` first, then coaching/summary fallbacks, so older saved reports also fail closed instead of exposing ADC population comparisons through a stale legacy role field.

External benchmark eligibility is reference-only and does not affect coaching priorities, practice targets, rank predictions, or direct-peer analysis.


## Practice-target registry parity

Every metric path that the analyzer can persist in a Next-5 practice target must also exist in the frontend fallback registry used for older or partially populated saved reports. The only frontend-only entries are the intentional legacy aliases `summary.csMin` and `summary.goldDiff15`, which are remapped to the mechanics-filtered `coachingSummary` paths.

The game-weighted generic roam metric `behaviorSummary.meanGameRoamLaneMovementCs` therefore falls back to `behaviorSummary.roamLaneCostMeasuredGames` when explicit saved `sampleRequirements` are unavailable. Explicit requirements remain authoritative whenever present.


## Saved-report strict role cohort

New analyzer reports already store only the selected role in the report game sample, but imported or older saved reports may predate that guarantee. Frontend-derived coaching surfaces therefore reconstruct their cohort with a **strict per-game role parser** before applying the mechanics-key filter.

Only a game whose explicit Riot/report role normalizes to the selected coaching role may enter `reportCoachingGames(r)`. Missing, unknown or unsupported per-game role labels are **context only** and are never allowed to inherit the general UI default of ADC. This is intentionally stricter than `canonicalRole()`, whose ADC default remains useful for form/profile UI but would be unsafe for evidence membership.

Raw match history can still display those older rows for traceability. `gameIsCoachingContext(r,g)` marks a role-mismatched or role-unknown row as non-coaching, and the report header's coaching-comparable count is reconstructed from the same strict cohort rather than trusting a stale legacy aggregate.


## Coaching-cohort progress horizons

Rolling overlap/new/dropped counts and Next-5 practice-target horizons must use the same reconstructed coaching cohort as the metrics they describe. The frontend therefore derives match IDs from `reportCoachingGames(report)`, which applies the strict selected-role filter and, when active, the verified current-mechanics filter.

Context-only rows in older mixed-role saved reports may remain visible in match history, but they cannot advance a five-game practice horizon, increase rolling-overlap counts, or make practice-plan continuity look more mature. A “new game” for development tracking means a new coaching-comparable match ID, not merely a new row in `report.games`.


## Objective-family drill-down cohort

Objective-family summary rates/counts come from the coaching cohort, so their match-count badges and drill-down filters must use the same population. `objectiveFamilyMatchIds(r,key)` therefore derives IDs from `reportCoachingGames(r)`, not raw `report.games`.

Older mixed-role or older-mechanics rows can remain visible in general history for traceability, but they must not appear as supporting matches for a coaching-cohort objective-family statistic they did not help compute.


## v240 cross-game vision coaching

Backend coaching priorities must use the same cross-game confidence rules as the role-specific frontend vision surfaces.

- Vision-action safety for SUPPORT/JUNGLE requires at least **12 tracked vision actions across 4 coaching games** before it can create a stable positive or negative coaching finding.
- Objective-setup ward-share comparison requires at least **20 tracked wards on both player and same-role-opponent sides and at least 5 trusted setup games** before it can create a directional coaching finding.
- Confidence for these findings is based on contributing coaching games, not raw event count, so one unusually long ward-heavy match cannot masquerade as repeated behavior.

The underlying event definitions are unchanged; this is an evidence-spread safeguard only.


## v241 carry-role damage headline safety

Damage-output headline coaching is role-scoped symmetrically. ADC, MID and TOP may receive direct-peer DPM strengths, recent DPM trend strengths, or frequent top-team-damage highlights. SUPPORT and JUNGLE keep DPM/damage available as technical traceability, but those carry-style outputs do not become primary coaching praise.

This mirrors the existing role-aware KPI, Quick Read, chart and progress policies and prevents a positive metric from bypassing a role gate that already applies to its negative counterpart.


## v242 carry-lane coaching boundary

The backend coaching-priority layer follows the same role boundary already used by Quick Read, charts, diagnostics and rolling progress. Raw direct-role economy remains traceable for every role when evidence is trusted, but carry-lane conclusions are headline coaching only for **ADC, MID and TOP**.

Carry-only coaching families include clean 1v1 lane diagnoses, solo-kill-to-lane-economy conversion, @15 lead/deficit coaching, lead/deficit-to-result conversion, @25 role-gold closing/recovery, 15→25 direct-role CS/gold routing, and first-reset direct-role economy. Recent Gold@15 trend is also carry-only. Recent raw CS/min trend remains available for JUNGLE as a farm-tempo signal but is not used for SUPPORT.

SUPPORT/JUNGLE still retain these raw checkpoint fields in technical evidence where applicable; the restriction is on primary coaching interpretation, not data deletion.


## v243 role-specific session coaching

Backend session/requeue priorities use the same role semantics as the role-aware session cards. A directional session finding also requires at least three valid observations in both compared subgroups for each metric used.

- **SUPPORT:** vision/min, kill participation and timeline high-risk deaths.
- **JUNGLE:** CS/min, kill participation and timeline high-risk deaths.
- **ADC / MID / TOP:** trusted/comparable Gold@15, DPM where available, CS/min and timeline high-risk deaths.

Quick post-loss comparisons follow the same split, using the exported post-loss VPM/KP/CS/Gold deltas as appropriate. Session timing is descriptive association only; the report does not infer fatigue, tilt, concentration, posture, or another unmeasured cause.

Rank-pressure lane-gold coaching against higher/lower-ranked direct peers is likewise carry-lane coaching and is restricted to ADC/MID/TOP. First-major timing against higher-ranked peers remains role-agnostic when its own evidence is supported.


## v244 role-specific session practice targets

A session/requeue coaching theme must receive a Next-5 target from the same role-specific metric family that created the theme. The practice layer must not fall back to raw Gold@15 merely because that field exists.

- **SUPPORT:** later-session and quick post-loss targets use vision/min first, then kill-participation delta when that is the supported unfavorable session signal.
- **JUNGLE:** targets use CS/min first, then kill-participation delta.
- **ADC / MID / TOP:** targets use trusted/comparable Gold@15 first, then CS/min.

A target is only created when its delta is already materially unfavorable (Gold ≤ -300g, CS/min ≤ -0.30, VPM ≤ -0.15, or KP ≤ -10 percentage points). Each target stores the exact paired subgroup denominator paths, with at least three valid observations required in both groups. Generic consistency themes try the matching later-session or post-loss family rather than manufacturing a target from an unrelated role metric.


## v245 practice-theme target alignment

Next-5 targets must remain semantically aligned with the evidence theme that created them. A target builder may return no measurable target when no denominator-safe metric matches the theme; it must not substitute an unrelated metric merely to fill the card.

- The **early-lane** theme family no longer has an unconditional Gold@15 fallback. Higher-rank first-major findings target the exact higher-ranked first-major delta; higher/lower-rank lane findings use their exact rank-band Gold@15 subset; first-impact findings use direct-peer first-impact timing. Generic lane-gold targets remain ADC/MID/TOP only and require lane/gold/economy wording. CS/min targets may also serve JUNGLE when the source theme is explicitly farming-related.
- The shared **consistency** theme family creates a session target only when the theme itself is later-session or quick post-loss/requeue evidence. A generic recent-trend theme must not silently inherit a session target.
- The teamfight fallback **damage share − gold share** target remains ADC/MID/TOP only, matching the role boundary of its source coaching signal.

Backend and frontend target registries include the exact first-impact, higher-rank item-timing and higher/lower-rank lane subset denominator paths so those targets can be scored later without broad-population substitution.


## v246 reset-target evidence alignment

The repeated high-gold-stay finding and its Next-5 target now share one explicit metric family instead of borrowing an unrelated fight-readiness rate.

- A stable **High-gold stays appear repeatedly** coaching finding requires at least 4 detected ≥1200g / >2-minute-to-shop windows spread across at least 3 coaching games.
- The analyzer exports both `greedyStayGames` and zero-safe `greedyStaysPerTimelineGame`.
- The Next-5 target is **High-gold stays / game** and uses timeline-complete coaching games as its follow-up denominator. It intentionally does **not** require future games containing a greedy stay; otherwise improvement toward zero would make the target look under-sampled.
- The **Fight starts with ≥1000g unspent** target is no longer a generic reset-power fallback. It is used only when the source theme explicitly concerns unspent/stored gold at fight start.

This separates repeated-pattern eligibility from zero-safe outcome scoring while keeping both tied to the same underlying reset behavior.


## v247 representative-evidence target routing

Practice-target routing uses the synthesized theme's **representative evidence title only**. Supporting titles remain visible reinforcement, but they cannot select or override the Next-5 metric. This prevents a secondary finding from hijacking the measurable target attached to priority #1.

The main mixed families are source-specific:
- **Roaming:** ADC/direct-role lane-cost themes use game-weighted lane movement; conversion themes use roam conversion. A lane-cost diagnosis does not fall back to conversion merely because a conversion rate exists.
- **Vision:** vision-action safety findings use vision-action death rate; objective/setup findings use objective-setup ward share.
- **Mid-routing:** side-lane risk, farm/CS loss and objective-presence problems route to their matching metric families rather than a generic routing fallback.
- **Teamfights:** entry/first-death, died-before-contribution and carry-role damage/resource findings each require matching representative wording. Unsupported fight-selection themes may have no Next-5 metric rather than borrowing an unrelated output metric.

Returning no target is valid when the current evidence theme has no denominator-safe measurable counterpart.


## v248 diagnosis-aligned vision and objective targets

Vision and objective Next-5 targets now preserve the comparison population and diagnosis that created the priority.

For SUPPORT/JUNGLE vision themes:
- a direct-role VPM deficit targets `peerComparison.avgVpmDelta` over `vpmGames`;
- a setup-ward **share** deficit targets `peerComparison.objectiveSetupWardRateDelta` over trusted `visionSetupGames`;
- a direct setup-ward **count** deficit targets `peerComparison.avgObjectiveSetupDelta` over the same trusted setup-game cohort;
- vision-action safety still targets the self vision-action death rate.

The objectives/closing router distinguishes prior **setup/arrival**, post-kill **conversion**, **closing/lead@25** risk, and generic objective **presence/attendance**. The word “objective” alone must not force a prior-setup target. When the objective diagnosis specifically identifies setup-vision share, the target uses the exact peer-relative setup-share delta rather than substituting self ward volume.


## v249 legacy practice-target evidence parity

Older saved reports may contain practice targets created before explicit `sampleRequirements` were stored. Those targets must not be rescored under weaker one-denominator rules than current reports.

When a saved target lacks explicit requirements, the frontend reconstructs the current safe evidence contract for every multi-denominator metric family that existed in legacy reports: roam conversion, generic roam lane movement, Support ADC lane movement, pre-objective death rate, objective-setup ward share, vision-action safety, prior objective setup, recent-shop objective absence, and objective presence.

The fallback preserves the current event-count plus game-spread floors. For example, a legacy roam-conversion target still needs at least 4 attempts across 3 games, a legacy Support lane-movement target still needs 4 measured windows across 3 games, and a legacy vision-safety target still needs 12 actions across 4 games before it can be scored as met, moving closer, moved away, or unchanged.


## v250 game-weighted recent objective direction

The short-window **Recent direction** panel must compare objective setup and contested-objective presence using the same equal-weight per-game definitions as the main coaching model.

For both the latest-five and prior comparison windows, objective setup is the mean of each game's supported prior-setup percentage among joined contested objectives, and objective presence is the mean of each game's supported contested-objective presence percentage. Games without a relevant denominator remain missing rather than becoming zero.

The trend objects still retain pooled encounter counts as `recentEvents` / `priorEvents` so the existing evidence floors can require both enough contributing games and enough objective encounters. Event counts support confidence; they do not determine the headline rate.


## v251 recent-trend aggregation provenance

Technical trend rows must display the aggregation reported by the analyzer instead of hard-coding “pooled.” `mean_games_with_event_coverage` is shown as **equal-weight game mean** and `pooled_events` as **pooled event rate**. This keeps team-contested objective setup/presence distinct from team-secured presence and early-KP event rates.


## v252 Support champion diagnostic spread

Support champion diagnostics must use the same cross-game evidence rules as the main Support coaching model and backend champion findings.

Champion-specific roam conversion is directionally colored only with at least 4 detected roam attempts spread across at least 3 games on that champion. Champion-specific ADC lane movement uses the game-weighted mean (`meanGameSupportAdcLaneMovementCs`) and is directionally colored only with at least 4 measured roam windows across at least 3 champion games. The diagnostic chip displays both the opportunity count and contributing-game count.

The legacy pooled-window lane-movement average may remain a compatibility fallback when reading older saved reports, but it must not receive directional color without the cross-game evidence fields.


## v253 champion DPM denominator integrity

Champion-specific DPM averages are calculated only from games with a finite DPM observation. Any coaching/highlight rule based on that average must therefore gate on `dpmGames.length`, not the total number of games on the champion.

For ADC/MID/TOP, the “high-output pick” highlight requires at least 3 measurable DPM games. Its evidence copy and confidence level also use that measurable DPM count. This keeps backend coaching aligned with the frontend DPM chip, which already uses the exported `dpmGames` support count.


## v254 repeated-matchup cross-game event spread

Repeated-matchup conclusions must distinguish repeated events from repeated **games**. Multiple lane deaths in one chaotic matchup game are replay evidence, but they are not by themselves a stable repeated-matchup pattern.

For ADC/MID/TOP repeated opponent-champion diagnostics:
- “Clean 1v1 deaths recur” requires at least 2 clean solo deaths spread across at least 2 games, while still exceeding solo kills by at least 2.
- Positive clean-1v1 coloring likewise requires at least 2 solo kills spread across at least 2 games and a +2 kill/death margin.
- The Clean 1v1 K/D chip needs at least 3 tracked solo events across at least 2 matchup games before it receives directional styling.
- Outside-pressure share needs at least 3 early home-lane deaths across at least 2 games for a mature denominator. A negative outside-pressure read additionally requires at least 2 outside-pressure deaths spread across at least 2 games.

The analyzer exports `earlySoloKillGames`, `earlySoloDeathGames`, `earlySoloEventGames`, `earlyHomeLaneDeathGames`, and `earlyOutsidePressureGames` so the browser can enforce the same cross-game repetition rules as backend coaching.


## v255 Jungle matchup CS denominator integrity

Repeated Jungle matchup diagnostics keep gold @15 and CS @15 evidence counts separate. Both use trusted direct-role, checkpoint-compatible games, but either metric may be missing independently.

The backend exports `csDiff15Games` from the finite CS-difference sample and computes `csDiff15` from exactly that set. The frontend's **CS diff @15** chip uses `csDiff15Games` for its three-observation evidence floor and displays that count directly. It must not borrow `laneGames`, which is the finite gold-difference sample.


## v256 global lane-event game spread

Role-level lane coaching must not call a behavior recurring merely because several events occurred inside one unusually chaotic game.

Across the current mechanics coaching cohort, the analyzer now exports game-spread counts for early clean direct-role duels and early home-lane outside-pressure deaths: `earlyRoleSoloKillGames`, `earlyRoleSoloDeathGames`, `earlyRoleSoloEventGames`, `earlyHomeLaneDeathGames`, and `earlyOutsidePressureDeathGames`.

Global clean-1v1 negative/positive coaching retains the existing event and trusted-peer sample floors but additionally requires the relevant solo outcomes to appear in at least 2 games. The global outside-pressure finding requires at least 4 early home-lane deaths across at least 3 affected games, with at least 3 outside-pressure deaths occurring across at least 2 games.

The TOP **Early clean duel** card requires at least 3 clean duel events across at least 2 games before directional styling. Positive or negative coloring also requires the corresponding wins/deaths to repeat across at least 2 games. Technical traceability displays the event counts and contributing-game counts separately.


## v257 bot-lane outside-pressure semantics

Outside-pressure classification is intentionally available to ADC and SUPPORT. The bot-lane classifier constructs an ordinary lane-opposition set containing both enemy bot-lane roles before checking kill participants. Additional enemy participants outside that set are the outside-pressure signal. Documentation and regression contracts must not revert to the obsolete TOP/MID-only rule.


## v258 outside-pressure classification integrity

Outside-pressure analysis is fail-closed when ordinary lane opposition cannot be resolved. Raw early home-lane deaths remain visible for traceability, but only **classified** deaths enter the outside-pressure denominator.

For TOP/MID, classification requires a resolvable ordinary same-role lane opponent. For ADC/SUPPORT, classification requires both ordinary enemy bot-lane counterparts to be resolvable: enemy ADC and enemy Support. If either bot-lane counterpart is missing or ambiguous, that home-lane death is exported as **unclassified** rather than being treated as outside pressure or as a clean ordinary-lane death.

The analyzer exports raw, classified and unclassified early home-lane death counts separately. `earlyOutsidePressureShare` and the repeated-matchup outside-pressure share use `earlyClassifiedHomeLaneDeaths` as their denominator. Global and repeated-matchup coaching floors use classified deaths and classified affected games; unresolved deaths can be displayed for traceability but cannot make an outside-pressure pattern look stronger or weaker.

Bot-lane copy must say **ordinary enemy bot-lane opposition** (or equivalent) rather than “enemy other than the direct role opponent.” The enemy Support is ordinary lane opposition for an ADC, and the enemy ADC is ordinary lane opposition for a Support.


## v259 trusted Gold @15 baseline integrity

A role-relative @15 coaching baseline must use the same population as the champion, matchup and practice metric being compared against it. Raw `summary.goldDiff15` / historical `coachingSummary.goldDiff15` values can contain finite checkpoint deltas from games whose same-role opponent was not high-confidence enough for direct-peer coaching.

The authoritative coaching baseline is therefore `peerComparison.avgGoldDiff15`, supported by `peerComparison.laneGames15`: games must have `directPeerComparable === true`, a compatible @15 rules checkpoint, and a finite role-gold delta. Champion and repeated-matchup “vs your usual @15” reads receive this trusted baseline explicitly. Frontend diagnostic chips use the same baseline.

New generic lane-gold Next-5 targets persist `peerComparison.avgGoldDiff15` rather than `coachingSummary.goldDiff15`. Older saved Gold@15 targets whose metric path is `summary.goldDiff15` or `coachingSummary.goldDiff15` are shown as **re-baseline required**. Their old numeric baseline is not silently compared with the newer trusted population.

This does not delete raw checkpoint values from technical traceability. It prevents low-confidence or withheld direct-peer games from re-entering coaching through a summary average.


## v260 high-confidence lane-opposition gate

Outside-pressure classification now uses the same fail-closed role-evidence philosophy as direct-peer coaching. A home-lane death is eligible for ordinary-vs-outside-pressure classification only when the player's role and the ordinary same-role opponent are both resolved from **high-confidence Riot position evidence**. For ADC/SUPPORT, the ordinary enemy bot-lane partner must also be uniquely resolved from high-confidence role evidence.

Legacy/fallback `role` or `lane` labels are not sufficient for this classifier. If the player role, same-role opponent, or required bot-lane partner is only fallback-quality, the death remains visible but is exported as unclassified with an explicit reason such as `player_role_not_high_confidence`, `same_role_opponent_not_high_confidence`, or `bot_lane_partner_not_high_confidence_or_unresolved`.

This deliberately reduces classification coverage rather than allowing low-confidence role labels to create a false gank/outside-pressure pattern.


## v261 early-lead direct-peer integrity

The raw per-game `earlyLeadWindow` can remain available for technical traceability, but it is a role-relative economy construct and therefore cannot become coaching evidence unless the same-role opponent passes the trusted direct-peer gate and the @15 rules checkpoint is comparable.

Aggregate early-lead opportunity/give-back rates use timeline-complete trusted direct-peer games only. Recent-vs-prior early-lead trend opportunities use that same population. The replay-review queue does not create an early-lead review moment from an untrusted role opponent, and the TOP win/loss outcome fingerprint withholds the early-lead metric for such games.

This keeps `behaviorSummary.earlyLeadGivebackRate`, its Next-5 practice target, rolling progress, replay review and outcome fingerprint on the same direct-peer evidence population as the underlying Gold@15 coaching model.


## v262 peer-relative coaching population integrity

Raw timeline facts may retain fallback-opponent context for technical traceability, but any coaching statement whose meaning depends on the **same-role opponent** must reapply the trusted direct-peer gate before aggregation, judgment, replay selection or target scoring.

The trusted-only family now includes:
- first-impact timing versus the role opponent;
- first-major timing / earlier-item spike windows and spike utilization;
- first-reset direct-role economy aftermath;
- deaths classified as ahead/even/behind versus the role opponent;
- high-risk deaths while materially ahead or behind;
- lead-protection replay moments.

`behaviorSummary.directPeerTimelineGames` is the denominator for peer-economy per-game death metrics such as `highRiskLeadDeathsPerGame` and `highRiskBehindDeathsPerGame`. Non-peer death metrics such as generic high-risk deaths/game, costly deaths/game and repeat deaths/game continue to use all timeline-complete coaching games.

Earlier-item spike utilization is aggregated only from timeline-complete trusted direct-peer games. Self-only major-item affordability remains independent of opponent trust; only its comparison **versus** the opponent requires a trusted peer. This distinction prevents a low-confidence opponent role from entering coaching without unnecessarily discarding valid self-only reset evidence.


## v263 fail-closed per-game opponent evidence

The trusted-peer gate now applies at the per-game data-production boundary, not only at aggregate coaching consumers. A candidate same-role opponent is converted into a `rolePeerId` only when both the player and the resolved opposing role have high-confidence Riot role evidence. Direct-role checkpoints, early gold samples, clean lane-duel events, opponent vision/shop/item timelines, role-peer fight context, opponent first-impact timing, death-economy deltas, opponent repeat-death context, direct-peer roam lane cost, and other opponent-relative timeline facts use that trusted identifier. This prevents a fallback or ambiguous role candidate from leaving plausible-looking comparison fields in the report for a later renderer to accidentally reuse.

The serialized per-game `peer` object is now emitted only for `directPeerComparable === true`. Exclusion provenance remains available through `peerResolution.directPeerExclusionReason`, so the report can explain why comparison was withheld without exposing a low-confidence opponent identity or its derived deltas. Frontend match headers, evidence-table opponent cells, detailed opponent/rank cards, death-pattern labels, and opponent sorting independently re-check `directPeerComparable` so older saved reports also fail closed.

Support roam lane-cost evidence has the same standard. The allied ADC and enemy ADC must each be uniquely identifiable from high-confidence Riot role fields before ADC-vs-ADC CS movement can become the coaching lane-cost signal; otherwise that comparison is unavailable rather than inferred from a fallback role.

Replay review now applies the trusted-peer gate to clean 1v1 lane-death prompts as well. A low-confidence opponent can therefore contribute ordinary non-peer facts such as a player's own death, position, team objective context, or KDA, but cannot become named matchup evidence or a direct-role economy/vision/item comparison.


## v264 role-first peer-rank fetch integrity

Peer-rank acquisition now obeys the same role-first boundary as the report itself. A fully cached match+timeline row is always a cache hit during fetch preparation; missing peer-rank metadata no longer causes a cached wrong-role game to be re-opened simply because it happened to sit inside the first 20 raw Riot match IDs. The browser sends the selected role with fetch preparation and per-match fetch calls, and new-match rank lookup is eligible only when the fetched game matches that selected role and the direct role opponent is supported by high-confidence Riot role evidence.

The authoritative peer-rank target set remains the final selected-role, supported-queue cohort chosen in fetch completion. Any remaining rank gaps are resolved there after role and queue selection. This keeps API work aligned with the population that can actually enter the report and prevents TOP/MID/etc. games from consuming opponent-rank calls during an ADC analysis merely because they were recent in the raw account history.

Peer-rank misses are now negative-cached correctly. A row with `peer_rank_fetched_at` and no rank snapshot means the lookup was completed but no usable ranked snapshot was available; it is not retried on every later analysis. Existing non-null snapshots using an older schema are still refreshed. Fetch completion exposes `peer_rank_checked`, `peer_rank_backfilled`, `peer_rank_unavailable_cached`, and `peer_rank_selection_scope=trusted_selected_role_queue_cohort` so the UI and diagnostics can distinguish attempted checks, successful snapshots, and intentionally cached unavailability.

The trusted-opponent rule from v263 also applies before a Riot rank request is made. Low-confidence role opposition can therefore no longer waste a peer-rank lookup that the analyzer would subsequently refuse to use.


## v265 100-game history and metric-utility audit

The fetch pipeline now separates **history discovery** from **deep behavioral evidence**. A normal request asks Riot for up to 100 recent match IDs and caches match payloads across that window. It does not automatically download 100 timelines. After the metadata scan, the backend applies the same map, duration, selected-role and supported-queue rules used by the analyzer, chooses the final recent queue cohort, and returns only the Last-20 rows that still need timeline data. The browser deep-fetches those rows and only then finalizes peer-rank context. Public workspaces retain the newest 100 cached matches.

This makes “last 100” useful instead of merely expensive. The latest eligible 20 remain the deep coaching cohort for deaths, fights, resets, objective setup, spatial review and direct timeline comparisons. Older selected-role/same-queue games are loaded as match-level history, giving a bounded 100-game context without pretending those older games have timeline evidence.

The metric audit also promoted several Riot fields that were already present in cached match JSON but unused:
- **lane minions at 10 minutes** from `challenges.laneMinionsFirst10Minutes`, used as a timeline-free early-farming trend for lane roles;
- **death downtime** from `totalTimeSpentDead / gameDuration`, which captures the timing cost of deaths that raw death count misses;
- **damage-share minus gold-share** in percentage points, a descriptive resource-output lens that is explicitly champion/composition sensitive rather than a universal efficiency score;
- **turret damage/min** and **epic-monster damage/min**, used as transparent structure/objective-pressure context;
- **vision actions/min**, control-ward count and solo-kill count as match-level role context;
- **AFK / early-surrender evidence**, used to mark outcome-compromised games. Win/loss fingerprinting excludes these games when both clean outcome groups still have adequate samples.

The new Long-horizon form panel shows the available selected-role/same-queue history from the 100-match account scan and compares the latest 20 with the previous 20 using valid-observation counts. It intentionally keeps this separate from deep Last-20 coaching.

Not every available Riot field was promoted. Skillshot hit/dodge counts are highly champion- and spell-dependent; opaque challenge flags such as `laningPhaseGoldExpAdvantage` are not treated as precise coaching measurements; and `kTurretsDestroyedBeforePlatesFall` is obsolete as a 2026 concept. Riot changed Summoner's Rift in 26.1 so turret plates are permanent and extend to inner/inhibitor structures. The analyzer may retain `turretPlatesTaken` as all-game structure-pressure context, but never labels it “pre-14 plates” or uses the retired 14-minute disappearance assumption.

The historical object formerly exposed internally as `lifetime` is now also named `historySummary`. It is bounded recent history, not a lifetime career sample; the legacy alias remains only for report compatibility.


## v266 deep-timeline failover integrity

The 100-game scan now treats a timeline fetch failure as a failed deep-evidence slot, not as a successfully filled Last-20 slot. The browser re-runs the bounded deep plan after each fetch round. A row with a timeline error is skipped for the remainder of that run and the planner moves into the next older selected-role, same-queue game until twenty usable timeline slots are available, the comparable history is exhausted, or four bounded replacement rounds have been attempted.

The analyzer mirrors that rule. Its deep-read loop counts a game toward the deep target only when timeline JSON is actually present, and report construction prefers timeline-backed selected-role candidates before any residual no-timeline fallback. Failed recent games remain available in the match-level 100-game history rather than disappearing from the account record.

Data Quality now reports both `deepTimelineGames` and `deepTimelineFallbackGames`, making any residual evidence shortfall explicit instead of silently presenting a 20-game behavioral sample that contains unavailable timelines. Peer-rank targeting follows the same replacement cohort produced by the final fetch plan.


## v267 role-pure history and readable solo-kill rates

Role-specific reports now enforce role purity at the final report boundary as well as during fetch/cohort selection. For a requested ADC report, both the deep sample and the longer-horizon history are checked after hydration. If any TOP, MID, JUNGLE or SUPPORT game survives into either sample, report construction fails with `selected_role_scope_violation` instead of returning a mixed report. The same rule applies symmetrically to every selected role.

The browser independently checks saved reports before display. If a saved report contains another role, it attempts a deterministic rebuild from the existing role-filtered Riot cache. A contaminated saved report is never shown as acceptable fallback context merely because its analyzer version is current.

The long-horizon payload now exposes `roleCounts`, and the page states the included role composition explicitly. This makes “28 ADC games, 0 other-role games” inspectable rather than relying on an implicit upstream filter.

Riot's `challenges.soloKills` is a per-match count. The primary history display is therefore **solo kills per game**. A time-normalized **per 30 minutes** value is included only as secondary context. A raw per-minute value is mathematically valid but produces tiny decimals (for example, roughly 0.04/min for about 1.2 solo kills/game in a 28-minute sample) and is not a useful primary coaching unit.

The history usefulness pass also promotes existing consistency and composition data to visible report sections:
- median and interquartile range for stable history metrics, so one outlier has less influence than it would on a mean;
- role-aware consistency metrics (lane CS and solo kills for lane roles, vision/control wards for Support, epic-monster pressure for Jungle);
- champion-mix cards, so long-horizon DPM/resource changes are interpreted with champion composition in view;
- a special interpretation note when one champion dominates at least 90% of the role history: within-sample trend comparisons are less confounded by champion swaps, but conclusions should not be generalized to other champions.


## v268 role-specific unused-metric promotion

The history audit now consumes several match-level fields that were previously computed but not used, but only where they have a defensible role-specific interpretation.

- **Jungle:** `enemyJungleMonsters` is shown as enemy-jungle monsters per game and can participate in latest-20 vs previous-20 history. It is counter-jungle pressure context only; a higher value does not prove an invade was safe, efficient or strategically correct.
- **ADC / MID / TOP:** Riot `firstTowerKill` / `firstTowerAssist` flags are aggregated as first-turret participation. This is descriptive team structure involvement, not proof that the player won lane.
- **Support:** team `visionScore` rank is aggregated as a vision-leader rate, because leading the team in vision is a more role-relevant historical check for Support than lane-CS style metrics.
- **All roles, per-match detail:** existing team gold rank and team vision rank are now shown next to team damage rank so resource position, output and vision responsibility can be inspected together.

The progress-comparison layer now applies the same role-purity rule as current-report rendering. A previous TOP report is never compared against a current ADC report, even if both belong to the same Riot profile. Cross-role previous reports are explicitly withheld and must be rebuilt in the requested role before they can act as development evidence.

Some available fields remain intentionally unpromoted. `structureDamagePerMin` largely duplicates the clearer turret-damage signal for the current coaching UI, while team-rank fields are ordinal and composition-sensitive, so they are kept as per-match context rather than turned into broad performance scores.


## v269 robust history shift

The long-horizon panel now separates **typical performance** from **variability**. Mean-only latest-window comparisons can be distorted by one unusually strong or weak match, so the analyzer also computes the median and interquartile range (IQR, the middle 50% of observations) for the latest 20 selected-role games and the previous up-to-20 selected-role games.

The page never combines these into a synthetic “consistency score”. Each robust-shift card reports:
- recent median versus previous median;
- the median change in the metric's natural unit;
- recent IQR versus previous IQR;
- whether the middle-50% spread narrowed, widened or stayed roughly stable;
- the actual valid-game counts on both sides.

This allows distinctions such as “typical CS/min improved but match-to-match spread widened” or “lane CS@10 stayed similar while its spread narrowed materially”. Those are more informative than treating average movement and consistency as the same concept.

The comparison heading deliberately says **latest 20 vs previous up to 20**. A 100-account-match scan does not guarantee forty selected-role, selected-queue matches. The UI therefore never implies that the older side contains twenty games when only (for example) eight valid ADC games are available.

Role-specific robust-shift cards remain role-pure and role-aware: lane roles use lane-minions@10, Support uses vision actions, and Jungle uses enemy-jungle monster pressure alongside shared CS/min, damage/min and death-downtime context.


## v270 performance floor and risk tail

Robust history cards now expose the weak-game tail as a third concept alongside the median and IQR.

For metrics where **higher is better** (for example CS/min, lane minions @10 or damage/min), the page uses the **25th percentile (Q25)** as a descriptive performance floor. This answers: “what does the weaker quarter of this sample look like?” A rising Q25 can indicate that low-output games are becoming less weak even when the average barely changes.

For metrics where **lower is better** (currently death downtime in this panel), the page uses the **75th percentile (Q75)** as a bad-tail ceiling. This asks whether the high-cost quarter of games is becoming less extreme.

The tail is never treated as a pass/fail threshold or external benchmark. It is a within-player, selected-role, selected-queue comparison between the latest 20 and the previous up-to-20 games. The median, tail and IQR are intentionally reported separately because they answer different questions: typical level, weak-game severity and variability.

In the current ADC cache this distinction is already useful: the recent Q25 CS/min and lane-CS@10 floors are higher than in the older role sample, while the recent Q25 DPM floor is lower. That combination would be obscured by a single average or synthetic score.


## v271 resource-to-output conversion

ADC, MID and TOP long-horizon history now includes a descriptive **top-2 gold → top-2 damage conversion** metric.

The denominator is only games where the player finishes top-two on their own team in gold earned. The numerator is the subset of those games where the player also finishes top-two on the team in champion damage. The page always shows both numerator and denominator alongside the percentage.

This is deliberately narrower than a generic “efficiency score”. It asks whether games with high team resource position also produce high team damage position. It does not claim that every high-gold game should lead damage, because champion identity, team composition, damage type, split-push responsibilities, game length and who the opponents expose to damage all matter.

The metric is shown only for the lane carry roles (ADC, MID, TOP). Support is evaluated with role-relevant vision/control context, and Jungle retains counter-jungle/objective-pressure context rather than inheriting this carry-lane lens.

In the current role-pure ADC cache, 25 of 28 games finish top-two on team gold and 19 of those 25 also finish top-two on team champion damage (76%). The latest-20 and previous-up-to-20 history windows carry their own eligible-game denominators, so a small-sample percentage cannot masquerade as equally strong evidence.


## v272 lower-resource punch-up context

ADC, MID and TOP long-horizon history now adds a complementary **lower gold → top-2 damage** view beside the existing top-2 gold → top-2 damage conversion.

The denominator is only games where the player finishes outside the top two on their own team in gold earned. The numerator is the subset of those games where the player still finishes top-two on the team in champion damage. The page shows numerator and denominator with the percentage so a tiny eligible sample cannot look like strong evidence.

This is descriptive carry-role context, not an efficiency grade. It is useful because the existing high-resource conversion only answers whether large resource share turned into large damage share. The new view answers the opposite question: whether the player sometimes produces high team-relative damage despite receiving a smaller team-relative gold share.

Champion identity, split-push assignments, utility responsibilities, matchup state, fight access and game duration can all make low gold plus top-two damage more or less meaningful. For that reason the metric is never used alone as a coaching verdict and remains restricted to ADC, MID and TOP history.


## v274 resource-output archetypes

ADC, MID and TOP long-horizon history now groups every game with valid team gold rank and team champion-damage rank into one of four mutually exclusive resource/output archetypes:

- **Top-2 gold + top-2 damage** — high team-relative resource position accompanied by high team-relative champion damage.
- **Top-2 gold + lower damage** — high team-relative resource position without a top-two team damage finish.
- **Lower gold + top-2 damage** — a lower team-relative gold position that still reaches top-two team champion damage.
- **Lower gold + lower damage** — neither team-relative gold nor champion damage finishes in the top two.

These groups are descriptive. They do not assign a grade, and their win rates are withheld when the category has fewer than three games.

For the two lower-damage archetypes, the analyzer adds two overlap checks rather than pretending that lower champion damage has one explanation. It reports how many eligible games also have death downtime above the player's own selected-role history median, and how many have turret damage per minute above the player's own selected-role history median.

Those overlap checks are intentionally phrased as context, not cause. Above-median death downtime can mean the player had less time alive to participate in fights, but it can also be a consequence of fighting. Above-median turret pressure can indicate that some output went into structures rather than champions, but it does not prove split-pushing was strategically correct. Champion identity, composition, role assignment, game state and fight access still matter.

The archetype panel is shown only for ADC, MID and TOP. Jungle and Support retain their role-specific long-horizon lenses instead of inheriting a carry-lane resource/output model.


## v275 Support vision burden

Support long-horizon history now consumes the already-computed per-match `visionShare` field instead of leaving it unused.

**Team vision share** is the player's vision score divided by the team's total vision score for that match. It complements rather than replaces vision actions per minute:

- vision actions per minute describes ward-placement and ward-clear activity normalized for game length;
- team vision share describes how much of the team's total recorded vision score came from the Support;
- vision-leader rate remains secondary context showing how often the player ranked first on their own team in vision score.

The metric is deliberately Support-specific in the main history UI. Higher vision share is not automatically better because team composition, game state, teammates' warding, sweeper usage, objective control and map access all affect the denominator. It is therefore presented as burden/context, not as a universal grade.

Latest-20 versus previous-up-to-20 history can show team vision-share movement when both windows contain at least five valid observations. Whole-history consistency also exposes its median and middle-50% range.


## v276 drillable archetype evidence

The ADC/MID/TOP resource-output archetype panel is now drillable instead of ending at aggregate percentages.

Each archetype retains at most eight exemplar games. The ledger includes match ID, date, champion, result, team gold rank, team champion-damage rank, DPM, death-downtime percentage, turret damage per minute and whether the game sits above the player's own selected-role median for death downtime or turret pressure.

The examples are ordered by **contrast in available explanatory context**, not by inferred cause. For lower-damage archetypes the ordering gives more prominence to games where death downtime or turret pressure is unusually high relative to the player's own role history, plus larger gold-rank versus damage-rank separation. This is only a review-ordering heuristic.

If an exemplar is part of the deep recent sample, the page offers **Open full evidence** and enters the existing per-match replay/evidence surface. Older 100-game history examples do not pretend to have timeline evidence; they are explicitly labeled **Match-level history only**.

This keeps the 100-game model useful for pattern discovery while preserving the existing evidence boundary: Last-20 deep timelines can support detailed causal-looking review questions, whereas older history remains match-level descriptive context.


## v277 archetype-to-story linkage

The resource-output drilldown now connects directly to the existing Recent match story instead of creating a second disconnected per-game review surface.

When an archetype contains exemplar games that are also part of the deep recent sample, the drilldown shows a **Review recent deep examples in match story** action. Activating it applies a display-only match-story filter keyed to that archetype's exemplar match IDs.

The filter never changes report calculations, coaching aggregates, archetype counts or Last-20 selection. It only narrows the already-built Recent match story to the deep-sample games represented by that archetype.

The archetype filter is hidden unless it is actively meaningful. If no matching deep games remain, it fails back to the unfiltered story rather than leaving the user on an empty stale filter.

Older 100-game exemplars remain in the archetype ledger as match-level evidence only and are not injected into the deep story, preserving the distinction between long-horizon pattern evidence and timeline-backed game review.


## v278 archetype share magnitude

Resource/output archetypes remain defined by the simple team-rank 2x2 matrix, but each category now also reports continuous magnitude using the match-level team-share fields already present in the analyzer.

For every archetype the backend exposes:
- average team gold share;
- average team champion-damage share;
- average **damage share minus gold share** in percentage points.

The drilldown exemplar rows expose the same gold-share → damage-share relationship per match. This prevents ordinal rank boundaries from hiding important differences: two games can both be “top-2 gold + lower damage” while one misses the damage cutoff narrowly and another consumes materially more team gold than the damage share it produces.

The percentage-point gap is still descriptive, not an efficiency grade. Champion identity, damage profile, split-push responsibility, utility contribution, game duration and fight access can all change the expected relationship between gold and champion damage.


## v279 deep archetype review contexts

The **Top-2 gold + lower damage** archetype now adds one strongest supported replay context for each exemplar that belongs to the deep recent sample.

The diagnostic hierarchy is intentionally conservative:

- **Pre-impact fight deaths** when the player died before tracked contribution in at least one active fight.
- **Fight-readiness pressure** when an active fight began with at least 1000g unspent and/or the trusted direct-role opponent had completed a major item first.
- **Earlier-item window unused** when trusted direct-peer evidence shows a supported earlier-major-item window but no tracked kill/assist or player-supported objective impact occurred inside it.
- **High structure pressure** when turret damage per minute is above the player's own selected-role history median.
- **No supported explanation** when none of the defined deep-evidence contexts is supported.

The ordering chooses one review prompt, not a cause. A pre-impact death can reduce later damage opportunity, but it can also result from the same difficult fight state that reduced damage. Readiness signals likewise describe the state at fight start and do not prove why damage output was lower.

The model deliberately does **not** create a generic “missed fights” label. The current fight evidence reliably distinguishes active involvement from proximity-only presence for tracked fight clusters, but it does not provide a defensible denominator of every teamfight the player should have attended. Until such an attendance model exists, absence from fights is not inferred.

The drilldown also summarizes how many recent deep exemplars fall into each review-context label. Older 100-game examples remain match-level only and receive no deep diagnostic tag.


## v280 position-supported teamfight absence

The deep timeline model now exposes a conservative **tracked teamfight absence** context without pretending to know whether the player should have joined every fight.

A fight cluster can contribute to this absence model only when:
- it is a supported multi-kill cluster;
- the player's team is involved in the cluster;
- Riot provides event coordinates;
- a player position frame within 35 seconds of a positioned fight event is available;
- the player has no tracked kill/assist contribution or death in the cluster;
- no supported player proximity within 5000 units is found around the cluster.

The analyzer records both the number of **position-supported teamfight clusters** and the subset counted as **tracked absences**, plus a bounded event ledger. These counts are separate from active-fight execution metrics: survival, first-death, readiness and contribution rates still use active involvement only.

For high-resource/lower-damage archetype review, tracked absence is considered only after stronger direct evidence such as pre-impact deaths and fight-readiness pressure. The page phrases it as absence context — never as proof that joining the fight was correct, possible, or strategically preferable.

This closes part of the earlier evidence gap without introducing a generic missed-fight label. Fully unsupported or position-ambiguous fight absence remains unclassified.


## v281 high-resource conversion contrast

The carry-role archetype panel now adds a direct comparison between the two **high-resource** groups when both have enough evidence:

- Top-2 gold + top-2 damage
- Top-2 gold + lower damage

The contrast is withheld until both groups contain at least five **clean outcomes** after AFK/early-surrender games are excluded. When available, the page reports total and clean game counts, each clean win rate, the descriptive clean win-rate gap, and clean-population differences in damage-share minus gold-share and death downtime.

This is explicitly an association, not a causal model. The comparison answers whether high-resource games with stronger team-relative champion-damage output happened to have different outcomes and availability patterns in this player's own role history. It does not claim that increasing champion damage would reproduce the observed win-rate gap.

The current 28-game ADC cache provides enough evidence for this contrast: 19 high-resource/high-damage games and 6 high-resource/lower-damage games. Small categories outside this comparison remain contextual and do not receive an equivalent outcome claim.


## v282 saved-report persistence verification

The frontend no longer equates “analyzer returned a report” with “the report is safely stored”.

Every fresh `analyze_basic` response must include an `analysis_id`. After rendering, the browser immediately calls the role-specific `report_latest` path and verifies that the newest saved analysis ID matches the ID returned by the analyzer.

Only after that check succeeds does the page describe the result as a **Saved Kalenel report**. If the report renders but the persistence readback does not match yet, the UI says **Generated report · save verification pending** and explicitly notes that cached Riot data remains available for deterministic rebuild.

Cache-only saved-report rebuilds apply the same first boundary: a rebuild without a returned `analysis_id` is treated as a persistence failure rather than silently presenting the report as saved.

This hardening is motivated by the current persisted state: the profile and match cache are populated while `league_analysis_runs_v1` contains no saved analysis rows. Fetch completion and analysis are separate requests, so interruption between them can legitimately leave this state. The existing load path will rebuild from cached Riot data when the saved role report is missing.


## v283 deep high-resource behavior contrast

The analyzer now compares the two deep selected-role **high-resource** cohorts directly:

- Top-2 team gold + top-2 team champion damage
- Top-2 team gold + lower team champion damage

This comparison is separate from the long-horizon 100-game archetype summary. Only deep games with timeline evidence enter behavior metrics.

AFK/early-surrender games are excluded before the deep cohorts are built.

The comparison includes:
- deaths before tracked contribution / active fights;
- active fight starts with at least 1000g unspent;
- active fight starts where a trusted direct-role opponent had completed a major item first, only when exact-patch item mechanics are available;
- tracked teamfight absence / position-supported teamfight clusters;
- first-reset economy-loss rate;
- first-reset timing delta versus the trusted direct-role peer;
- utilization rate of supported earlier-major-item windows;
- death-before-impact rate inside those item-spike windows;
- death downtime;
- turret damage per minute.

Every metric retains its own evidence denominator. Event-rate rows expose eligible games plus event opportunities. Peer-relative reset and item-spike rows require a trusted direct-role opponent and fail closed otherwise.

The frontend withholds a metric row unless both cohorts have at least three eligible games with a supported value. Event-rate rows additionally require at least five supported opportunities in each cohort. Therefore a well-populated death-downtime comparison can remain visible while a thin fight or item-spike comparison is hidden.

Differences are shown as **lower-damage cohort minus converted cohort**. They are descriptive within-player associations and are intended to identify replay questions, not causal mechanisms or universal targets.


## v284 verification corrections

A full verification pass over v274–v283 found four places where the implementation was structurally present but the evidence boundary could be stronger. These are corrected in v284 / analyzer v4.160.

1. **Tracked teamfight absence now requires temporally bounded position evidence.** The player position used to support an absence must come from the nearest timeline frame within 35 seconds of a positioned fight event. A generic previous frame is no longer sufficient. The stored absence event includes the frame-to-event time delta for traceability.

2. **Item-disadvantage fight rates fail closed when item mechanics are unavailable.** A game now enters that denominator only when the direct role peer is trusted and the exact-patch item catalog made item mechanics eligible. Fallback Data Dragon catalogs can no longer turn unavailable item evidence into a misleading 0% disadvantage rate.

3. **Deep event-rate contrasts require opportunity depth as well as game depth.** Every row still needs at least three eligible games in each cohort, but event-based rows additionally require at least five supported event opportunities in each cohort. A rate based on one or two fights is withheld.

4. **Outcome and explanatory populations are cleaned up.** AFK/early-surrender games are excluded from the high-resource outcome contrast and from the deep behavior contrast. Archetype cards use clean-outcome win rates when at least three clean games exist, and compromised exemplars are explicitly labeled. The deep behavior table no longer includes damage-share minus gold-share because that output quantity is partly entailed by the cohort definition and is therefore circular as an explanatory behavior.

The high-resource outcome contrast now requires at least five clean games in each high-resource group. Its damage-share-minus-gold-share and death-downtime context are calculated on the same clean-outcome population used for the clean win-rate comparison.

For the current cached ADC sample, the raw high-resource groups are still 19 top-2-gold/top-2-damage games and 6 top-2-gold/lower-damage games. One game in the former group carries compromised-outcome context. The clean outcome comparison is therefore 13/18 wins (72.2%) versus 1/6 wins (16.7%). This remains descriptive association, not causal evidence.


## v285 verification follow-up

A second verification pass corrected two additional edge cases.

### Stable team-relative rank semantics

Team gold, champion-damage and vision ranks now use **competition-rank** semantics:

`1 + number of teammates with a strictly larger value`.

The previous implementation sorted the team and used array position. That could arbitrarily split exact ties based on participant order, potentially placing two equal players on opposite sides of a top-two cutoff. Competition rank keeps tied values tied and makes the resource/output archetypes deterministic.

The current cached ADC/TOP sample contains no exact player ties in gold earned or champion damage, so this correction does not alter the currently observed archetype counts. It prevents incorrect future classifications.

### Fight-position evidence selection

Tracked teamfight absence no longer relies on the first kill event in a cluster that happens to contain coordinates. The analyzer scans positioned kill events in the cluster and accepts the first event for which Riot also supplies a player position frame within 35 seconds.

This remains fail-closed: if no positioned event has temporally bounded player-position evidence, the cluster cannot enter the tracked-absence denominator.


## v286 reset denominator separation

A verification pass found that the deep high-resource comparison was using one overly strict reset-eligibility predicate for two different questions.

**First-reset economy loss** still requires:
- a trusted direct-role peer;
- a measured before/after economy window;
- no death contamination inside that bounded comparison window.

**First-reset timing versus the role peer** now uses its own population:
- a trusted direct-role peer;
- a finite first-reset timing delta versus that peer.

Timing no longer requires the post-reset economy swing to be measurable and does not discard a valid timing observation merely because a death later contaminates the economy comparison window.

This keeps each row's denominator aligned with the evidence needed for that row rather than inheriting stricter requirements from a neighboring metric.


## v287 production persistence runtime certification

A production smoke test against the deployed League Edge Function exposed a runtime-only scope error in the resource/output archetype exemplar projection: the exemplar map callback referenced a `lower` binding that existed only inside the separate exemplar scoring callback. Static source-contract checks did not execute that path, so the error survived while `analyze_basic` failed before persistence.

Analyzer `league-web-behavior-v4.162.1` computes the lower-damage predicate inside the exemplar map callback itself. The regression contracts now explicitly forbid the out-of-scope form.

The repaired production function was then exercised against an isolated clone of the existing 30-match cache. A fresh ADC analysis completed with 20 selected-role games, persisted a compact report, and `report_latest` returned the exact same analysis id and analyzer provenance. The reloaded compact payload retained all four resource/output archetype categories and the usable high-resource behavioral contrast (13 high-resource/high-damage games versus 4 high-resource/lower-damage games). This turns saved-report persistence from a source-only claim into an observed production read-after-write property.


## v288 full-page integrity, readability and support-synergy audit

Analyzer `league-web-behavior-v4.163` was re-audited from Riot match/timeline inputs through report aggregation, compact persistence and frontend interpretation.

Fight-state rates now use their own supported-opportunity denominators (current gold, direct-role gold, local numbers, or exact-patch direct-peer item state) instead of treating missing evidence as an implicit negative. Outcome-linked coaching now excludes AFK/early-surrender compromised games from win/loss comparisons and lead/deficit-to-final-result conversion claims.

ADC reports now retain the uniquely resolved allied Support champion for both deep and match-only history and build a support-synergy model across the selected-role queue cohort. Every resolved Support champion is shown, while the “best” ranking requires at least three clean outcomes and sorts by the 95% Wilson lower bound. This prevents 1–0 or 2–0 pairings from outranking larger established samples. The section also reports the ADC player's KDA, DPM, CS/min, KP, deaths, direct-peer @15 gold where available, and ADC × Support champion pairings.

Frontend `20261004-league-web-v287` replaces the abstract “Recent direction” count summary with named latest-five vs prior metrics, rewrites the priority explanation into four plain-language stages, and applies a readable-first typography/spacing pass across the League page.


### v287 readable text floor

The readability pass now also overrides legacy micro-label rules that were still as small as 0.53–0.74rem. Supporting text and card/row/header labels have a readable floor while preserving visual hierarchy, and the desktop shell remains capped at the established 1760px width rather than becoming edge-to-edge.


## v289 support-champion and recurring support-player reliability

Analyzer `league-web-behavior-v4.164` separates three distinct questions that were previously too easy to conflate:

- **Established support champion result:** at least five clean outcomes with that allied Support champion. Ranking uses the 95% Wilson lower bound, so a 3–0 support cannot claim the established top spot over a much larger repeated sample.
- **Promising support champion sample:** three or four clean outcomes. These remain visible with their observed win rate and output context but are explicitly unranked as established evidence.
- **Recurring Support player result:** grouped by the Riot ID recorded in the match, again requiring five clean outcomes for the established ranking. The report shows the ally's own KDA, kill participation and vision/min alongside the ADC player's KDA/DPM and that support player's champion pool.

ADC × Support champion pairings keep a separate three-clean-game floor because pair samples are naturally thinner than champion-level or recurring-player samples. AFK and early-surrender outcome-compromised games remain excluded from every result ranking.

The recurring-player model deliberately stores and exposes the recorded Riot ID only. It does not export allied PUUIDs. Riot-ID renames can therefore split one human player's historical sample into two labels; the UI states this limitation rather than pretending identity continuity that Riot match history cannot prove from the display name alone.

Frontend `20261004-league-web-v289` adds the recurring Support-player table and changes the support summary to distinguish established results from promising small samples.


### v290 recurring-player display semantics

Analyzer `league-web-behavior-v4.165` tightens the recurring Support-player view after production validation. A human Support player must now appear in at least **two shared matches** before receiving a row; one-off solo-queue teammates are omitted from that table. The five-clean-game established ranking floor is unchanged.

The 3–4 clean-game tier is now called a **developing sample**, not a “promising” sample. This is intentionally outcome-neutral: a 3-game 0–3 record and a 3-game 3–0 record are both medium-sized samples that are too small to be promoted to the established ranking. Frontend `20261004-league-web-v290` remains backward-compatible with saved v4.164 reports that used the old internal `promising` tier label.


### v291 readability regression guard

The recurring Support-player champion-pool chips were the only post-v288 component that reintroduced text below the page-wide readable floor. They now use 0.9rem text and a larger line height. Frontend `20261004-league-web-v291` cache-busts this correction, and the web contract now prevents that chip text from shrinking again.


## v292 reviewed-account-only support context

The human Support-player analytics added in v289-v291 are removed. That branch over-interpreted the requested support review: the League page is meant to analyze the selected account, not build statistical profiles of its teammates.

Analyzer `league-web-behavior-v4.166` no longer stores or returns allied Support Riot IDs, teammate KDA, teammate kill participation, teammate vision/min, recurring-player groups, or “best Support player” rankings.

Support **champions** remain only as contextual grouping for the reviewed ADC account. Every performance metric in the section belongs to the reviewed account: clean win rate, KDA, DPM, CS/min, KP, deaths, direct ADC-peer gold @15, and the reviewed account's ADC × support-champion combinations. The allied champion is a grouping variable, not a second player being reviewed.

Frontend `20261004-league-web-v292` removes the recurring-player table and labels the support section explicitly as reviewed-account-only analysis.


## v293 / analyzer v4.167 champion-conditioned history and evidence-aware review

The longer-horizon layer now separates three questions that were previously mixed together.

**Champion-conditioned history** groups only the reviewed account's own selected-role games by the champion the reviewed account played. It reports exact per-metric denominators, clean win rate only when at least three clean outcomes exist, and match-level role metrics that remain available beyond the deep Last-20 timeline window. This is descriptive within-account context. Champion selection, matchup, patch, composition and player state can all confound the differences, so the cards do not claim a champion caused an outcome.

**Long-horizon outcome fingerprint** compares match-level win/loss distributions across up to the selected 100-game role history. Directional coloring and the "largest separation" read require at least five outcome-uncompromised wins and five outcome-uncompromised losses. When that clean split is not available, the broader result split may still be shown, but it remains neutral context only. Standardized gaps use the same small-sample Hedges correction as the deep coaching-cohort fingerprint and are descriptive rather than causal or significance tests.

**Practice target review windows** still begin with a five-new-game minimum. Metrics whose evidence opportunities are naturally rare can continue collecting evidence until the metric's existing evidence floor is reached, with a hard cap of twenty new games. If the cap is reached without enough evidence, the result is marked inconclusive instead of silently treating missing opportunities as success or failure. Saved windowGames:5 remains for compatibility; new reports also carry baseWindowGames:5, maxWindowGames:20, and the explicit minimum_5_extend_until_evidence_max_20 policy.

The account-only Support rule remains unchanged: allied Support champions can be contextual grouping variables for the reviewed account's own performance, while human teammate identities and teammate-performance profiles remain excluded from the report contract.


## v294 / analyzer v4.168 practice-target provenance and fresh evidence

Practice targets now have a stable review origin. When the same metric remains one of the active priorities across intermediate analyses, its original baseline, goal, denominator requirements, origin match IDs and origin timestamp are carried forward rather than silently moving the goalposts. A lineage resets when the metric leaves the active plan, the coaching context changes, or the twenty-new-game cap is reached.

For supported evidence denominators, the five-to-twenty-game review gate is now genuinely post-plan. The UI reconstructs the games that entered after the target origin and counts evidence from those games only. This includes timeline games, trusted direct-peer checkpoints, first-impact samples, first-reset clean games, item-spike opportunities, fight samples, classified deaths, vision actions and wards, contested objective encounters, objective setup joins, kill-conversion windows, closing-with-a-lead samples, roam attempts/lane-cost windows, Support ADC-lane-movement windows, mid-routing samples, and session-position samples.

If a denominator cannot be reconstructed safely from persisted per-game evidence, the system does not pretend that the fresh-evidence gate is available. It falls back to the fixed five-game gate and requires the rolling report denominator to remain valid. The value shown for a completed target remains the current rolling selected-role metric; the fresh-only calculation is used to decide whether enough post-target evidence exists to judge it. This distinction is stated in the UI.

Human teammate analytics remain excluded. None of the target-lineage or fresh-evidence logic stores teammate Riot IDs or teammate performance statistics.


## v296 visual analytics surfaces

The report now includes a dedicated visual analytics dashboard. It does not introduce new coaching metrics or alternate thresholds; it visualizes evidence already present in the report contract.

- **Recent-form movement** converts each ready latest-vs-prior change into units of that metric's existing practical-change threshold. Positive always means more favorable after applying the metric's established inverse direction where needed. This makes different units visually comparable without pretending they share a raw scale.
- **Phase-risk bars** plot high-risk, costly and severe-consequence deaths per ten actual phase-exposure minutes for early, transition and late strategic phases. The existing five-game / twenty-exposure-minute evidence floor is retained; thinner samples are visually faded and remain descriptive.
- **Long-horizon outcome effects** plot Hedges-corrected standardized gaps from the existing long-horizon win/loss fingerprint. Inverse metrics are direction-adjusted so rightward always means more favorable in wins. Directional interpretation still requires the clean-outcome gate; otherwise bars remain neutral context.
- **Objective-family presence** plots supported joined/contested presence percentages by neutral-objective family and prints the exact denominator on every bar.
- **Champion-history clean win rate** plots only champions with at least three clean outcomes and orders them by sample depth rather than win rate, reducing small-sample visual ranking bias.
- **ADC + Support champion graph** plots the reviewed account's clean win rate grouped by allied Support champion. Established and developing sample tiers stay distinct, and the 95% Wilson lower-bound marker remains the ranking safeguard. No human teammate identity or teammate performance metric is introduced.

All graph renderers preserve unavailable evidence as unavailable rather than coercing missing values to zero. The visual dashboard is therefore another view of the same evidence model, not a second analytics pipeline.
