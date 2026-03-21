# Email automation plan v51

1. Stabilize the queue schema
- normalize `outbound_email_jobs` on `job_status`
- keep legacy `status` temporarily for compatibility
- verify queue view and worker functions

2. Choose sender path
- Preferred: Supabase Edge Function + Resend
- Alternative: Make polling `outbound_email_jobs_pending`

3. Create sender secrets
- `RESEND_API_KEY`
- `SITE_URL=https://kalenel.nl`
- `MAIL_FROM=noreply@kalenel.nl`

4. Build sender worker
- claim queued jobs atomically
- render activation email from payload
- send via Resend
- mark sent/failed with provider id and error text

5. Trigger flow from admin
- admin approval should call `admin_queue_activation_email(...)`
- payload should include name, email, activation link, request id

6. Add retry flow
- retry failed jobs from admin
- cap attempts
- surface last error in admin

7. Validate end-to-end
- request name
- approve in admin
- queue record appears
- worker claims and sends
- email opens activation link
- activation succeeds

8. Production hardening
- domain auth in Resend
- SPF/DKIM/DMARC
- rate limiting
- alerting for failed jobs
- cron schedule for worker
