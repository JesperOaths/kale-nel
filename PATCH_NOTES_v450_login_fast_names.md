# v450 login fast-name-load patch

## What was going wrong
The login page waited on slow name-loading RPC paths before it finished rendering the name dropdown.
It also fetched the names again during submit.
That made the login names appear very slowly or look stuck behind RPC timeout warnings.

## What changed
- added local cache for login names per scope
- if cached names exist, the dropdown fills immediately
- added a fast direct fetch path for names:
  - `get_login_names_scoped`
  - fallback `allowed_usernames` table read
- background refresh updates the dropdown when fresher names arrive
- login page no longer blocks on `Promise.allSettled([getPublicState(), getLoginNames()])`
- login submit no longer does a second blocking name fetch before redirect

## Files
- `login.html`
