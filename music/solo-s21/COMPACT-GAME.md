# Tune Rush: compact play and scoring v2

New hosted games explicitly request `rulesVersion: 2`. Existing saved games
and clients retain the original seven-fragment rules and scoring. The S21
remains authoritative for song selection, audio clipping, guesses and points.

| Rule | Points |
| --- | ---: |
| Correct title | +5 |
| Correct artist | +5 |
| Title solved using the 0.5-second fragment | +2 |
| Each extra fragment tier | -0.25 |
| Each distinct wrong title or artist entry | -0.25 |
| Repeat playback or an already checked entry | 0 |

Fragments are 0.5, 1, 1.5, 3, 5, 8, 12 and 20 seconds. Skipping directly to
a longer tier applies the same modest deduction as reaching that tier in
steps. Each round has a zero-point floor; a later round cannot deduct points
earned in a previous one. Title and artist awards are independent. Correct
parts remain solved, and further attempts are allowed on every fragment,
including the final one. A complete answer reveals the track automatically.

The phone stores the full attempt transcript and an integer quarter-point
ledger. The public response includes recent attempts within the existing
relay metadata limit. The controller retains previously seen attempts in
tab-local session storage, merges authoritative updates and labels truncated
history after a fresh tab. Finished recaps show title, artist, bonus, hint and
miss totals per track, plus any adjustment imposed by the zero-point floor.

The waveform uses Web Audio to decode the MP3 fragment already provided for
playback. Per-channel sample peaks are measured after the decoder preroll and
over the actual playable duration. There are no random or decorative peaks.
Canvas progress follows the media element's playback time. Audio selection,
clipping and score calculation stay on the S21.

Actions carry unique identifiers. The phone persists recent identifiers and
returns state for repeat deliveries without applying the mutation again.
Answer responses omit MP3 data; controllers retain the current bounded clue
until the round or fragment changes. This satisfies the existing relay's
separate metadata and media response limits.

The desktop layout uses one viewport for setup, play and the final recap.
Long attempt lists and recaps scroll inside their panels. The outer music
page hides duplicate navigation while the solo iframe is active. Narrow
mobile layouts stack the panels for readable controls.

Validation performed in staging: 14 scoring tests, 46 legacy HTTP assertions,
eight MP3 durations with metadata/privacy and unchanged-library checks,
duplicate action delivery, partial answers, repeat attempts, score recaps,
signal-envelope tests and a DOM interaction smoke test using real engine
response snapshots. A public browser acceptance test follows phone deployment.

## Release order

1. Back up only `server.py` and `permanent_audio.py` on the S21, then install
   these two files and the new `game_rules.py`. Keep the permanent music store
   and saved game data intact.
2. Restart only the engine through its existing native Termux watchdog.
3. Confirm local health reports `rulesVersion: 2`. Complete a disposable v2
   game, verify the 1-second fragment and repeated guesses, and check the
   permanent library counts before publishing the matching frontend.
4. Publish the hosted frontend and verify the public play flow.

The archive builder includes `game_rules.py`. Rolling the two replaced files
back restores the old engine; the new module may remain unused. Keep any
test session finished before rollback. No recording or library file needs to
be deleted or replaced.
