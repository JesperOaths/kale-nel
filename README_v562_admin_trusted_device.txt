GEJAST v562 admin trusted-device comfort patch

Included:
- admin-session-sync.js
- admin.html

What this fixes:
- preserves trusted-device recognition for admin login more reliably
- keeps the admin session warm in the background while you actively use admin pages
- stops the frontend from throwing away a still-recoverable trusted-device session just because the local deadline passed
- stores and refreshes the existing raw device token path instead of inventing a weaker bypass
- adds a clear note on admin.html about the trusted-laptop behavior

Security model:
- still requires a real successful admin login first
- still clears trust on explicit logout
- uses a 30-day trusted-device window and a 24-hour renewable active-session window
- does not bypass server validation; it only reuses the repo’s existing device-token path

Recommended after upload:
- close other open admin tabs
- hard refresh admin pages once
- log in once through admin.html again so the trusted device token is definitely refreshed
