# Security archive: verified-empty quarantine contract (DRAFT, not enrolled)

Owner allocation:
- **Chat 2** owns native inference, complete-frame coverage and evidence admission.
- **Chat 3** owns Home Assistant archive presentation, Save/Review UI actions and truthful quarantine badges.
- **C720P infrastructure** owns native archive lifecycle, source-scoped retention,
  quarantine/restore, manifest/audit and the existing Save/Delete backend boundary.

## Current production code: important distinction

The installed `GardenArchiveTriage` may quarantine an older clip after a
model-negative probe with >=20 frames. The existing
`purge-quarantined-empty-clips.py` is a **permanent-delete** tool with an
`--apply` switch, and the corresponding automatic prune timer was confirmed
**disabled** on 24 October. Model-negative/20 sampled frames does **not** prove
a recording to be empty. This release must never relabel that historic triage
as `verified_empty`, nor enable its permanent purge. No new production timer,
task, switch or Android camera APK is installed in this PR.

## Exactly three states

* `person_present`: any confirmed **or credible** person anywhere in the
  full video. Never automatically remove, regardless of later negative passes.
* `verified_empty`: attested source-bound **complete decoding**, every
  decoded frame evaluated, complete timeline/preroll/tail coverage, suitable
  visibility throughout, no model errors/unknown intervals and no positive,
  credible or possible person evidence. Only supported signed models and
  correct source/evidence revisions can produce this state.
* `uncertain_unprocessed`: default, including zero detector hits, fewer than
  all frames examined, <100% timeline, stale/missing metadata, night/occlusion,
  incompatible model, all processing errors and source replacement.

## Chat 2 evidence contract to approve before integration

An authenticated producer must bind canonical source scope `S9_native_microSD`,
source filename/ID, exact SHA-256, content revision and duration, complete
decoding frame count, frame-by-frame evaluation count, time coverage intervals
spanning precisely 0..duration including pre-event/tail, model ID and signed
provenance, immutable evidence revision, and explicit person/possible/conflict
flags. Signed attestation must be independently validated; it is not enough
for a JSON field to claim `verified_empty`. A 3-frame proof can never pass.

A changed source digest, revised analysis or revoked evidence invalidates
eligibility. Videos whose prerecord or tail is stored separately must be
treated as a grouped atomic source with independently covered companions;
the initial conservative policy therefore **refuses separate companions**.

## Chat 3 Save/Delete coordination required

Authoritative protection fields from *every* real source must all explicitly
be false: saved, protected, human person assignment, group filing, evidence
retention, pending export, active/pending review, unresolved processing,
credible person evidence or conflicting analysis. Missing field means
**protected**, not false. The native review writer, Save/Delete backend,
group-filing owner and quarantine mover must share a single transaction /
write exclusion mechanism and monotonically increasing protection revision.
The mover must reread and reverify **inside that same lock immediately
before commit**. A late Save or person decision wins.

No claimed atomic protection exists today across all of these consumers.
An isolated `fcntl` fixture lock is not itself a production cross-phone
transaction. Never enable automatic quarantine without these owners
confirming this shared exclusion protocol and testing it.

## Infrastructure retention contract

Reuse the **existing S9 native archive lifecycle**, not the older permanent
purge utility or an additional competing archiver. Once all acceptance
conditions are met, issue one bounded same-filesystem move from the live
Security4K namespace into a 0700 private SD quarantine with an intent journal
written/fsynced **before** rename and a completion marker afterwards.
Keep the original bytes and SHA-256, evidence/metadata and audit; define
a >=30-day recoverability reserve and explicit source-aware restore.
No Drive replica may be changed or implied deleted. UI hiding does **not**
free space. No permanent automatic erase in the first rollout.

Recovery must handle:
- crash before move (original present + intent),
- crash after move (quarantined original + intent),
- concurrent Save/review (protection takes precedence),
- source digest/revision mismatch (retain),
- duplicate target or inconsistent manifest (fail closed),
- exact-byte restore (independent SHA comparison).

## Prepared files / acceptance

`s9_verified_empty_quarantine_policy_v1.py` provides a strict pure eligibility
function and a **fixture-marker-required**, isolated same-filesystem
quarantine + restore demonstrator. The demonstrator has no production caller
and explicitly refuses ordinary archive paths. It must be ported inside the
native lifecycle after owner agreement, not scheduled on C720P.

`test_s9_verified_empty_quarantine_policy_v1.py` has 26 isolated tests
covering person protection, uncertainty, 3-frame refusal, complete preroll/tail,
low visibility, source replacement, all human protections, concurrent Save,
interruption after the atomic move and restore. All 26 passed in the latest pinned offline host run on 2026-10-24. Fixture moves are bounded to at most 25 clips and 512 MiB. The intent ticket's **directory entry** is fsynced before the original is moved; subsequent rename and restore also fsync both parent directories, preserving intent/quarantine/restore transitions. Symlinked quarantine directories, journals, targets and locks and dangling target names fail closed. These are isolated fixture checks, not proof of a production Android atomic lock.

## Release acceptance sequence (not completed)

1. Chat 2 attests full-video evidence from a supported method without taking
   processing off the authorized phone or relaxing thermal/memory guards.
2. Chat 3 and Save/Delete owner approve the same transaction + visibility
   contract. User confirms >=30-day recoverability policy.
3. Infrastructure merges owner-reviewed implementation into the original
   lifecycle with no parallel purge path. Validate signing, source/revision,
   every protected status and a real atomic Save race.
4. Run only isolated fixture tests, then an independently reviewed **small
   sample of real clips** with truth-backed human review and before/after
   recording health. Do not fabricate classifications.
5. Only after explicit rollout acceptance enable bounded quarantine. Report
   number of actually moved bytes and their source scope; report **zero disk
   space recovered** until real storage is reclaimed independently.

Status 24 October: **source and 20 tests prepared; no production enrollment,
no actual clips quarantined or classified, no storage recovered by hiding.**

## Legacy move interlock in this draft

This PR also inserts a fail-closed native source-only gate immediately before the existing `GardenArchiveTriage` rename. `hasTrustedFullVideoEmptyAttestation` returns **false** until the signed Chat2 coverage and shared Chat3 Save/review transaction verifier are implemented; no JSON flag or sampled-negative result can bypass it. Two additional source-only tests verify the gate occurs before the rename. This source protection is **not deployed to the currently installed Camera2 APK**, and does not establish that the live preexisting native triage has stopped. Do not install/restart Camera2 under this PR.

## Additional crash-safety hardening (2026-10-24)

Journal `atomic_json` now fsyncs its parent directory after the atomic temporary-file rename; fsyncing only the ticket bytes did not make the ticket *name* durable. This fsync completes before moving any source media. The fixture also refuses symlinked or dangling targets and source/restore journal redirection. The initial five new tests verify ordering and fail-closed paths. An additional six verify mandatory nonempty evidence revision/model identity, valid restore schema/state, idempotent restore history, hardlink refusal and isolated fixture directory/marker integrity: **26/26 isolated fixture tests passed** on the C720P using pinned commit `e555b048d86a99eb29ae573b180d963d76fac7eb`. Policy SHA-256 `9bea9164cc5ceaab1b06ad551eeafb4905c49f06ca9e9e03b5aadb42dd60bbac`; test SHA-256 `2441dba904b78fe053d39669edae9c473e594321fde32851fc8049617a051d5c`. No production rollout, real media, signed human decision or live Android camera was accessed by these tests.

## Further evidence/restore fail-closed review (2026-10-24)

An absent evidence revision in both state and evidence previously compared equal (`None == None` in Python); that equality is not an immutable revision guarantee. Eligibility now requires a *present nonempty revision on both sides*, and an approved nonempty string model ID. Fixture source paths with hard links, marker symlinks or a symlinked live directory are refused. Restoration checks the exact fixture ticket schema, source scope, digest, source/evidence revisions, and allowed pre-restore states; a repeated verified restore returns the existing ticket without appending another history event. These checks are complementary to (not replacements for) a real signed attestor, inode-stable original binding or a shared native Save/review concurrency gate.

The initial six-test extension exposed a **test fixture newline escaping error**, corrected before final acceptance. On the pinned final commit `286e5b8e996ae8f6d2466b184e8f11f861de909f`, Python compilation passed and **26 of 26 isolated fixture tests passed** on the owner's C720P in `reports/infra-20261021/offline-quarantine-crash-guard-v3-fixed/`. Policy SHA-256 `aa0c7aa04566db4691d5afd656c745604f54351eda3618794851de6c0bb3bbe9`, test SHA-256 `ae1ce5df4ea018ce2686680fb795f056888ffd86491c33d2b7ce9ff9d123b588`. No production media was opened/moved and no retention timer was enabled.
