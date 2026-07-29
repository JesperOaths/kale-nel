# Rollback — Kalenel admin Cloudflare Worker gate v762

Use this only if the Workers Free admin perimeter breaks live admin access or public gameplay routes.

## Preserve evidence first

Before rollback, capture:

```powershell
.\scripts\probe-admin-worker-gate-v762.ps1 | Tee-Object ADMIN_WORKER_GATE_ROLLBACK_EVIDENCE.json
```

Do not capture or paste Worker secrets, GitHub OAuth secrets, cookies, Supabase admin tokens, or service-role keys.

## Cloudflare rollback steps

1. In Cloudflare Workers, disable or delete Worker routes for:
   - `admin.kalenel.nl`
   - `kalenel.nl/admin*`
   - `kalenel.nl/gejast-admin*`
   - `kalenel.nl/gejast-push-admin-source.js`
   - `kalenel.nl/drinks_admin.html`
   - `kalenel.nl/familie_admin.html`
   - `kalenel.nl/match_control.html`
   - `kalenel.nl/match_swap.html`
   - `kalenel.nl/*_vault.html`
   - `kalenel.nl/vault.html`
   - sensitive repo artifact routes (`*.md`, `*.txt`, `*.sql`, `*.patch`, `/mnt/*`, `/deployment_forensics_v761/*`, `/sql/*`)
2. Keep the existing proxied DNS record for `admin.kalenel.nl` unless it causes routing failures; removing the Worker custom domain will make it return origin/404 again.
3. Do **not** activate Cloudflare Zero Trust or enter billing details as a rollback shortcut.
4. Re-run public route checks for `activate.html`, `request.html`, `login.html`, `home.html`, and representative gameplay pages.

## Git rollback

If repo artifacts need to be reverted before deployment:

```powershell
git revert <admin-worker-gate-commit>
```

If the Worker was already deployed, Git rollback alone is not enough; remove/disable Cloudflare Worker routes too.

## Expected rollback state

- Public gameplay routes work as before.
- `admin.kalenel.nl` may return `404` or the old origin response.
- Public apex admin paths may become exposed again after route rollback; treat that as a temporary emergency rollback only, not a secure final state.
