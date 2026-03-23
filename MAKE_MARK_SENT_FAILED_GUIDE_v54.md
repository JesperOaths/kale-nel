GEJAST Make: mark sent / mark failed guide (v54)

Scenario order
1. Webhook (Custom webhook)
2. Sleep (60 seconds)
3. HTTP - claim pending jobs
4. Iterator
5. Resend - Send an Email
6. HTTP - mark job sent
7. Error route from Resend - HTTP - mark job failed

Module 3: claim pending jobs
- Method: POST
- URL: https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/claim_email_jobs_http
- Headers:
  - apikey: sb_publishable_...
  - Content-Type: application/json
  - Accept: application/json
- Body type: Raw / JSON
- Body:
  { "p_limit": 5 }

Expected response
- JSON array of outbound_email_jobs rows.
- The Iterator should iterate over that array.

Module 5: Resend - Send an Email
Map from the iterator bundle:
- To: recipient_email
- Subject: subject
- HTML/text content should use payload.display_name, payload.activation_url, payload.expires_at
- A safe text body is:
  Hoi {{2.payload.display_name}},

  Je account is goedgekeurd.
  Gebruik deze activatielink om je pincode in te stellen:
  {{2.payload.activation_url}}

  Deze link verloopt op {{2.payload.expires_at}}.

Module 6: HTTP mark job sent
Place this immediately after the Resend module on the success path.
- Method: POST
- URL: https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/mark_outbound_email_job_sent
- Headers:
  - apikey: sb_publishable_...
  - Content-Type: application/json
  - Accept: application/json
- Body type: Raw / JSON
- Body:
  {
    "p_job_id": {{2.id}},
    "p_provider_message_id": "{{5.id}}"
  }

Notes
- {{2.id}} should be the job id from the Iterator bundle.
- {{5.id}} should be the Resend message id from the Send an Email module.
- If Resend exposes a different field name in your scenario, map that field instead.

Error route from Resend
Create an error handler on the Resend module.
Add one HTTP module there.

Module 7: HTTP mark job failed
- Method: POST
- URL: https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/mark_outbound_email_job_failed
- Headers:
  - apikey: sb_publishable_...
  - Content-Type: application/json
  - Accept: application/json
- Body type: Raw / JSON
- Body:
  {
    "p_job_id": {{2.id}},
    "p_error": "{{error.message}}"
  }

Failure behavior
- The SQL function increments attempts.
- If attempts < 5, the job goes back to pending.
- If attempts reaches 5, the job becomes failed.

Recommended checks after a test run
1. select id, job_status, attempts, last_error, sent_at, provider_message_id from public.outbound_email_jobs order by id desc limit 20;
2. Confirm successful jobs become sent.
3. Confirm failed jobs return to pending with attempts incremented, or become failed after 5 tries.
