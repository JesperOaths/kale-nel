# v813 final certification fixture correction

This maintenance-only release note records two certification fixes discovered while finalizing v813:

- Final live-browser disposable session tokens now use the production browser contract: exactly 48 lowercase hexadecimal characters. The previous `v792-cert-` prefixed tokens were accepted by lower-level RPC resolvers but deliberately rejected by the real browser session parser, producing a false Boerenbridge login redirect.
- The visual-audit Supabase data-plane preflight retries up to three bounded 8-second probes with a 750 ms delay. A single transient timeout must not force an anonymous degraded audit when the authenticated data plane is healthy on retry; persistent failure still fails closed and cannot certify the release.

No shipped product page, gameplay logic, security viewer behavior, authentication policy, or database privilege boundary is changed by these corrections.
