# SITE PAGES v59

## Open in publieke navigatie
- `index.html` — homepage / stemmen
- `login.html` — spelerlogin
- `request.html` — naam aanvragen
- `scorer.html` — mobiele klaverjas scorer

## Verborgen of admin-only
- `admin.html` — admin portal
- `vault.html` — admin analyse
- `leaderboard.html` — admin ranglijst
- `activate.html` — activatielink landing
- `score.html` — legacy scorepagina

## Toelichting
`vault.html` en `leaderboard.html` doen nu een admin-sessiecheck in de browser en sturen zonder geldige sessie terug naar `admin.html`.
Bij een puur statische site is dit afscherming aan de voorkant; voor echte private toegang blijft server-side/private hosting nodig.
