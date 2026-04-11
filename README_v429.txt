GEJAST v429 gate root-cause fix

Files included:
- index.html
- home.html
- gejast-home-gate.js
- gejast-config.js

Root cause fixed:
The shared gejast-home-gate was hiding the entire document while waiting on async RPC/session probes. On index.html that could leave the page blank or make Firefox report the page as slowing down if the gate path stalled.

Changes:
- remove gejast-home-gate.js from index.html so the homepage no longer uses the document-hiding private gate
- keep the earlier raw preflight redirect on index.html for no-session users
- rewrite gejast-home-gate.js so protected pages no longer hide the document during async validation; they only redirect if validation fails
- add timeouts to gate validation to prevent indefinite hangs
- update home watermark/version to v429
- bump shared version to v429
