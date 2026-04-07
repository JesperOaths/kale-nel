# WEB PUSH DISPATCHER SETUP v310

Upload these files to GitHub, then add these GitHub Actions secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`

Use these values for the VAPID secrets:

- `WEB_PUSH_VAPID_PUBLIC_KEY`
  - `BPqY04jDOB_8RlhNxURgWFl6cMge64Mr7DkrWtgMfG4ARWLJ6S-r6c6JeQJ6o4kysWT0WeR9oVpahP85L8GLl_4`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
  - `whDPzxFL5bz_KmQZPveEwLpXrCs5673FDS5StFO5M8g`
- `WEB_PUSH_VAPID_SUBJECT`
  - `https://kalenel.nl`

What changed in this patch:

- `gejast-config.js`
  - version bumped to `v310`
  - `WEB_PUSH_PUBLIC_KEY` is now filled in
- `gejast-sw.js`
  - notification click fallback now opens `./drinks_pending.html`
- `web_push_dispatcher.js`
  - push payload fallback URL now points to `./drinks_pending.html`
- `.github/workflows/web-push-dispatcher.yml`
  - scheduled GitHub Action added to run the dispatcher every 5 minutes and on manual trigger

Manual step still required in Make:

Add a filter before the mail/send modules so thin webhook pings do not continue:

- `email` exists and is not empty
- `subject` exists and is not empty
- and `activation_url` is not empty OR `job_id` is not empty
