# v50 deployment guide for `jesperoaths/wordt-er-gejast` → `kalenel.nl`

This repo is now treated as a **root-domain site**, not a subfolder site.

That means all links and assets should behave correctly at:
- `https://kalenel.nl/`
- not only at `https://jesperoaths.github.io/wordt-er-gejast/`

## What to deploy in this phase
1. Upload/push the v50 frontend files.
2. Run the Supabase SQL in the exact order below.
3. Point GitHub Pages to the custom domain.
4. Validate the site and admin flows.
5. Only then wire the email sender.

---

## 1) Push the frontend
Use the repo root for the published site.

Files you should keep live:
- `index.html`
- `login.html`
- `request.html`
- `admin.html`
- `activate.html`
- `site-shell.css`
- `theme-v46.css`
- `theme-v45.css`
- `uniform-v48.css`
- `premium-v47.css`
- `phase2-v49.css`
- `logo.png`
- `dubbeleD-goud.png`
- `spinoza-silhouette.png`
- `playingcard-accent1-v48.png`
- `site-bg-desktop.webp`
- `site-bg-mobile.webp`
- `CNAME`

Files that are safe to keep for history but not required at runtime:
- `README*.txt`
- `IMPLEMENTATION_README_v46.md`
- `HOSTING_kalenel_nl.md`
- `V47_ROLLOUT.md`
- `FILE_AUDIT_v48.md`
- `admin-dev.html`
- older art assets not referenced by the live pages

Files that can be removed from the published root if you want a cleaner repo:
- `testfile`
- `playingcard-accent.png`
- `playingcard-accent1-trimmed.png`
- `123zwartkaart.png`
- `kale9goed.png`
- old CSS versions that are no longer linked by any live page, once you confirm they are unused

---

## 2) Run Supabase SQL in this order
Run these in Supabase SQL Editor, top to bottom.

### SQL 1
`gejast_v32_secure_activation.sql`

Purpose:
- activation token table
- secure link creation
- secure activation from email link

### SQL 2
`gejast_v47_frontend_alignment_patch.sql`

Purpose:
- homepage wrapper RPC
- outbound email queue table
- admin queue helper
- pending queue view

### SQL 3
`gejast_v50_rest_and_email_worker_patch.sql`

Purpose:
- grants execute for frontend-facing RPCs
- adds atomic email-job claim function for a sender worker
- adds job result update function
- adds admin retry function
- locks down direct queue table access

### Post-SQL smoke tests
Run these after the migrations:

```sql
select public.get_gejast_homepage_state(null);
```

```sql
select public.get_activation_link_context('definitely-invalid-token');
```
This one should fail with an “invalid token” style error. That is expected.

```sql
select * from public.outbound_email_jobs_pending;
```

```sql
select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in (
    'get_gejast_homepage_state',
    'get_activation_link_context',
    'activate_player_from_email_link',
    'create_player_activation_link',
    'admin_queue_activation_email',
    'claim_next_outbound_email_job',
    'mark_outbound_email_job_result',
    'retry_outbound_email_job'
  )
order by proname;
```

---

## 3) GitHub Pages + custom domain
Because your repo is `jesperoaths/wordt-er-gejast`, GitHub’s default URL is:
- `https://jesperoaths.github.io/wordt-er-gejast/`

But your desired production URL is:
- `https://kalenel.nl/`

That means the site must behave like a root site.

### GitHub settings
1. Open the repo on GitHub.
2. Go to **Settings → Pages**.
3. Publish from:
   - branch: `main`
   - folder: `/root`
4. Set **Custom domain** to:
   - `kalenel.nl`
5. Ensure **Enforce HTTPS** is on after DNS is ready.

### Required DNS records
At your registrar, set:

Root domain:
- `A 185.199.108.153`
- `A 185.199.109.153`
- `A 185.199.110.153`
- `A 185.199.111.153`

WWW:
- `CNAME jesperoaths.github.io`

### Root-domain validation checklist
After GitHub Pages finishes:
- `https://kalenel.nl/` loads `index.html`
- `https://kalenel.nl/login.html` works
- `https://kalenel.nl/request.html` works
- `https://kalenel.nl/admin.html` works
- styles load correctly on every page
- images load correctly on every page
- no link still points to `/wordt-er-gejast/...`

---

## 4) Frontend validation checklist
### Public
- Homepage loads without console errors.
- Voting while logged out redirects to `login.html`.
- Login page stores a session and returns to the homepage when needed.
- `activate.html` is reachable directly by a tokenized email link, but not publicly linked in navigation.

### Admin
- Admin login works.
- Approved request can generate an activation link.
- Approved request can queue an activation email.
- Revoking a player still works.

### Activation
- Activation page shows bound name/email for a valid token.
- Valid 4-digit pin activates the player.
- Invalid or expired token shows a controlled error state.

---

## 5) Email worker hookup
Do this only after the frontend and SQL are stable.

The sender should use the queue like this:
1. Call `public.claim_next_outbound_email_job()` as `service_role`.
2. Send the email through Resend.
3. Call `public.mark_outbound_email_job_result(...)` with success/failure.
4. If delivery fails and you want to retry manually, use `public.retry_outbound_email_job(...)` from admin tooling.

The queued payload already includes:
- `activation_url`
- `display_name`
- `requester_email`
- `template`
- `base_url`

That is enough to build the first working activation email.

---

## 6) Recommended rollback path
If something breaks:
1. Revert the frontend commit.
2. Keep the SQL unless the error is specifically in the new worker functions.
3. Disable custom domain temporarily in GitHub Pages if DNS/routing is the issue.
4. Re-run the smoke tests above.
