# Site pages v58

## Publiek gelinkt vanaf index.html
- `index.html` — homepage en stemoverzicht
- `login.html` — spelerlogin met pincode
- `request.html` — nieuwe naam aanvragen
- `scorer.html` — klaverjas scorer
- `leaderboard.html` — ranglijst

## Publiek bereikbaar maar niet in hoofdmenu
- `score.html` — oudere scorepagina / legacy scorer
- `activate.html` — alleen bedoeld via activatielink uit e-mail

## Verborgen / admin-only
- `admin.html` — admin portal
- `vault.html` — admin-only analysepagina, gated via admin session check

## Belangrijke noot
Omdat dit een statische site is, kun je HTML-bestanden niet volledig geheim houden met alleen front-end code.
Wat wel is toegevoegd:
- `vault.html` controleert een geldige adminsessie en stuurt anders terug naar `admin.html`
- `admin.html` blijft achter de bestaande admin-login
- `activate.html`, `vault.html` en `admin.html` zijn gemarkeerd met `noindex,nofollow`

Voor echte afscherming moet je verborgen pagina's server-side beschermen of buiten de publieke static hosting houden.
