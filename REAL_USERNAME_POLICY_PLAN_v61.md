# Real DB-backed allowed / reserved usernames plan (v61)

## Goal
Only usernames that you explicitly approve or reserve should be usable on the site. Nobody should be able to invent a random name outside that list.

## The simple end-state
There will be **one real source of truth** in the database for names.

A username can be in one of these states:
- `available` — allowed name, not yet claimed
- `reserved` — manually reserved by admin for a real person
- `pending_review` — someone applied for it and is waiting for approval
- `approved_pending_activation` — approved, activation link sent, not activated yet
- `active` — user finished activation and can log in
- `expired` — approved once, but link expired before activation
- `rejected` — request denied
- `blocked` — name/account blocked by admin

## New tables

### 1) `allowed_usernames`
This becomes the master list.

Suggested columns:
- `id`
- `username` (unique, normalized lowercase slug)
- `display_name`
- `status`
- `reserved_for_email`
- `reserved_for_person_note`
- `player_id` (nullable until activated)
- `current_claim_request_id` (nullable)
- `activation_link_id` (nullable)
- `approved_by_admin_id`
- `blocked_reason`
- `created_at`
- `updated_at`

### 2) `claim_requests`
Keep this for the application history, but each request should point at the reserved / allowed username row.

Add:
- `allowed_username_id`
- `request_status` if you want a cleaner state split than the current mixed fields

### 3) `username_events`
Optional but strongly recommended.
This is an audit trail.

Example columns:
- `id`
- `allowed_username_id`
- `event_type`
- `admin_id`
- `claim_request_id`
- `details jsonb`
- `created_at`

This lets you see exactly when a name was:
- reserved
- applied for
- approved
- link expired
- requeued
- activated
- blocked
- re-opened

## Rules to enforce

### Rule 1: only names from `allowed_usernames` can be used
The public request flow and scorer team dropdowns should both read from this table.

### Rule 2: do not allow duplicate open requests for the same username
At any moment, a username should have **at most one live request path**.

Allowed:
- old rejected request + new fresh request
- old expired activation + new re-review request

Not allowed:
- two simultaneous pending requests for the same username
- two simultaneous pending activation flows for the same username

### Rule 3: wrong people claiming names
Do **not** let a second person freely claim the same name just because they typed it.

Instead:
- if the name is `reserved` for another email/person, show: “This name is not available for self-claim.”
- if the name is already `active`, do not allow a new claim
- if the name is `approved_pending_activation`, only allow a reapply flow if it belongs to the same email or if admin explicitly resets it

## Public flow after this change

### Case A — normal user
1. user opens `request.html`
2. sees only names that are actually allowed / available
3. picks one name
4. submits email
5. request is stored against that allowed-name row
6. admin reviews
7. if approved, activation link is created
8. status becomes `approved_pending_activation`
9. after activation, status becomes `active`

### Case B — expired activation link
1. link expires
2. username row changes from `approved_pending_activation` to `expired`
3. claim request is moved back for re-review or reissue
4. admin can resend / reapprove cleanly

## Admin features needed
- reserve new username
- see whether a name is available / reserved / pending / active / blocked
- manually attach email to reserved name
- re-open expired name
- block name
- transfer a request to a different reserved name if needed

## Recommended rollout in easy steps

### Step 1 — add the new table
Create `allowed_usernames` first without changing the public flow yet.

### Step 2 — import your known real people
Put your real known usernames into `allowed_usernames`.
Set them to `available` or `reserved`.

### Step 3 — link new requests to that table
Change the request RPC so a request must reference an `allowed_username_id`.
Do not accept free-text names anymore.

### Step 4 — block duplicate live requests
Add a DB check so the same allowed username cannot have two open claim flows at once.

### Step 5 — change scorer team picker
The scorer dropdown should read only active / allowed player names from the DB.

### Step 6 — add admin tools
Add tabs for:
- available
- reserved
- pending review
- pending activation
- active
- blocked

### Step 7 — migrate old claims
Map old `claim_requests` and `players` rows into `allowed_usernames`.
Do this once and store the links.

## Best policy answer for your question
Do we allow multiple applications with the same name?

**Recommended answer: no, not as parallel open requests.**

Better rule:
- allow one live path per name
- allow a later retry only after the previous path is rejected, expired, blocked, or manually reset
