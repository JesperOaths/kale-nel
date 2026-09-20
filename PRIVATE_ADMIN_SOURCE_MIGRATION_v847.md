# Private admin source migration — v847

Status: **migration tooling implemented; source move not yet activated**.

The live admin site is already protected by the Cloudflare Worker GitHub OAuth perimeter and the independent Supabase admin/TOTP inner lock. This migration addresses a different issue: protected admin frontend source still exists in the public `JesperOaths/kale-nel` repository.

## What is implemented

The public repository now supports two admin-source modes:

- `public-fallback` — transition mode. Protected admin source is still read from this public repository so existing deployments remain reproducible.
- `external-private` — final mode. Protected admin source is read from a separately checked-out private repository; shared public assets continue to come from `kale-nel`.

The external-private build is fail-closed:

1. The private repository must contain `admin-source-manifest.json`.
2. The manifest schema must be `kalenel-private-admin-source/v1`.
3. Every manifest path must classify as protected admin source.
4. Every file must exist and match its SHA-256 hash.
5. Obvious private keys and common production-token shapes are rejected.
6. The generated Worker manifest records `admin_source_mode: external-private`.
7. Setting `KALENEL_REQUIRE_PRIVATE_ADMIN_SOURCE=1` prevents fallback deployment.

## Generate the one-time migration package

From a trusted checkout of the public repository:

```powershell
npm run admin-source:check
npm run admin-source:extract
```

Default output:

```text
private-admin-source-export-v847/
```

That directory is explicitly gitignored in the public repository. It contains the protected source files plus a SHA-256 manifest.

A different destination can be selected without editing the script:

```powershell
node scripts/extract-private-admin-source.mjs --out=C:\safe\kalenel-admin-source
```

Do not place secrets in the private source repository. OAuth secrets, cookie-signing values, Supabase service-role keys, payment secrets and other credentials remain in their existing encrypted secret stores.

## Private repository shape

The private repository should preserve the exported relative paths, for example:

```text
admin.html
admin_shop_orders.html
admin_shop_analytics.html
admin_shop_operations.html
admin-session-sync.js
admin-topnav.js
gejast-admin-rpc.js
...
admin-source-manifest.json
```

The manifest must stay at repository root.

## GitHub Actions configuration

After creating the private repository, configure these on the public `kale-nel` repository:

- Repository variable `KALENEL_ADMIN_SOURCE_REPOSITORY` = the private repository in `owner/name` form.
- Optional repository variable `KALENEL_ADMIN_SOURCE_REF` = pinned branch/tag/commit; defaults to `main`.
- Repository secret `KALENEL_ADMIN_SOURCE_TOKEN` = least-privilege credential with read-only Contents access to that one private repository.
- After the first external-private deploy is proven, repository variable `KALENEL_REQUIRE_PRIVATE_ADMIN_SOURCE` = `1`.

The admin deployment workflow automatically checks out the private repository into `.private-admin-source`, verifies the manifest and hashes, and builds the Worker bundle from public shared assets plus private protected assets.

The normal **GEJAST verification** workflow uses the same private checkout and overlays the verified private files into the ephemeral Actions workspace before running legacy regressions. This is intentionally a CI-only overlay; it does not commit the protected files back into the public repository.

## Required migration sequence

1. Generate the extraction package from the current trusted public `main`.
2. Create a new **private** repository and push only the generated package contents.
3. Configure the repository variable/token above.
4. Dispatch **Deploy admin Worker** with `DEPLOY_ADMIN_WORKER`.
5. Confirm the workflow reports `admin_source_mode: external-private`.
6. Re-run the protected perimeter/OAuth verification and the inner admin/TOTP browser proof.
7. Set `KALENEL_REQUIRE_PRIVATE_ADMIN_SOURCE=1` and repeat the deployment.
8. Confirm GEJAST verification also passes with its private-source CI overlay.
9. Only after the external-private deploys and CI overlay both pass, remove the corresponding protected source files from public `kale-nel`.
10. Run the full repository verification and another protected Worker deployment.
11. If desired, separately plan a Git history rewrite. Deleting current files does **not** erase older public Git history.

## Public-source deletion gate

Do **not** delete protected source from the public repository merely because the private repository exists. Deletion is allowed only after:

- the private manifest passes;
- a real Worker deployment uses `external-private`;
- the protected Shop Operations, Orders, Analytics and Connection pages are proven live;
- public apex protected paths still redirect to `admin.kalenel.nl`;
- anonymous direct admin-host asset access remains denied;
- Supabase admin/TOTP remains the inner lock;
- `KALENEL_REQUIRE_PRIVATE_ADMIN_SOURCE=1` has been proven in deployment.

This prevents a source-separation change from accidentally taking the admin console offline.
