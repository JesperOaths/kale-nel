# Tune Rush — SoundCloud playlist import

Source: the verified 975-song Tune Rush game catalog in `music/solo-s21/tunerush-975-game-catalog.csv`.

SoundCloud's 500-track-per-playlist limit requires at least two actual SoundCloud playlists:

- **Tune Rush — Part 1:** 500 requested songs, in original catalog order
- **Tune Rush — Part 2:** 475 requested songs, in original catalog order

Both files use `Artist - Title` lines accepted by Soundiiz's plain-text playlist importer:

- `Tune-Rush-SoundCloud-Part-1.txt`
- `Tune-Rush-SoundCloud-Part-2.txt`

Soundiiz's free plan may restrict each individual transfer to 200 songs. Five optional 200-song (or smaller) import files preserve the exact complete order:

- `Tune-Rush-SoundCloud-Batch-1.txt` — 200 requested songs
- `Tune-Rush-SoundCloud-Batch-2.txt` — 200 requested songs
- `Tune-Rush-SoundCloud-Batch-3.txt` — 200 requested songs
- `Tune-Rush-SoundCloud-Batch-4.txt` — 200 requested songs
- `Tune-Rush-SoundCloud-Batch-5.txt` — 175 requested songs

## How to publish to SoundCloud

1. Sign into [Soundiiz](https://soundiiz.com/tutorial/import-text-to-soundcloud) and connect your SoundCloud account.
2. Open **Playlists → Import Playlist → From File** and upload Part 1.
3. Review matched tracks carefully, particularly original recordings versus covers, live versions and remixes. Rename to **Tune Rush — Part 1** and choose SoundCloud as the destination.
4. Import Part 2 as a second SoundCloud playlist, **Tune Rush — Part 2**.
5. If Soundiiz enforces the free 200-track limit, use the five smaller batches as input, reviewing its destination/import options. They do not overcome SoundCloud's 500-track playlist limit.
6. Confirm the final SoundCloud playlist counts. Some mainstream tracks may have no correct matching recording on SoundCloud; the import will not necessarily include all 975.

## Important

These files contain **metadata only**, not recordings. They do not create playlists or claim that tracks exist on SoundCloud. Publishing and updating account playlists requires an authenticated SoundCloud session. The 975-song original catalog and S21 20 GiB permanent music library remain untouched.

Source: https://help.soundcloud.com/hc/it/articles/46020168734235-Domande-frequenti-sulle-tue-playlist
Import format: https://support.soundiiz.com/hc/en-us/articles/360010006793-What-is-the-CSV-format-to-import-playlists-and-favorites
Import instructions: https://soundiiz.com/tutorial/import-text-to-soundcloud
