# Tune Rush — Audius-only multiplayer music quiz

**Production:** https://kalenel.nl/music/  
**Status:** one music provider, Audius direct HTTPS streaming. Updated 26 October 2026.

## How it works

1. Open the public page on a tablet or laptop. Choose **Create lobby**.
2. Pick a quick mix or customize the genre and optional decade checkboxes; **All eras** clears the year restriction.
3. Use **Check tracks** to estimate the matching, streamable catalog and how many tracks remain unplayed in the host's last three games.
4. Share the six-character room code or invite link. At least one player must join from a separate device.
5. Start the game. The host taps **Play next clue**, then players buzz and submit **song title** and **artist** from their own phones. The host can replay a clue, skip a song, or move to the next song.
6. Each round uses one random cue and hints of **0.5, 1.5, 3, 5, 8, 12, and 20 seconds**. Correct components earn 0.5 points each; incorrect initial components cost 0.5 points, and incorrect steals cost 1 point per field. Scores never fall below zero. The first player to 20 points wins.

### Scan cancellation and room ownership

An Audius catalog scan is bound to its original room session, room code, filter selections, and request generation. Changing a genre/era or leaving the room **aborts outstanding Audius page requests** and invalidates the pending result, even if the user later selects identical filters. A late response can no longer repopulate the next room's reserve or override the current scan's status. **Start game** and **Check tracks** reuse the same in-flight discovery for an identical room and filter combination rather than duplicating network traffic. A pending settings debounce is also cancelled on Leave, preventing old-lobby selections from being sent to a newly created room. Browser acceptance includes held metadata scans and a re-created room, and the tests check that provider HTTP abort signals are propagated.

### Avoid repeats across Audius re-uploads and filter changes

A provider track ID alone is not a reliable song identity: the same artist and title may be uploaded more than once or appear under different genres. When selecting a new round, Tune Rush groups Audius records by normalized **artist + song title**, counts only one representative per group, and excludes compositions already heard during the current/previous two games. The host reserve counts distinct compositions rather than raw upload IDs and recognizes previously heard songs even when their upload IDs change. Versions with meaningfully different titles (such as an explicit "Live" or "Remix" label) remain separate. History stores only valid provider IDs and one-way 16-character song fingerprints, **not** titles, artist names, audio or stream URLs. Older ID-only browser histories are still accepted, although uploads outside the current catalog cannot be retroactively matched until their metadata has been encountered.

### Soundtrack reserve — track coverage for three games

After **Check tracks**, the host now sees a live four-stat Audius reserve display: distinct matching tracks, already heard *within this filtered mix*, fresh tracks still available, and the number of roughly 40-song games that those fresh tracks could cover (capped at three). The progress gauge shows fresh songs toward the **120-track planning goal**. Selecting new genres/eras hides the stale estimate until a fresh scan finishes. The **Broaden to all genres & eras** action updates the filters and checks the wider Audius sample if the current mix is short. Once the game starts, the host's active player card shows the remaining fresh tracks after each accepted round. No track names, answers, music data or session history are sent to guests; the estimate uses existing browser-local Audius IDs. Counts are a *planning estimate*, not guaranteed playability; incomplete provider scans are clearly marked.

### Host audio mixer

The tablet/host view has a **Master output** fader (0–100%) and an accessible **Mute / Unmute** toggle in both the lobby and active-song player. Both faders control the same browser audio element without changing the room, song, cue, hints, scores or player sessions. Settings are saved under the browser-only preference key `tune-rush-host-output-v1` (volume percentage and muted flag only), so a host reload restores the output level. It does not store music files, stream URLs, answer data, or additional room credentials. The short **Test speakers** tone honors mute and mixer volume; it will not play while the mixer is muted or set to zero. Mobile Safari and some other devices can restrict programmatic volume adjustment, so users may still need hardware volume keys or Bluetooth/speaker output settings. The mixer controls are host-only and never appear on guest phones.

### No-spoiler music preview guard

An Audius track that actually starts playing in the host's lobby is automatically removed from **that room's eligible quiz songs**, including other Audius uploads with the same artist/title fingerprint. Simply choosing a sample without hearing it, or receiving a failed play response, does not exclude it. The soundtrack reserve recalculates immediately and the host lobby shows how many compositions were **heard** or **manually rejected**. These are separate from the regular three-game no-repeat history: previews never gain points or count as a completed round. A room-scoped `sessionStorage` checkpoint keeps only the room code and anonymous `song:<16-hex>` or `id:<provider-id>` identities so a host-tab refresh cannot accidentally reintroduce a spoiler. Neither music bytes, track titles nor artist names are saved in this checkpoint. Leaving the room destroys that checkpoint and both exclusion lists, while changing genres retains exclusions within the same room. The browser multiplayer acceptance tests the actual separate audio element, the live reserve reduction, an accepted round using a **different** composition, and host refresh/Leave handling.

### Revealed song recap and party setlist

After the game server changes a song's phase to **solved** or **finished**, both host and guest devices display a large public round recap with the title, artist and number of clue snippets reached. Each browser tab also accumulates a collapsible **Party Setlist** of songs that were genuinely revealed during that room; the list remains readable during later mystery rounds without revealing the current song. It shows round numbers in chronological order, includes a **Copy revealed songs** action with a manual clipboard fallback, and is restored after a same-tab reload using a bounded (60-song), room-scoped `sessionStorage` checkpoint. No tokens, private guesses, unrevealed tracks, raw music bytes or provider secrets are saved, and the checkpoint is cleared on Leave or when starting a fresh party. Joining mid-game may produce a partial setlist because each device only remembers revealed songs it has actually received. Repeated 550 ms polls cannot duplicate entries, and browser text is inserted via `textContent` rather than untrusted markup. The current song is **never** added to the list while playing, answering, or in a partial-reveal steal window. Automated unit and real tablet/two-phone browser acceptance test privacy, chronological history, copy, host reload, no-repeat continuity, and room cleanup. No game protocol or database changes.

### Complete final party recap

The final encore now adds **Copy party recap** beside the existing final-score and revealed-setlist copy controls. The combined plain-text recap includes the server-confirmed winner, ordered final standings, and numbered songs that this **same browser tab** previously saw the server reveal, with a clue count per song. If no revealed songs were saved, the recap clearly says so. A privacy note explains that late joiners, tab resets, and the 60-song history limit can leave out older songs; it never claims to reconstruct a complete server-side archive. It contains no room join code, access token, stream URL, raw audio, private answers or playing/partially revealed mystery songs. A mismatched room gets no song history. Clipboard failures fall back to a manual copy dialog, and changing rooms while sharing cannot update the new room's status. All game logic, Supabase operations, Audius playback, scores and network polling remain unchanged. Browser acceptance covers the composite copy, per-tab scope, no-spoiler output, manual fallback and new-party reset.

### Night highlights and offline party recap file

The **Final Encore** now displays three responsive stats for the songs revealed **to the current tab**: songs saved, average clue count, and fewest clues. Average and fewest ignore zero-clue reveals and use a dash when no measured clue count exists; skips are not misrepresented as fast guesses. These numbers do **not** claim to represent unseen rounds, other participants' tabs or the full server history. A **Save recap as .txt** action makes a local UTF-8 text file (with a Windows-readable BOM), containing the same confirmed final standings and same-room revealed songs as **Copy party recap**. The export is constructed entirely in memory in the browser, with no cloud storage or extra calls, no room codes, tokens, private guesses, unrevealed answers or music bytes. It uses a date-only filename instead of a room identifier; failure tells the player to use the copy action. GitHub's real tablet/two-phone browser acceptance tests the actual file bytes and name, known clue counts, unknown values and cross-room cleanup. No backend, Audius stream or scoring changes.

### Shareable final-night poster (PNG)

The **Final Encore** now has a collapsible, dark-gradient poster preview and **Download poster PNG** action. The locally generated 1080 × 1350 canvas image is optimized for sharing after a game: it features the winner, up to five ranked players, and the most recent seven songs **already revealed in that same browser tab**. It visibly labels the song list as tab-scoped and notes that unseen or older rounds may be absent. Extra-player and extra-song counts are disclosed rather than silently implying a complete listing. No provider assets, external fonts, remote rendering, database calls, uploads, saved raw audio, private guesses, hidden mystery song data, room invite codes, or access tokens go into the preview or exported file. Rendering uses the Canvas 2D API with bounded text content rather than injecting untrusted markup. The PNG filename contains only the calendar date. Browser fallback leaves existing text exports usable, and a delayed image encoding callback fails closed if the room changes. Automated three-device browser acceptance checks a genuine PNG byte signature and dimensions, output drawing boundaries, positive same-room revealed songs, empty cross-room history, and zero JavaScript page errors.

### Shared leaderboard momentum

The **public scoreboard** now ranks participants by their actual current score, handles ties with the same rank, and shows a compact green `+0.5` or amber `-1.0` change beside the affected player's total. An accessible status line announces the latest public point movement on the host tablet and guest phones. These numbers are derived exclusively by comparing **consecutive authenticated server snapshots for the same room and song**; refreshing a page or joining mid-round cannot invent a score change. Identical backend polls do not replay the change, and new rounds, different rooms and Leave clear the per-song indicators. An incorrect guess whose score is already clamped at zero creates **no fabricated deduction**. Neither the score badges nor the message contain a guessed title, artist, hidden answer, host token or private receipt; the submitting player's separate answer receipt remains private. No database writes, score calculations, music changes or additional network requests are involved. Real tablet/two-phone acceptance checks unchanged zero-clamped scores and locally simulates signed score snapshots for the public ranking and tie UI, without modifying real players' database scores.

### Personal answer results

When a phone player submits an artist/title answer or steal, Tune Rush now displays a **private result receipt** under that player's buzzer. It compares the server-confirmed player score and public per-field accepted flags from immediately before and after the exact answer RPC. The card shows the earned or deducted **net score delta** and whether the submitted title and artist were accepted, not accepted, or left blank. The calculation handles scores clamped at zero, so a rejected answer at zero is reported as **no net score change** rather than inventing a penalty that never occurred. The receipt contains no hidden answer, artist text, host credentials, or guesses. It never modifies scoring or emits extra requests; the game server remains authoritative. A room/round mismatch, failed RPC, missing player, or unconfirmed state produces **no fabricated receipt**. Results stay in the submitting player's phone view until the next song or leaving the party. The host and other guests cannot see the personal card. Unit and real hosted three-device browser tests cover positive, partial, negative, zero-clamped, and cross-room protection.

### Phone buzzer feedback and optional haptics

Players now see a live, high-contrast **Buzzer open / You won the buzz / Buzzer claimed / Steal available / Waiting for next clue** status in the phone game view. These statuses derive entirely from the authenticated room phase, player identity, blocked-step and locked player, not from a guessed local race winner. During another person's answer, their public player name is shown without revealing their guesses or song metadata. A visible **Vibrate when you win the buzzer or a steal opens** checkbox is **off by default** and saved only in the individual phone browser's localStorage; no phone permissions, account, server writes or additional network polling are required. On browsers that support `navigator.vibrate`, successful buzzer ownership and newly available steal windows trigger short distinct patterns. Repeated 550 ms state polls, a different player's winning claim, inactive tabs, and host views do not vibrate. iOS and other browsers without the API show an explicit unsupported message and retain complete visual feedback. All game authority, scores, deadlines and privacy boundaries remain on the server. Unit tests and real tablet/two-phone browser acceptance verify alert patterns, one-time transitions, other-player claims, and no guest-only controls on the host.

### Phone-player answer clock

When a guest wins the buzzer or an authorized steal, the answer dialog displays an accessible progress bar, seconds remaining, and clear colors for **10 seconds** and **5 seconds**. The timer is derived from the authenticated room state's absolute `answerExpiresAt` timestamp and repaints every 250 ms without making extra network calls. If the server timestamp is absent, the UI says the deadline is unavailable rather than inventing one. At zero, it says **waiting for server confirmation**: the countdown does not score, reject, submit, forfeit, or close an answer locally. Only the authoritative backend resolves whether a response arrived before its deadline. No live announcement is emitted every second; a progressbar exposes estimated seconds for assistive technology, while the answer inputs remain focused. Other players cannot see the private answer form. CI verifies server-driven warning states, no client mutations, and correct visuals in a real phone browser session.

### New Party and final score sharing

When a game finishes, the host sees **Host a new party** and everyone sees **Copy final scores**. Copying produces a plain-text score summary ranked by score and winner, without room credentials, hidden answers, or stream URLs; browsers without clipboard access provide a manual copy prompt. **Host a new party** creates a new random six-character room code through the existing authorized `create` operation, switches the host to its fresh lobby only after creation succeeds, and restores the previous **genre and decade** choices via the existing server-side `settings` operation. A new QR and invite link appear automatically. Participants **must scan the new QR or enter the new code again** because this is a new game and player capabilities are intentionally not transferable. The old finished room and its scores are not deleted; if the creation request fails, the final results stay on screen for retry. A failed settings save is displayed explicitly rather than pretending the previous mix was restored. One-click concurrency and previous-room replies are fenced against stale responses. This is deliberately not a same-room rematch because the live database protocol has no such operation; implementing same-room score reset would require a separately reviewed, tested backend schema/function change.

### Silent-clue rescue without scoring or skipping

If an Audius clue starts in the shared game but the host hears nothing (Bluetooth disconnected, stream buffering or audio output interrupted), a host-only **Pause & retry** control is available while that clue is active and no player has answered it. The control immediately pauses the local media element and asks the existing game backend to pause the **same** round/step. Only an authoritative matching server response marks the snippet as paused and safe to replay; the next Play button uses the existing **replay** mutation, not a new clue, and does not alter points, answers, the selected song, or the three-game rotation. If the pause request fails or the room changes, the host receives an explicit uncertain-state status and the client refreshes authoritative state rather than claiming success. The control disappears once an answer/steal is in progress, does not exist for guests, is single-flight, and ignores late responses after Leave. Node VM regressions and a real three-device browser test cover a server-started silent clue, same-step pause/replay, unchanged score/source, and late-response isolation.

### Host live music audition and party veto

In the host lobby, **Check tracks** unlocks a real Audius soundcheck. **Find a sample** chooses a fresh song matching the genre/era filters; **Hear 8 seconds** streams the actual Audius audio through a separate, volume-controlled host player. **Another song** cycles without repeating auditioned IDs until the preview pool runs out; **Stop** pauses immediately. The host can choose **Not for this party** to veto the composition across re-uploads for the current room, reducing the playable reserve without falsely marking the track as played. These previews never call the room RPC, alter points, start a round or store downloaded audio. A Start, filter change, phase transition or Leave stops the audition and cancels its timer; Leave also clears the session-only veto list. The host can hear the real selected samples (with their metadata); guests cannot view or access these controls. If the host device or browser blocks real Audius audio, the player gives an actionable error rather than silently claiming success. The sample tests use deterministic audio fixtures, while separately obtained Audius HTTPS streams have been verified as MP3 without saving audio files.

### Expanded familiar-music discovery

Audius music searches now combine **three trending pages per selected genre** with **popular** and **cover** search results. Playback remains Audius-only and streamed directly to the host: there is no Spotify, Deezer, YouTube, iTunes, local-file storage, or user upload route. The randomized fresh-song chooser gives tracks with more actual Audius listens a moderate weighting while preserving composition-level no-repeats over three games. Genre and decade filters are still enforced using Audius release metadata, so new covers of older songs do **not** become 1980s or 1990s originals, and the catalog does not guarantee recognizable historical hits. Scans have a bounded 35-second deadline, up to three workers and cancellable requests; partial coverage remains clearly labeled.

### QR invitations, game-master stages and winner podium

The host lobby displays a large scannable QR that encodes only the public `https://kalenel.nl/music/?room=XXXXXX` join URL. Players scan it and enter their nickname in the guest view. The QR is generated *entirely in the host browser* from a locally vendored MIT-licensed QR generator (`vendor/qrcode.js`; license in `vendor/LICENSE-qrcode.txt`), without sending room codes or host access tokens to an external QR provider. The host's active game panel displays a room/round state ribbon for ready, playing, answering, steal, revealed and finished; the final screen ranks all participants by score and highlights the winning player.

### What has been independently tested

The project browser acceptance uses a real game database and **three independent browser devices** (one emulated tablet host and two emulated phones), with fixture-backed audio so it can deterministically verify round progress, live buzzing/guessing, recovery, host privileges, song history and join URLs. This establishes application behavior, not physical speaker audibility. A separate owner-device read-only provider check has returned real Audius catalog JSON and an HTTPS stream with `audio/mpeg`, and `ffprobe` confirmed a playable MP3 duration. Real-world familiarity and speaker loudness cannot be guaranteed by metadata or automated browser emulation.

### Supported music

Audius is the **only music source in the current frontend**. The browser discovers tracks at `https://api.audius.co/v1/tracks/trending`, checks each provider's streamability metadata, and streams selected music from `https://api.audius.co/v1/tracks/{id}/stream` with a native `HTMLAudioElement`. No backend downloader, USB music library, YouTube iframe, Deezer resolver, Spotify token or imported host-file music is used.

Discovery uses at most **three parallel provider requests**, covers up to three trending pages per mapped genre and has a **26-second overall time budget**. The host sees how many pages have been checked and the distinct streamable track count. If one genre fails, tracks from working genres remain usable, but the availability estimate is clearly marked **partial**; if all provider requests fail, the search reports a connection error rather than claiming the catalog is empty. Starting a game does not use results from a genre/era selection changed during the scan.

The catalog emphasizes independent artists, remixes and newer releases. **Audius release metadata is not a guarantee of a track's original release decade.** Some selected genres and eras can yield too few tracks. Playback and licensing remain subject to the provider's artist permissions and applicable event rights.

Streaming is initiated by a host button, never background-autoplayed. A clue does not start counting until the browser's playback clock actually advances **after the remote seek completes**; stale positions from a previous clue or sudden jumps past the clue are rejected, and the host can retry. Guests receive no secret title, artist, stream URL or cue position before reveal. A host-only **Test speakers** control in the lobby and on the player creates two short, low-volume Web Audio tones. It does not fetch music, reveal an answer, or modify the Audius stream; actual audibility depends on the tablet's system volume, mute and Bluetooth output.

**Host page refresh recovery:** the current stream's Audius ID, transient server audio index, room/round and host-only song metadata are stored in the host tab's `sessionStorage` after the server accepts Start/Next, and expire after eight hours. Refreshing **that same tab** reopens the same provider stream after checking the authenticated room, round and audio-source index. Playback is never restarted without a user click. If the tab is gone, private session storage is unavailable, or the stream cannot load, the host can skip/reveal and advance. Guests never receive or read this checkpoint. A filter change during discovery invalidates earlier results rather than displaying or selecting songs from a stale mix.

### Starting and advancing rounds safely

The host cannot launch overlapping **Start game** or **Next song** operations: the controls stay locked throughout the Audius catalog check, candidate stream loading and authoritative server update. Ordinary room polling pauses while selecting the new stream so an old-round refresh cannot accidentally restore the previous song over the candidate. If the server accepts a song but its HTTP acknowledgment is lost, Tune Rush checks the authenticated room again, keeps the matching prepared stream, and records it for three-game rotation and tab-reload recovery. Stale action responses from a room the host has left are ignored.

### Cancelling obsolete Audius media loads

If a host leaves or changes rooms while Audius metadata is still loading, Tune Rush immediately cancels the outstanding media listener and timeout. A delayed browser `loadedmetadata` or `error` event cannot satisfy a newer song's request. The provider module import is checked against the current host session *before* touching the shared audio element; round selection and host-tab recovery carry the same session validity check. No media data is downloaded or stored, and no database migration is needed.

### Late playback responses cannot restore departed rooms

The host now associates Play, Pause and background-tab pause responses with the originating room session, round, media-source identity and operation version. A delayed response from an old room or an already-superseded clue is ignored, rather than redrawing a game after Leave or interrupting a newer track. Host tab stream recovery is similarly checked before a failed/abandoned restore is allowed to clear the audio element. These safeguards are client-side; no changes to the database protocol or scoring rules are needed.

### Reconnecting without losing the game

The host and player views keep the **last authoritative room state** visible during a temporary connection failure, displaying a clear reconnect notice instead of pretending scores and buzzers are up to date. State polling backs off to a maximum of 16 seconds on repeated failures; reconnecting or tapping **Retry now** requests a fresh authenticated state. A successful refresh hides the notice without clearing the room, replaying music or resetting points. A response from a previous room is ignored if the participant has since left or switched rooms. These retries do not create new song downloads or store extra user data.

### Multiplayer backend and compatibility

The existing Supabase `musicquiz_v1` RPC remains responsible for capabilities, rooms, buzzer locking, scoring, steal windows, replay, and rounds. Its validated `local` mode transports the **host-only Audius track metadata and transient index** for compatibility. This is a database protocol detail, not an exposed local-file playback path. Do not remove or rename the RPC mode without a separately tested database migration.

The host keeps a limited list of prior Audius IDs in localStorage to reduce repeats across its three latest games; audio bytes are not persisted by Tune Rush. The player does not need to register.

### Current frontend

- `music/index.html`: host/guest lobby, genre/decade filters, responsive player and scoreboard.
- `music/style.css`: midnight-radio presentation; responsive tablet and phone layout.
- `music/app.js`: room RPC, player state, UI, and Audius-only host playback.
- `music/audius-stream.js`: Audius discovery, normalization, playable-stream URLs, genre and era filters.
- `music/game-rotation.js`: Audius selection history and repeat avoidance.

### Verification

- `scripts/test-tune-rush-playback.mjs`: source isolation, host stream clock, stalled seek, replay safety.
- `scripts/test-audius-stream.mjs` and `music/tests/audius-rotation.test.mjs`: provider normalization, filter and rotation fixtures.
- `scripts/test-three-game-rotation.mjs`: three-game, 120-song no-repeat planning.
- `scripts/tune-rush-browser-acceptance.mjs`: real Chromium host + phone, live RPC, fixture-backed HTTPS media, leak and mobile overflow checks.
- `scripts/tune-rush-smoke.mjs` and `scripts/test-tune-rush-replay-db.mjs`: live room interactions and isolated replay SQL checks.
- `.github/workflows/tune-rush-browser-acceptance.yml`, `tune-rush-smoke.yml`, and `tunerush-audius-test.yml` run these checks for changes.

Automated fixture-backed playback is not a substitute for verifying physical tablet speakers and local mobile browser audio policy. A separate live Chromium test on the hub previously verified actual nonzero decoded Audius PCM samples.

### Retired paths

Demo synthesized music, local-host imported audio, YouTube manual links, YouTube auto-catalog refresh, and Deezer previews have been **retired from the current frontend**. Legacy assets and now-obsolete scheduled workflows were removed from active repository paths. Historic server migrations and database compatibility behavior are intentionally preserved for safe rollback and past-session integrity.

### Deployment and rollback

GitHub Pages publishes from `main:/music`. Use a new JS/CSS cache-busting query version for each frontend release. Gate merges on GitHub Actions, including a browser test using the PR's served candidate site, then check the public URL for newly published asset versions. To roll back, revert the last Tune Rush frontend commit; the existing database schema need not change. Avoid modifying unrelated routes, Home Assistant services or S9+ security operations.
