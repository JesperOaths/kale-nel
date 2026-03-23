GEJAST email pipeline + activation rollout (v53)

1. Upload/overwrite the files from this zip to your repo/site.
2. In Supabase SQL Editor, run gejast_v53_email_activation_make_patch.sql.
3. In Make, keep the scenario as:
   Webhook -> Sleep 60s -> HTTP -> Iterator -> Resend -> HTTP mark sent
   with an error route -> HTTP mark failed.
4. In the Make HTTP module, call:
   POST https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/claim_email_jobs_http
   body: { "p_limit": 5 }
5. Turn the Make scenario on.
6. In admin.html, approve one pending request.
7. That approve flow will:
   - save the approval
   - create the activation link
   - queue the activation email job
   - ping the Make webhook
8. Check Supabase:
   select id, recipient_email, subject, payload, status, job_status, sent_at
   from public.outbound_email_jobs
   order by id desc
   limit 10;
9. Check activation links:
   select id, claim_request_id, player_id, requester_email, expires_at, used_at
   from public.player_activation_links
   order by id desc
   limit 10;
10. Open the email, click the activation link, set the 4-digit pin, and confirm that reusing the same link fails.
