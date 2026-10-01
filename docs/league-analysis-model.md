# Bruisienator web analysis model

This file is the behavioral-analysis contract for `kalenel.nl/league`.

The purpose of the web analyzer is not to produce a decorative stat page. It should identify repeatable player decisions, show the evidence behind a judgment, compare the player with relevant peers and with their own broader history, and turn those findings into specific actions to practise.

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

During Fetch / update, the newest 20 games may cache the current rank of the actual same-role opponent.

Rank ordering is used only to classify whether that direct opponent is above the player's current rank. The report can then summarize the subset of actual higher-ranked peers:
- average gold differential at 15,
- percentage of those games where the player is ahead on gold at 15,
- average DPM delta.

This is preferable to inventing a static "rank above" benchmark table.

Rank is a snapshot and can change after the match; present this comparison as the opponent rank observed at fetch time.

## Lead preservation from 15 to 25

Where a real timeline frame exists near 25 minutes, preserve the same-role opponent comparison at 25 as well as 10/15.

Use the change in direct-role gold differential from 15→25 to answer a different question from lane performance:

**Did the player preserve/extend the advantage after lane, or surrender it during the first rotations?**

Current aggregate coaching requires multiple comparable games. A repeated drop of roughly 500g or more from a positive 15-minute state is treated as a lead-preservation concern; a repeated positive swing can be highlighted as strong mid-game conversion/recovery.

Do not manufacture a 25-minute value for games that ended before an appropriate 25-minute timeline frame. Missing remains unknown.

## Lane-lead conversion and recovery

A working sample classification is:
- lane/economy lead: at least **+250 gold at 15** versus the same-role opponent,
- lane/economy deficit: at most **-250 gold at 15**.

The analyzer can compare:
- win rate when the player has a lead,
- win rate when the player has a deficit.

This is descriptive. Do not claim the gold state alone caused the win or loss.

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

### Spatial clustering of high-risk deaths

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

This is intentionally coarse. It is not a substitute for the future real-map renderer.

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

## Objective context

Tracked objective events include supported elite-monster/building events from the Riot timeline.

For team objective presence:
- count each tracked team objective event once,
- inspect the player's timeline position at the event,
- consider them present when within the configured action radius.

Do not invent a gold value for dragons, Baron, Herald, towers or plates.

Objective-death percentage describes how often player deaths occur in objective context; it does not mean those deaths were necessarily wrong.

## First meaningful map impact

For each timeline-complete match, track the earliest supported meaningful impact for both the player and the actual same-role opponent.

Supported first-impact events are:
- champion kill or assist,
- proximity to a tracked team objective event.

The comparison is stored as:

`player first impact minute - same-role opponent first impact minute`

So:
- negative = player impacts first,
- positive = opponent impacts first.

Aggregate coaching is currently restricted to roles where early map influence is a particularly useful decision signal (JUNGLE, SUPPORT, MID) and requires multiple comparable games.

This is not a mechanical instruction to roam earlier. The coaching should point back to the decision window—lane priority, pathing, recall timing, or river setup—because sacrificing a high-value wave for an earlier timestamp can still be a bad play.

## Early involvement

Early KP uses the player's kill/assist participation in the team's champion kills through approximately 14 minutes.

When wins and losses have enough valid samples, the analyzer may report an association such as:
"early involvement is higher in wins."

Use **associated with**, not causal wording.

## Roaming

Roaming is not "a kill outside lane."

For non-jungle lane roles on Summoner's Rift:
- analyze roughly the 3–20 minute window,
- determine the normalized role's home lane,
- use timeline movement samples to detect a sustained departure from home lane into another meaningful zone,
- ignore base movement and ordinary home-lane activity.

Outcomes:
- kill/assist or team objective during the detected departure → success,
- player death during the departure with no successful event → failure,
- otherwise neutral.

For SUPPORT, also inspect the change in allied ADC versus enemy ADC CS differential during the roam. A roam that gives no kill/assist/objective return and costs the ADC substantial lane CS can be highlighted as expensive.

### Roam lane cost

For lane roles with a valid same-role opponent, measure direct-role CS differential at roam departure and return:

`(player CS - peer CS at return) - (player CS - peer CS at departure)`

Negative means the direct opponent gained CS advantage while the player was away.

Current coaching treats a loss of roughly 6 or more CS as materially costly. A roam with no kill/assist/objective return plus that lane loss is a strong improvement signal. A roam can still be described as economically expensive even if it produced a kill; do not equate "successful event" with "good roam."

The action should focus on wave preparation and abort timing, not simply "roam less."

These are movement-based heuristics, not perfect ground truth. Use medium confidence unless supported by a larger sample.

## Resets, shop visits and item timing

Riot timeline item purchases are grouped into approximate shop visits.

The current major-item comparison:
- identifies a meaningful completed item from current Data Dragon item data,
- excludes boots, consumables and trinkets,
- compares the first major completion with the actual same-role opponent.

This is a practical replacement for the old "Mythic timing" idea until a more exact gold-threshold + recall reconstruction is restored.

### Greedy-stay candidate

During roughly 6–22 minutes, a timeline state can be flagged when:
- current gold is at least 1200,
- player is not in base,
- next detected shop visit is more than two minutes away.

This is a **candidate high-gold stay window**, not proof the player should have recalled immediately. Coaching should combine it with objective/death context rather than overstate it.

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
- gold differential at 15,
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
- gold differential at 15,
- flagged high-risk deaths,
- DPM,
- CS/min.

A coaching warning requires multiple games on both sides and a material difference, such as about 300g worse gold@15, +0.5 high-risk deaths/game, or ~120 lower DPM in game 3+.

### Quick requeue comparison

A quick requeue is defined as the next analyzed game starting within 45 minutes after the previous game ended.

When enough examples exist, compare quick requeues after a loss with quick requeues after a win using the same behavior metrics.

The report must describe this as an **observed requeue pattern**. Do not label the player as tilted, fatigued, angry, unfocused, or otherwise infer a mental state from the data.

If the post-loss pattern is materially weaker, the recommended intervention can be behavioral and concrete: brief review, stand up, then make an intentional decision about whether to queue again.

## Short-term direction inside the Last 20

When the sample is large enough, compare the newest five games with the preceding games in the Last-20 sample.

Current trend dimensions include:
- CS/min,
- gold differential at 15,
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

Do not reuse the old historical 0–15000 square heatmap as the final map implementation. The final renderer needs:
- real map background,
- map-specific world bounds,
- one shared world→image transform,
- correct `mapId` at every call site,
- explicit unavailable state when coordinates/background metadata are missing.

## Not yet restored

Do not invent:
- DQI formula,
- AGOR formula,
- a fake static rank-above item benchmark,
- exact recall channel start/end when Riot timeline evidence does not supply it,
- causality from simple win/loss correlations.

These should remain visibly unavailable until supported by recovered code or stronger data.
