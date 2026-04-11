GEJAST v436 login interaction-unlock patch

Files included:
- login.html
- gejast-config.js
- README_v436.txt

Deep reasoning:
The latest repo already forces background layers behind the login card, but the live page can still become unclickable even after rendering. That means a runtime blocker is still ending up above the card in the final composed page.

This patch adds a runtime interaction unlock on login.html that probes the actual rendered top element over the login card and neutralizes any non-card blocker by forcing pointer-events:none on that overlay. It also bumps the shared version to v436.
