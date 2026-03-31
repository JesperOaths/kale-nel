v185 drinks mobile add page + homepage top-5 fix

Contents:
- index.html : homepage now shows two drinks Top 5 cards between the 3 game ladders and the drinks stats block
- drinks_add.html : dedicated mobile-first add/verify page for drinks
- gejast_v185_drinks_homepage_top5_fix.sql : fixes the get_drinks_homepage_top5_public() RPC and removes the bad p.name reference
- gejast-config.js : version bumped to v185

Notes:
- Homepage drinks Top 5 uses weighted alcohol units, not raw beer count
- The two homepage cards are day-session Top 5 and all-time Top 5
- Main homepage drinks entry now points to drinks_add.html
