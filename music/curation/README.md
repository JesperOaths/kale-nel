# Tune Rush — Recognizable Hits Replacement Pack (200)

**Status:** proposed song metadata, not downloaded, not installed on the S21, and not yet created inside Spotify.

Reviewed the actual S21 database on 16 November 2026. There are 1,000 main and 250 expansion catalog entries, 1,225 with an audio fingerprint and 1,219 unique referenced recordings. The 25 expansion rows without audio cannot currently be played. No recording has been deleted or changed.

## Deliverables

- `replacement-playlist-200.csv`: 200 replacement hits, with chart rank and Spotify search URL (no unverified track URIs).
- `spotify-import-200.csv`: simple title/artist list for a music-library or playlist importer. Verify exact original studio versions after import.
- `replacement-playlist-200.txt`: readable playlist.
- `proposed-removals-190.csv`: conservative 190 old-to-new pairings: 105 expansion, 85 main. There are **10 additional replacement songs** kept as reserves.

## Method

Matched all 1,250 existing entries against global Spotify streaming rankings and the Netherlands NPO Radio 2 Top 2000 of 2025. No match means **not found by this matching procedure**, not proof of obscurity. Alternative spellings, collaborations, remixes and reissues can produce false negatives. Shortlisted 190 weaker or specialist tracks for review, and protected obvious singalong and classic hits from automatic removal.

The 200 incoming songs span 125 global mainstream hits, 45 Dutch/singalong favorites and 30 retro classics. Their streaming or chart presence is objective evidence of popularity; recognizeability still depends on the players' ages and tastes. Prefer original-artists studio recordings, not covers, live versions, sped-up edits or karaoke.

## Safeguards

- The S21 audio cache and game catalog are unchanged.
- No Spotify API playlist has been created; use the import CSV or connect a playlist-writing integration.
- The original catalog's identifiers and audio fingerprints remain in the private C720P audit folder, not in this public export.
- Check the replacement recording is present and playable **before** excluding any old catalog entry. Keep the original MP3 archive as a rollback until the new recordings are verified.

## Reference sources

- Global ranking: https://kworb.net/spotify/songs.html (retrieved 16 November 2026)
- Netherlands 2025 Top 2000: https://www.nporadio2.nl/top2000
