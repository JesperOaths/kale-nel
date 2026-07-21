# Kalenel v755 admin-host deployment

The repository now contains two client-side guards:

- `admin-session-sync.js`
- `admin-gate-v105.js`

When an admin page is opened on `kalenel.nl` or `www.kalenel.nl`, the browser immediately redirects to the same path on `https://admin.kalenel.nl`. The homepage admin badge is also rewritten to the admin host by `gejast-live-summary.js`.

## Required hosting configuration

The repository change cannot create DNS records or Cloudflare Access policies. Complete these deployment settings before merging v755:

1. Point `admin.kalenel.nl` to the deployment that serves the repository's admin pages.
2. Put Cloudflare Access in front of `admin.kalenel.nl` with default-deny behavior.
3. Require the approved identity provider and MFA.
4. Keep `kalenel.nl` public for login, activation, games and public read-only pages.
5. Keep Supabase admin RPC validation enabled; Cloudflare Access is an additional perimeter, not a replacement.
6. Verify that public-host requests to `admin.html`, `admin_*`, `vault.html`, `boerenbridge_vault.html` and `toepen_vault.html` redirect to the admin host.
7. Verify that the admin host does not redirect to itself and that login return paths remain relative.

## Acceptance checks

- `https://kalenel.nl/admin.html` redirects to `https://admin.kalenel.nl/admin.html`.
- The homepage Admin link points to `https://admin.kalenel.nl/`.
- An unauthenticated visitor to the admin host is blocked by Cloudflare Access.
- After Access authentication, the existing username/password/TOTP and Supabase admin-session checks still run.
- Public activation and player-login URLs remain on `kalenel.nl`.
