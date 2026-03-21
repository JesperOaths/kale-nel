# v47 rollout

## Frontend
Upload all updated static files, including:
- premium-v47.css
- CNAME
- playingcard-accent1-trimmed.png

## Supabase
Run:
1. gejast_v32_secure_activation.sql
2. gejast_v47_frontend_alignment_patch.sql

## What the SQL patch does
- adds `get_gejast_homepage_state(...)` as the homepage wrapper RPC
- adds `outbound_email_jobs` for durable mail queueing
- adds `admin_queue_activation_email(...)` so admin.html can queue activation mails without relying on an Edge Function

## Mail delivery
Have your sender poll or consume `public.outbound_email_jobs_pending`, send the email, then update:
- `job_status` to `sent` and `sent_at`
- or `job_status` to `failed` and `last_error`
