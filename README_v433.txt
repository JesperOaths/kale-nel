GEJAST v433 login pointer-event fix

Files included:
- login.html
- gejast-config.js
- README_v433.txt

Root cause addressed:
The login page could render but remain unclickable because layered decorative/fixed elements were still able to win the stacking context and intercept pointer interaction on some browsers.

Changes:
- isolate the login page stacking context on body
- force the background scene to pointer-events:none
- force the main login card and its descendants to pointer-events:auto and z-index above decorative layers
- make hidden modal overlays pointer-events:none unless shown
- bump shared version to v433
