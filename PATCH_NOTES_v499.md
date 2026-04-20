# v499 login names hotfix

Root cause:
- the previous ultrafast patch over-pruned the names source chain
- the single fast direct source could return zero rows on this live setup
- result: the dropdown stayed empty

What this patch does:
- keeps cached names immediate
- restores a safe names chain without the aggressive abort timeout
- tries:
  1. gejast-config helper
  2. get_login_names_scoped
  3. get_login_names
  4. allowed_usernames direct REST as a loose last fallback
- removes the extra already-logged-in/session-corner fetches from login
