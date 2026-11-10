# Outbound Tune Rush transport

The S21 continues to select songs, create MP3 clues, check answers, keep scores
and persist games. `hub_relay.py` forwards the existing Supabase queue requests
to that engine over the LAN. It provides a reliable outbound IPv4 connection
when the phone's IPv6-only cloud connection is failing. It opens no listening
port and exposes no new public endpoint.

The service requires a private configuration at
`~/.config/tunerush-relay/config.json`, mode 0600, containing `rpc_base`,
`publishable_key`, `worker_secret` and `upstream`. Generate a fresh 32-byte
hexadecimal worker credential locally and register only its SHA-256 hash as
the `c720p-transport` worker through the private database administration route.
Never commit the configuration or worker credential.

Apply `hub-relay.sql` through the authorized database migration tool, preserving
the live definitions of the three modified functions as a private rollback.
Install the user unit and enable it only after registration succeeds. The unit
restarts after process failure and starts automatically with the existing user
manager. Its resource ceiling is 64 MiB; game processing remains on the phone.

The worker checks the actual phone health before each claim. A healthy hub
transport takes priority; the original phone worker remains available after
the hub heartbeat expires. Claims use row locking and deliver one job at a time.
Only a transient result is held in memory. The journal stores job identifiers
and timestamps, never music, answers, guesses or session credentials.

If publishing a result fails, the same result is retried without repeating the
phone action. A journal written before forwarding prevents replay after a
process restart. Expired mutations return an instruction to reload saved state;
only read-only state queries can be requeued. Completed relay payloads expire
after 90 seconds, independently of the permanent S21 music library.

Verification: run `python3 -m unittest -v test_hub_relay.py`, check the public
relay health, then play a disposable game through `kalenel.nl/music/?mode=solo`,
including short and 20-second clues, reveal, next song, scoring and finish.

Rollback: stop and disable only `tunerush-relay.service`, restore the saved three
function definitions, then remove the `c720p-transport` registration. The original
S21 worker, frontend, library and existing saved games remain available.
