# Gejast handoff note v157

## Visual/state notes
- Homepage ladder cards are live and clickable.
- Ladder page now uses matrix-style sections for cooperation and head-to-head winrates.
- Match history on ladder and unified player pages is collapsible and exposes per-match detail rows.
- Unified player profile remains one page with a game toggle.
- Version label is intended to be config-driven via gejast-config.js and cache-busted as ?v157 on patched pages.

## Admin-session root fix
- admin-session-sync.js is token-first and exposes requirePage(returnTo).
- admin-gate-v105.js now defers to shared session validation first.
- admin_claims no longer treats a missing .ok field as a failed admin session.

## Data retention
- Public/player pages still assume both normalized columns and raw payload JSON are preserved for matches.
- Match detail expansion uses the details arrays returned by SQL from canonical match tables.

## Forms
- Beerpong now prevents duplicate selections visually and validates them logically.
- Beerpong 1v1 asks for cup count first and uses that target for victory.
- Boerenbridge name fallback now includes dummy players too.
