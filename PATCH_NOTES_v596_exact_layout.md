# Klaverjas v596 exact-layout patch

Included files:
- scorer.html
- klaverjas_quick_stats_v593.html
- kruipen_under_table.png
- naakt_kruipen_danger.png

What this patch does:
- uses the exact uploaded v596 scorer page as the scorer.html base
- does not merge the old scorer layout into it
- adds only hidden repo wiring so it behaves like a site page:
  - gejast-config.js
  - gejast-family-rollout.js
  - gejast-home-gate.js
  - requireMatchEntrySession(...)
  - version watermark
  - site analytics include
- uses the uploaded quick stats page as-is, with the same hidden site/session wiring

Important:
- this patch intentionally preserves the v596 scorer layout instead of transplanting old scorer UI structure into it
