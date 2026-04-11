GEJAST v426 boot visibility fix

Files included:
- index.html
- gejast-config.js

Changes:
- removes initial boot-pending hide from index body so homepage no longer opens blank
- adds finally-based unhide in bootHomepage even when load stalls
- adds repeated reveal failsafe timeouts
- keeps paardenrace row from prior patch
- bumps shared version to v426
