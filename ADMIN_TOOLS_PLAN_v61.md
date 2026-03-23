# Admin tools hub plan (v61)

## Goal
Create one clean admin-only tools area so `admin.html` stays usable while still giving you all the power tools you need.

## Recommended structure

### Main admin page = operational inbox
Keep `admin.html` focused on daily work:
- to be approved
- pending activation
- active
- rejected / expired

### Separate admin tools page = toolbox
Create `admin-tools.html` for everything else.

## Sections for the admin tools page

### 1) Page hub
Show every site page in one place.
For each page show:
- page name
- path
- public or admin-only
- quick open button
- notes

Suggested groups:
- Public pages
- Activation / semi-hidden pages
- Admin-only pages
- Legacy pages

### 2) Username manager
This should manage the new DB-backed allowed usernames system.

Actions:
- reserve new username
- release username
- block username
- search username
- see linked claim request
- see linked player account

### 3) Activation tools
Actions:
- resend activation link
- regenerate activation link
- view expiry time
- move expired request back to review
- release name

### 4) Queue monitor
Show `outbound_email_jobs` in a useful way.

Tabs:
- pending
- processing
- sent
- failed

Actions:
- retry failed job
- re-ping Make
- inspect payload
- mark as failed manually

### 5) Audit / moderation log
For real admin control, keep a visible event history.

Should show:
- who approved a request
- who revoked access
- when a link expired
- when a resend happened
- when a username was blocked

### 6) Access control tools
Actions:
- revoke active player
- block player
- unblock player
- force logout active sessions

### 7) Site status box
Small panel showing:
- latest app version
- whether Make webhook ping is configured
- how many pending email jobs
- how many expired activations
- how many active players

## Easy rollout steps

### Step 1 — create `admin-tools.html`
Do not overload `admin.html` more.

### Step 2 — move secondary utilities there
Move page hub, manual reserve, queue tools, audit tools there.

### Step 3 — keep admin.html lean
`admin.html` should remain a daily operations screen.

### Step 4 — wire to real RPCs
Every admin tools action should call a named RPC.
Do not hide important actions only in client-side hacks.

### Step 5 — add role checks
Every tool action must verify admin session + role on the server side.

## Recommended first toolset
If you want the smallest good v1, start with:
- Page hub
- Username reserve / release
- Expired activation manager
- Email queue monitor
- Revoke / block tools
