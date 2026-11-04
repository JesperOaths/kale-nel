# Tune Rush S21: Permanent 20 GiB Game Music Library

## Architecture
The game song library is persistent, independent of game sessions. It is located in
the S21 Termux private data directory:

    ~/.tunerush-solo/music-library-v1/

- Limit: 20 GiB of audio bytes; maintain at least 5 GiB free on the phone.
- SHA-256 content-addressed recordings: a song used in ten games is stored once.
- Supported authorized files: MP3, M4A, WAV, FLAC, OGG/Opus.
- No timed deletion, no LRU and no automatic eviction. Game completion and
  restart cannot delete a library recording.
- New files are scanned approximately every five minutes, without hashing
  unchanged files again. At most 150 new recordings per pass.
- SQLite stores recording hashes, the curated song catalog, Spotify identifiers,
  ISRCs, and playlist metadata separately.

The legacy game-audio-cache/ is only for per-session metadata during the
existing YouTube game; its session cleanup never touches permanent songs.

## Spotify and Spotydroid
Repository: https://github.com/bruhatz/Spotydroid

Spotydroid uses Spotify OAuth to read metadata, but downloads music using
yt-dlp/YouTube Music rather than the Spotify app. Its README says it
downloads only Liked Songs; tracks in other playlists may be missing.

This integration never runs its YouTube Music extraction component, yt-dlp,
NewPipe, unofficial Spotify Partner API, or DRM circumvention.
A Spotify subscription or playlist does not grant permission to copy tracks.

The metadata-only ZIP containing Spotify playlist CSV exports is supported.
Put authorized copies in:

    ~/tune-rush-solo/staging/spotify-playlist-inbox/

The system parses track URIs, titles, artists and ISRCs, and reconciles them
with the current game catalog and local authorized audio.

The curated Tune Rush catalog (975 entries) is exported to:

    ~/tune-rush-solo/staging/mainstream/tunerush-full-catalog.csv

This is a playlist construction wishlist with Spotify search links, not
a playlist in the user's account. Creating or modifying an actual Spotify
playlist requires authorized OAuth and playlist write scope.

The official 2026 Spotify playlist builder is installed as:

    python spotify_playlist_builder.py

By default it prints a dry-run summary without network or account access.
With a Spotify Premium developer app (2026 Development Mode requirement) and
an owner-approved OAuth access token granting playlist-modify-private,
the owner can run:

    TUNERUSH_SPOTIFY_ACCESS_TOKEN=... python spotify_playlist_builder.py --execute

The builder calls POST /me/playlists and POST /playlists/{id}/items, matches
songs conservatively, remembers the playlist ID, and adds new matching tracks
without deleting previous tracks. It never downloads audio. Do not commit or
share Spotify OAuth tokens, and use a private authorized method to supply them.


## Authorized audio importing
Put recordings you own or are licensed to reuse in:

    ~/tune-rush-solo/authorized-audio/

Name files as Artist - Title.mp3 or supply manifest.csv in this directory.
Its columns are:

    filename,title,artist,spotify_uri,isrc

The S21 imports only files from that directory. It validates the audio
header, enforces file/storage limits, hashes and deduplicates contents, and
stores them under opaque names. Every game shares the same permanent files.
Matching prefers exact Spotify IDs and ISRCs and rejects ambiguous matches.

No Spotify or YouTube audio is downloaded by this integration.

## Permanent-library game playback

New Solo games use `persistent-library` as their default source. The phone
selects only imported recordings from `tunerush_playable_catalog`, applies
the catalog's genre/era filters, and prevents repeats within a game.
The browser remains at `https://kalenel.nl/music/?mode=solo`.

`permanent_audio.py` reads MP3 frames directly using the Python standard
library. It returns only the current 0.5–20 second clue, with a short decode
preroll and without ID3 artwork, titles or artist tags. The existing private
session capability and S21 relay transport carry the clue over HTTPS;
the full file and filesystem path stay on the phone. Clue timing and scoring
remain authoritative on the S21. Finishing a game does not delete recordings.

The reviewed Downloads importer verifies SHA-256 before finalizing each
recording, keeps distinct duplicate downloads by content hash, and chooses
one preferred recording per playlist entry. Its private manifest/report is
stored inside `music-library-v1`; no music bytes are committed to GitHub.
Missing files remain explicitly unavailable instead of falling back to a
different song or an external streaming provider.

The completed import covers all 1,000 playlist catalog entries, with no missing
files. There are 999 distinct playable recordings: the two Darude Sandstorm
listings reference the same recording. Both catalog entries are retained, while
selection and saved-game rotation prevent replaying the same audio bytes.
The public filter count uses this same recording-level grouping. The S21 retains
1,062 content-addressed files; alternate downloads are preserved independently
of the one-recording-per-game pool. Completing a game deletes none of them.

## Verification
Local health endpoint:

    http://127.0.0.1:8797/api/music-library/health

S21 commands from its Termux shell:

    cd ~/tune-rush-solo
    python persistent_music_library.py
    python music_library_sync.py
    python test_persistent_music_library.py
    python test_music_library_sync.py

