
v184 homepage drinks top-5 patch

Contents:
- drinks-home-top5.js : frontend patch that injects a two-card Top 5 block
  (Sessie / All-time) directly under the three game Top 5 cards and above the
  existing Drinkstand stats block.
- gejast_v184_drinks_homepage_top5.sql : companion SQL function
  get_drinks_homepage_top5_public()

Expected frontend environment:
- window.supabaseClient available
- homepage drinks container exists as one of:
  .drinks-home-section / #drinksHomeSection / [data-drinks-home]

If your existing homepage JS already has a drinks block bootstrap, just include
drinks-home-top5.js after that script.
