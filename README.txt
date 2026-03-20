This package updates the site visuals and adds Google Authenticator-based admin login.

Included:
- index.html
- request.html
- admin.html
- supabase-google-authenticator-setup.sql

What changed:
- mobile: bigger, more visible Spinoza silhouette
- mobile: bigger, more visible, more colored playing card
- admin login now asks for a 6-digit Google Authenticator code
- admin approve/reject is designed to run through protected Supabase RPCs only

How to set up Google Authenticator:
1. Run supabase-google-authenticator-setup.sql in Supabase SQL Editor.
2. Generate a seed:
   select public.admin_generate_google_authenticator_seed('your-admin-username');
3. Add that secret to Google Authenticator, or use the returned otpauth_uri in a QR generator.
4. Create the admin account:
   select public.admin_create_or_replace_account(
     'your-admin-username',
     'your-very-long-random-password',
     'YOUR_SECRET_BASE32'
   );
5. Upload the 3 HTML files.

Notes:
- No PNGs are included in this zip.
- The SQL assumes claim_requests has:
  id, display_name, requester_note, requester_email, created_at, status, decided_at, decided_by_admin_id
  If your schema differs, adjust the two admin request RPCs accordingly.
