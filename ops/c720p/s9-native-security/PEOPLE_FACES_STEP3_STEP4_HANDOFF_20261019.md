# People & Faces — Step 3 closeout and Step 4 preparation (19 Oct 2026)

This is the four-stage **People & Faces UI and manual-review** plan, not the unrelated
database/firewall hardening roadmap, nor authorization to enable biometric
identification. **There is no Step 5 in this four-stage UI scope.**

## Step 3 — folder-first recording assignment and review UI

**Production UI deployed and read-only browser-verified:**

- PR #770 guarded frontend-only deployment, source pin
  `4c1024582fa418256ce34bbcaabeaad868c12cbf`, C720P job **11545**:
  installation, transactional backup and Home Assistant HTTP hash readback passed.
- Live isolated Chromium acceptance, PR #771, job **11546**: six saved
  people, 100/150/200 review page options; 249 unassigned originals including
  94 historic Google Drive recordings; 200-card page containing 155 SD and
  45 Drive originals. The Google Drive original's in-player filing dialog
  opened with an accessible person selector and unobstructed action footer.
  Archive opened with S9+ selected by default.
- Before/after 175 indexed S9+ original clips were preserved by the deployment
  checks; it reported no video, camera or historical approval mutations.
- Source regression tests exercise assign → refresh → return to review →
  reassign, stale-revision 409 conflict, after-save GET outage, and identical
  filenames from both SD and Drive. Do not misrepresent synthetic commits as
  having been carried out on real people or production review history.

**Step 3 boundary:** UI release/visual acceptance is complete. A genuine
production assignment/undo test is intentionally *not* performed merely
to generate a success metric: creating or altering a real person's review
history without verifying the clip's contents is not acceptable. The first
authorized real review can serve as a non-destructive operational check
provided the user intentionally files that clip and the normal audit trail
is retained. No production assignment is necessary for read-only graduation.

## Step 4 — saved-person detail view and linked evidence

Source prepared on PR #777 stacked into draft PR #766:

- Open a saved person with *all presently verified source-qualified recording
  links*, including manually assigned S9+ and historical Drive originals;
  derive counts and folder default tab from the authoritative SD/Drive
  assignment index, not stale legacy folder totals.
- Link face crops *only* to original S9+ recordings actually assigned to
  the current person. Do not substitute the crop of a same-name Drive file,
  a different person's recording, or an automatically inferred identity.
- Allow explicit cover-photo selection from credible, manually filed SD
  face evidence. Return/move a recording invalidates stale face thumbnails
  and cover choices in the old person folder.
- Keep unverified scenery/context crops excluded from portrait selection,
  mark all face crops as candidates, and offer the exact original 4K
  recording for human assessment. Historical Drive thumbnails remain scene
  previews until source-verified face evidence exists.
- Regression fixture specifically demonstrates manual SD filing and face
  evidence becoming visible under the chosen person, then disappearing after
  the clip is returned to the queue. Existing mixed-source regression remains
  required.

### Release gates before calling Step 4 deployed

1. Merge the tested, scoped PR #777 into PR #766 only after all CI checks.
   Do not merge PR #766's unfinished Android/ML changes into main.
2. Use a new immutable source pin, guarded dry-run, transactional UI-only
   deployment, HA hash readback, SD originals preserved, and rollback.
3. Run a *read-only* authenticated real-browser acceptance: open each saved
   folder, compare shown SD + Drive recordings with authoritative link totals,
   verify source-specific face crop loading and fallback to original video,
   confirm cover after returning an eligible clip using **synthetic regression
   fixtures** rather than changing a stranger's real review decision.
4. Do not activate automatic facial identity matching or migrate original
   media. S9+ facial-comparison model release has a separate, stricter
   consent, quality, security and human-review acceptance plan.

No Step 5 is part of this specific four-step People & Faces interface roadmap.
