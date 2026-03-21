# v50 email setup notes

The site is now ready for a simple queue-driven sender.

## Minimum viable email architecture
- `admin.html` queues activation email jobs through `admin_queue_activation_email(...)`
- an email worker reads one job at a time with `claim_next_outbound_email_job()`
- the worker sends through Resend
- the worker marks the result with `mark_outbound_email_job_result(...)`

## Fastest implementation options
### Option A — Supabase Edge Function
Best fit if you want everything close to Supabase.

Flow:
1. Edge Function is invoked on a schedule or manually.
2. It uses the `service_role` key.
3. It claims a queued job.
4. It sends through Resend.
5. It writes back success or failure.

### Option B — Make.com
Good if you want low-code orchestration.

Flow:
1. Scheduled scenario calls a small secure endpoint or Supabase RPC.
2. Scenario sends through Resend.
3. Scenario updates the job result.

## Resend template fields you already have
From `outbound_email_jobs.payload`:
- `display_name`
- `requester_email`
- `activation_url`
- `template`
- `base_url`

## Suggested first subject line
- `Activeer je account`

## Suggested first email body
- short greeting
- one activation button
- fallback plain link
- note that the link expires in 7 days

## Before turning email on
Confirm all of these:
- activation links open the correct `kalenel.nl/activate.html?...` URL
- `admin_queue_activation_email(...)` inserts a queued row
- worker can claim a job as `service_role`
- worker can mark sent/failed
- SPF/DKIM/domain verification is complete in Resend
