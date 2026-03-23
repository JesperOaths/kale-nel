# Expired activation links -> move back into approval queue plan (v61)

## Short answer
Yes. This is a good idea.

When someone was approved but never clicked their activation link in time, they should not stay stuck forever in “pending activation”.
They should move back into a review bucket so you can:
- re-check whether the name should still be held
- resend a fresh link
- assign a different name if needed
- reject / release the name if the person disappeared

## Recommended state flow

Current simplified flow:
- pending review
- approved pending activation
- active
- rejected

Recommended new flow:
- pending review
- approved pending activation
- activation expired
- back to review queue
- active
- rejected
- blocked

## What should happen when a link expires
When `expires_at < now()` and `used_at is null`:
1. mark the activation link row as expired logically
2. mark the related username / request as `expired`
3. create an event in `username_events`
4. surface that request again in admin under either:
   - a separate `Expired activations` tab, or
   - back in `To be reviewed`

## Best UX choice
Use a separate admin tab first:
- `To be approved`
- `Pending activation`
- `Expired activation`
- `Active`
- `Rejected`

Why?
Because expired links are not exactly brand-new requests.
They need a different action set:
- resend link
- move back to review
- release the name
- reject

## Public reapply behavior
When a user comes back after expiry:
- if they use the same email for the same reserved name, you can let that create a reapply request
- do not silently auto-activate them
- either:
  - create a new admin item in `Expired activation`, or
  - directly allow admin to click `Resend activation`

## Backend implementation in easy steps

### Step 1 — add an expiry-check query
Create a SQL function that finds:
- activation links where `expires_at < now()`
- and `used_at is null`
- and linked request/user is still pending activation

### Step 2 — add a processing function
Create a function such as:
`process_expired_activation_links()`

That function should:
- find expired unused links
- mark their related claim/user status as `expired`
- set `last_error` or `decision_reason` style note if useful
- write an audit event

### Step 3 — run it on a schedule
Run that function every 15 minutes or every hour using:
- Supabase cron / pg_cron if available, or
- Make scheduled scenario, or
- GitHub Action / server worker

### Step 4 — show the result in admin
Add an `Expired activation` list in admin.

### Step 5 — give admin clear actions
Each expired item should have buttons:
- resend fresh activation link
- move back to approval queue
- release name
- reject name
- block person/name

## Recommended business rule
When a link expires, do **not** automatically give them a new name.

Instead:
- move them back to admin review
- let admin decide whether the same name stays reserved
- optionally let admin reassign another name manually

This keeps the process safe when the wrong person tried to claim a name.
