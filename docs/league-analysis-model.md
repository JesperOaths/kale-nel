# Bruisienator web analysis model

This file is the behavioral-analysis contract for `kalenel.nl/league`.

The purpose of the web analyzer is not to produce a decorative stat page. It should identify repeatable player decisions, show the evidence behind a judgment, compare the player with relevant peers and with their own broader history, and turn those findings into specific actions to practise.

## Multi-profile browser workflow

The historical desktop tool used a profile manifest plus PowerShell wrappers to run several accounts in sequence. The browser workspace preserves that useful workflow without recreating the local wrapper stack.

The League page exposes a **Batch profiles · sequential** control built from the same saved web profiles used by the normal single-profile selector. Users can select any subset and run either:
- **Fetch / update selected** — performs Riot/cache updates for each selected profile in order,
- **Analyze selected** — analyzes the already-cached data for each selected profile in order.

Batch execution intentionally remains sequential. This limits Riot/API pressure, reuses the same per-profile fetch and analysis code paths as the ordinary buttons, and makes failures easier to attribute. A failure for one profile is logged and does not stop the remaining selected profiles. When the batch finishes, the workspace restores the profile that was active before the batch began.

Fetch and analysis remain separate operations in batch mode for the same reason they are separate for one profile: cached reports can be regenerated without making new Riot requests, and a user can refresh several accounts without automatically starting analysis work they did not request.

The session-only Riot key model also applies to batch fetches. The key is sent only as the request header used by the current tab and is not written into a profile, report, cache, repository, or batch manifest.

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

To keep rank-band comparisons aligned with the actual coaching sample without ranking every raw match, `fetch_finish` now:
1. reads the cached matches from the completed fetch run in original recency order,
2. applies the same Summoner's Rift + ≥10-minute eligibility,
3. computes the same dominant raw queue ID,
4. takes the first 20 matches from that comparable queue context,
5. fetches an opponent rank snapshot only when one of those target matches is missing it.

The response exposes `dominant_queue_id`, `comparable_cached_games`, `peer_rank_target_count`, and `peer_rank_backfilled` so the frontend can report what happened.

The backfill is computed against the same last-100 cached match universe used by `analyze_basic`, not only the IDs in the most recent fetch run. If fewer than 20 comparable cached games remain after map, duration and queue filtering, `recommend_deeper_cache` is returned so the frontend can recommend a 100-match refresh instead of presenting a thin sample as a complete Last 20.

This keeps Riot rank lookups bounded to the final comparable sample instead of blindly ranking all 50 cached raw matches.

## Queue-context isolation

Summoner's Rift alone is not a sufficient comparability filter because Riot's match payload also includes a `queueId` identifying the match queue/context.

The analyzer therefore keeps all fetched matches cached, but after the map and minimum-duration filters it:
1. counts the raw Riot `queueId` values,
2. selects the most represented queue ID in the eligible sample,
3. uses only that queue ID for the Last-20 deep coaching sample and broader cached baseline,
4. reports how many otherwise-eligible games were excluded because they belonged to another queue ID.

This deliberately uses the **raw queue ID** instead of hard-coded queue names. The isolation remains correct even if Riot changes a human-readable queue description later.

The Data Quality block exposes the dominant queue ID, queue counts, analyzed-context game count, and excluded-other-queue count. A smaller homogeneous sample is preferred over a larger sample that mixes materially different play contexts.

## Coaching-sample eligibility

The cache and the coaching sample are deliberately different.

All fetched matches can remain cached, but deep behavioral coaching currently requires:
- Summoner's Rift (`mapId = 11`),
- at least 600 seconds / 10 minutes of game duration,
- a usable normalized role for the player.

A game below 10 minutes is excluded as a **short / non-representative sample**. This is an analysis-quality threshold, not a claim that Riot officially classifies every sub-10-minute game as a remake.

The report's Data Quality block must expose:
- cached games,
- Summoner's Rift games,
- eligible Summoner's Rift games,
- excluded other maps,
- excluded short games,
- excluded missing-role games.

Excluded matches remain cached and can still be inspected later; they simply do not influence the Last-20 behavioral coaching or broader self baseline.

## Data flow

1. **Fetch / update** obtains Riot Match-V5 match data, timelines, player rank, and (for the latest 20 cached matches) the actual same-role opponent's rank.
2. Match/timeline data is cached per Kalenel League profile.
3. **Analyze cached Last 20** makes no Riot match/timeline calls.
4. Deep timeline behavioral analysis is limited to the newest 20 games.
5. Up to 80 older cached matches are used as a lightweight personal baseline.

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
- DQI, if restored, is a 0–10 metric. Do not substitute another formula.
- AGOR remains undefined until its historical formula is recovered.

## Mixed-role samples

The page may show an overall Last-20 summary across all eligible Summoner's Rift games, but **behavioral coaching is role-specific**.

Choose the most common normalized role in the Last 20 as the primary coaching role. Then:
- role-sensitive peer comparisons use only games in that role,
- lane, item timing, roaming, first impact, resource-conversion and win/loss coaching use only that role,
- the broader personal coaching baseline is filtered to that same role,
- champion-specific judgments compare champion+role samples with the player's own primary-role baseline.

Do not mix ADC and SUPPORT behavior into one coaching average merely because both occurred in the Last 20.

## Role normalization

- `UTILITY`, `SUPPORT` → **SUPPORT**
- `BOTTOM`, `BOT`, `ADC` → **ADC**
- `MIDDLE`, `MID` → **MID**
- `JUNGLE` → **JUNGLE**
- `TOP` → **TOP**

Role-aware conclusions must use the normalized role.

## Early lane outside pressure

For **TOP and MID only**, the analyzer separates clean direct-role duel deaths from early home-lane deaths involving other enemy roles.

A death enters this comparison when:
- it occurs by 14 minutes,
- the player's mapped position is in their normalized home lane,
- the role is TOP or MID.

An **outside-pressure death** means at least one enemy participant in the kill event is not the actual same-role opponent. The report preserves the attacker-role set where Riot participant data supports it.

This is deliberately not applied to ADC/SUPPORT, because bot lane is structurally a multi-player lane and the same interpretation would be misleading.

If outside-pressure deaths dominate a sufficiently large early-lane death sample, coaching should focus on:
- wave depth while enemy positions are unknown,
- ward timing before vulnerable waves,
- jungle/support tracking,
- whether a trade is still safe when outside pressure is missing from the map.

This distinction prevents the report from misdiagnosing a map-awareness problem as a pure matchup-mechanics problem.

## Solo-kill structure conversion

A clean solo kill is useful only if the player converts the temporary advantage intelligently.

The primary window is the **queue-aware early phase**, not an obsolete turret-plate timer. For 2026 standard Summoner's Rift that early phase ends at 14:00 because the map's macro cadence changes there; turret plates themselves do **not** expire at 14:00. For 2026 Swiftplay the early window follows its accelerated rules profile.

For each clean early-phase solo kill on the actual same-role opponent, inspect supported structure evidence for the next 90 seconds.

A structure conversion can be supported by:
- direct Riot participant credit on a turret plate or turret building event,
- event-position proximity when the timeline event has usable coordinates,
- same-lane timeline presence when a plate event exposes lane/tower metadata but omits participant credit and usable coordinates.

The evidence source must be retained. A weaker lane-presence fallback is not equivalent to direct event credit and must not be presented as such.

Since Patch 26.1, the analyzer treats plate rewards as a persistent turret-system mechanic rather than a pre-14 mechanic. Preserve:
- player and direct-role-opponent plate involvement through the fixed 20-minute coaching slice,
- full-match plate involvement,
- direct-credit counts as provenance diagnostics,
- the number of unattributed plate events,
- plate involvement split by turret tier: outer, inner, inhibitor, Nexus, and unknown,
- supported turret-kill involvement.

The 20-minute slice is a coaching comparison window, **not** an expiry rule. Full-match and tier breakdowns are required because later/deeper turret pressure now matters.

This metric complements, rather than replaces, solo-kill → @15 economy conversion and post-kill reset/banking metrics. Resetting can be the correct conversion after a kill, so low structure conversion is not automatically a mistake. Coaching should ask whether the player deliberately chose wave denial, safe structure value, reset, or another higher-value map action.

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

Where both player and direct same-role opponent have a fetched Solo/Duo rank snapshot, also classify the opponent by **tier/division band**:

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

Rank is a **fetch-time snapshot**, not the opponent's historical rank at the exact match date. Phrase conclusions accordingly and do not overstate small samples.



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

## Mid-game farm routing

For TOP, MID and ADC, the analyzer separately tracks the change in **same-role CS differential from 15→25 minutes**.

This is intentionally separate from gold-differential swing:
- gold can change through kills, objectives and shutdowns,
- CS swing more directly describes who is collecting farm after lane.

The per-game report compares `csDiff15` with `csDiff25`. Aggregate coaching requires multiple comparable games.

Current interpretation:
- repeated negative swing of roughly **8 CS or more on average** → review post-lane wave assignments/routing,
- repeated positive swing of roughly **8 CS or more** → potential post-lane farming strength.

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

For each death where the timeline supports a later comparison, preserve the direct-role economy state at death and at the next supported timeline state roughly one frame later.

Current consequence signals include:
- direct-role gold differential worsens by at least ~300g,
- direct-role CS differential worsens by at least ~6 CS,
- an enemy **neutral objective** is converted inside the post-death neutral-objective window,
- an enemy **structure** is converted inside the post-death structure window.

Neutral objectives and structures are retained as distinct signals. A nearby turret/plate event must not be relabeled as a dragon/Baron-style objective consequence.

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

Post-lane side pressure is useful, so the analyzer must not label every side-lane death as bad.

The start of the side-lane-risk window is **rules-driven**, not hard-coded to 15:00:
- 2026 standard Summoner's Rift: 14:00,
- 2026 Swiftplay: 12:00,
- historical/future rules use their stored compatibility profile.

A **post-early-phase side-lane death** requires:
- game time at or after that rules profile's post-lane start,
- death in the coarse top-lane or bot-lane zone.

A death is additionally **isolated** when no allied participant is within 3,000 map units at the supported timeline frame.

A **pre-neutral-objective side-lane death** requires:
- a post-early-phase side-lane death,
- isolated/no ally within 3,000 units,
- a tracked neutral-objective event within 90 seconds afterward.

The old `post15SideLaneDeaths` field is retained only as a compatibility counter. New coaching and rates use `postLaneSideLaneDeaths`.

This is a timing/macro signal, not a blanket criticism of split pushing. Coaching should emphasize reconnect timing when the next neutral-objective window matters. If an objective is intentionally conceded, dying on the cross-map trade can still erase the value of the side pressure.

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

A kill window is treated as converted when the player's team secures a tracked neutral objective or structure within roughly 75 seconds after the window ends. The same calculation is performed for the actual same-role opponent's kill-involvement windows.

Useful aggregate comparison:
- player's team post-kill conversion rate,
- opposing role's team post-kill conversion rate,
- percentage-point delta between them.

This is explicitly **team-context evidence**. The player can influence the decision after a won skirmish, but they do not unilaterally control four teammates. Coaching should say "your team converts player-involved kill windows at X%" rather than attributing every conversion/failure solely to the player.

The action recommendation is decision-oriented: after winning a skirmish, scan immediately for objective, structure and wave value before chasing or resetting.

## Neutral-objective reset timing

For tracked team neutral objectives (dragon/Baron/Herald-family events), preserve whether the player was present and the timing of their most recent detected shop visit.

A **late-reset miss** requires all of the following:
- the team secures a tracked neutral objective,
- the player is not within the objective action radius,
- the player was not recently dead,
- the last detected shop visit ended within 60 seconds before the objective.

This is intended to separate a timing/planning error from an absence caused by death.

Also preserve **fresh-purchase joins** where the player attends the objective within roughly two minutes of a detected shop visit. These can support a positive reset-timing judgment.

The shop event is an approximation based on Riot item-purchase events, not an exact recall-channel timestamp.

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

## Objective root-cause diagnosis

When primary-role objective presence is low enough to trigger coaching, rank the supported setup explanations rather than showing disconnected metrics.

Current supported causes include:
- **late reset timing** — repeated neutral-objective misses after a late shop/reset window,
- **death before the contest** — deaths followed by enemy objective conversion,
- **setup-vision deficit** — materially lower objective-setup ward share than the actual same-role peer sample.

Rank supported causes by their evidence severity and expose the highest-ranked cause as the **primary supported cause**.

If no reset/death/vision cause crosses its threshold, do not manufacture certainty. Report **arrival/pathing as the remaining hypothesis**, explicitly marked as unresolved.

This is an evidence-ranking model, not causal proof. The UI must show the concrete evidence for each ranked cause.

## Neutral-objective setup timing

Attendance and setup are separate behaviors.

For neutral objectives taken by the player's team, the analyzer checks whether the player is near the objective at the objective event and whether a prior Riot timeline frame within roughly two minutes already places them near the area.

Current evidence labels:

- **prior-frame setup:** player is present at the objective event and a prior timeline frame at least ~45 seconds earlier places them within the setup radius,
- **event-frame-only join:** player is present at the event but has no supported prior-frame setup evidence,
- **absent:** player is not supported as nearby at the event frame.

Because Riot timeline position frames are coarse, these labels must not be presented as second-perfect arrival timestamps. `setupLeadSec` is the distance between observed timeline frames and the objective event, not an exact pathing arrival time.

Aggregate coaching can distinguish a player who attends objectives but usually arrives reactively from one who is already established early enough to contribute to vision/positioning. The aggregate setup-rate denominator is joined neutral objectives; setup coverage uses all tracked team neutral objectives.

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

Outcomes:
- kill/assist or neutral-objective conversion during the detected departure → success,
- player death during the departure with no successful event → failure,
- otherwise neutral.

For SUPPORT, also inspect the change in allied ADC versus enemy ADC CS differential during the roam. A roam that gives no kill/assist/objective return and costs the ADC substantial lane CS can be highlighted as expensive.

The cutoff is a behavior-analysis window, not a claim that rotations stop when Baron becomes available. After the major-objective-era boundary, movement is better interpreted as broader macro/side-lane/objective routing rather than an early roam.

### Roam lane cost

For lane roles with a valid same-role opponent, measure direct-role CS differential at roam departure and return:

`(player CS - peer CS at return) - (player CS - peer CS at departure)`

Negative means the direct opponent gained CS advantage while the player was away.

Current coaching treats a loss of roughly 6 or more CS as materially costly. A roam with no kill/assist/objective return plus that lane loss is a strong improvement signal. A roam can still be described as economically expensive even if it produced a kill; do not equate "successful event" with "good roam."

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
- nearby participation in a grouped neutral-objective encounter.

Also preserve whether the player dies inside the window **before any tracked impact**.

The aggregate utilization rate is:

`utilized earlier-item windows / measurable earlier-item windows`

This metric does not require the player to force a fight just because an item was purchased. Coaching should ask whether the temporary breakpoint was used to create pressure or map value before parity, while still respecting wave state and objective availability.

A window shorter than 45 seconds is not considered meaningfully actionable and is excluded rather than counted as a failure.

## First-reset sequence quality

The first meaningful purchase sequence is analyzed separately from later recalls and item spikes.

Current detection:
- find the first purchase group by 12 minutes with at least 250g detected spend,
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

Fight-start level differential is only treated as a readiness signal when the **actual same-role opponent is also locally present in the same attended fight cluster**.

Current implementation:
- use the first kill-event position as the fight anchor,
- require the role opponent's timeline position to be within roughly **5000 world units**,
- compare player level with that same-role opponent,
- classify a readiness disadvantage when the player is at least **one level lower**.

This is stricter than simply comparing global role levels while the opponent may be elsewhere on the map.

Repeated shared fights entered a level down can support coaching to include **level** in the pre-fight readiness check alongside items, gold and local numbers. The recommendation should be to take a nearby XP breakpoint or trade the play when the contest is optional—not to imply every level-down fight must be abandoned.

## Local numbers and fight selection

For each attended multi-kill fight cluster, inspect the local participant count around the first kill event.

Current implementation:
- anchor on the first kill-event position, falling back to the player's timeline position,
- count allied and enemy champions within roughly **4500 world units**,
- classify the fight as locally outnumbered when there are at least **two fewer nearby allies than enemies**,
- preserve the kill score of the resulting cluster and whether the outnumbered cluster ended with more enemy kills.

This is a **fight-context** signal, not proof that the player initiated the fight. The coaching language must therefore focus on the controllable follow/re-enter decision: count who is actually in fight distance and who can arrive next, rather than treating distant allies on the minimap as present.

Aggregate coaching requires repeated samples. A local-numbers concern currently needs at least three outnumbered attended clusters and a high loss rate among them before it becomes a priority finding.

## Fight readiness and purchase state

For each attended multi-kill fight cluster, preserve the player's approximate state at fight start:
- current/unspent gold,
- gold differential versus the direct same-role opponent,
- level differential versus the direct same-role opponent,
- whether the player has completed the first major item,
- whether the opponent has completed the first major item.

Useful readiness flags include:
- **high-unspent start:** at least 1000 current gold at fight start,
- **role-gold deficit start:** at least 600g behind the direct role opponent,
- **major-item disadvantage start:** the direct role opponent has completed the first major item and the player has not.

These flags do not prove the player chose the fight; some contests are forced. Coaching should therefore say the fight **began under a resource disadvantage** and recommend earlier reset/purchase planning, rather than claiming the player mechanically misplayed merely because the fight happened.

Aggregate coaching requires multiple attended fight samples.

## Fight order and carry survival

The timeline analyzer groups nearby champion-kill events into approximate **multi-kill fight clusters** using time and map proximity.

A player's fight is counted only when there is evidence they attended: they contributed to a kill/assist, died in the cluster, or their timeline position is near the fight.

For attended clusters preserve:
- whether the player survived,
- whether they were the first allied death,
- whether they died before a tracked kill/assist contribution.

For ADC/MID/TOP, repeated first-allied-death or pre-contribution-death patterns can be treated as a positioning/entry-timing improvement signal. This is more actionable than total deaths because it asks whether the team's damage source is being removed at the start of a fight.

Do not apply the same negative interpretation mechanically to engage/support roles, where dying first can be role-contextual.

Fight clustering is heuristic rather than ground-truth teamfight labeling. Aggregate coaching therefore requires multiple attended fight samples and should expose the sample count.

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

The session model preserves a separate count of @15-compatible games in each session bucket. A coaching warning requires multiple games on both sides and a material difference, such as about 300g worse gold@15 when that comparison is eligible, +0.5 high-risk deaths/game, or ~120 lower DPM in game 3+.

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

## Root-cause practice-theme synthesis

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

### Root-cause-specific practice targets

When a priority theme has a more specific diagnosed cause, the five-game target should measure that cause rather than a looser neighboring statistic.

Current mappings include:
- post-play give-back theme → high-risk untraded post-impact deaths/game,
- side-lane timing theme → pre-objective side-lane deaths/game,
- objective diagnosis **late reset** → late-reset objective miss rate,
- objective diagnosis **death before contest** → pre-objective death rate,
- objective diagnosis **setup vision** → objective-setup ward share,
- unresolved objective arrival/pathing → prior-frame objective setup rate.

Targets remain self-relative, short-term and sample-gated. The diagnosis selects the measurement; it does not convert an association into causal proof.



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
