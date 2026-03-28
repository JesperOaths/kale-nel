# GEJAST Admin Session Phase Note v150

## Goal
Unify admin session reuse so one admin login works across admin hub, admin claims, analytics, vaults, leaderboard, and match control.

## Root issue
Different pages were using different subsets of admin session state:
- jas_admin_session_v8
- jas_admin_user_v1
- jas_admin_deadline_v1
- optional jas_admin_device_v1

Some pages only stored the bare token, while gate-based pages expected more context.

## Fix direction
A shared `admin-session-sync.js` now owns:
- reading the current bundle
- writing the current bundle
- clearing the bundle
- validating the bundle against Supabase

Pages should call that shared helper instead of each page inventing its own token logic.
