# GEJAST Admin Return Phase Note v152

## Goal
When an admin-only page redirects to `admin.html`, a successful login should send the admin straight back to the page they originally tried to open.

## Fix
- admin-only pages now redirect with `?return_to=...`
- `admin.html` now understands `return_to` and jumps back after successful validation/login

## Reason
This reduces the feeling that the admin area is randomly forgetting state or sending the admin into loops.
