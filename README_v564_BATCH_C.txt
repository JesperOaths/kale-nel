GEJAST Batch C frontend bundle v564

Scope of this bundle
- Richer Rad workflow pass on the existing frontend owner path
- Despimarkt / Beurs surface redesign on the real subsystem entry page
- Paardenrace live board-owner consolidation on the frontend path
- Homepage index boot-visibility fix so index.html does not stay visually blank when homepage boot hydration throws or stalls

Included files
- index.html
- rad.html
- despimarkt.html
- despimarkt-theme.css
- paardenrace_live.html
- gejast_v564_batch_c_changed_files.txt

Notes
- No SQL file is included in this batch.
- The index fix keeps the homepage visible during boot, restores the bottom poll snapshot immediately, and always clears the boot-pending hidden state even if homepage boot hydration fails.
- This bundle remains versioned as v564 because it is the corrected replacement for the earlier Batch C upload bundle, not a new follow-up frontend batch.
