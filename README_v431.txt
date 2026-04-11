GEJAST v431 login timeout fix

Files included:
- login.html
- gejast-account-scope.js
- gejast-config.js
- site-analytics.js
- README_v431.txt

Root cause addressed:
login.html still used old blocking head scripts and immediate RPC-driven boot. On hard refresh, pending account-scope/public-state requests could stall the login page before it became usable.

Changes:
- defer login head scripts so the page can render before script boot work runs
- add RPC timeouts in gejast-account-scope.js so scoped account calls cannot hang indefinitely
- add load/touchSession timeouts in login.html
- start login load after DOMContentLoaded + requestAnimationFrame instead of immediate inline boot
- disable analytics on public auth pages through the patched site-analytics.js
- bump shared version to v431 and update visible watermark on login
