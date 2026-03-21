Wordt er gejast v45 patch notes

What changed
- stronger, sharper baked backgrounds
- removed duplicate foreground hand overlay; the hand now stays only in the baked background
- made the glass cards more transparent and more actually glass-like
- restored the centered Spinoza silhouette so it reads through the main card
- moved the foreground playing card more on-screen
- added an admin-dev diagnose page: admin-dev.html
- made admin login and dev-login verify the returned session immediately via admin_check_session
- switched admin storage key to jas_admin_session_v8 so stale broken tokens stop poisoning the UI
- added missing request/history search inputs and history filter pills
- wired automatic mail endpoint to /functions/v1/send-activation-email
- added Supabase Edge Function code and a conservative helper SQL note file

Testmodus decision
- testmodus is NOT useless by definition
- it is useful only if admin_dev_login exists and produces a session that also passes admin_check_session
- the new admin-dev page is there to prove that explicitly instead of guessing

Fast steps
1. Upload/overwrite the site bundle.
2. Deploy the Edge Function:
   supabase functions deploy send-activation-email --no-verify-jwt
3. Set required secrets:
   RESEND_API_KEY
   RESEND_FROM_EMAIL
4. Hard refresh the site and admin pages.
5. Open admin-dev.html and test:
   admin_dev_login
   admin_check_session
6. Then use admin.html for the real flow:
   approve request -> generate link -> auto-send e-mail -> activate -> login.
