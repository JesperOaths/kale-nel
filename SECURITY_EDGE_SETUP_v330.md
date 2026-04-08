# GEJAST v330 — privacy- en edge-hardening

## Wat in deze patch al repo-zijdig is gedaan
- `robots.txt` toegevoegd
- `sitemap.xml` beperkt tot publieke home-urls
- `_headers` toegevoegd met `X-Robots-Tag`, `Cache-Control: no-store`, `X-Frame-Options`, `Referrer-Policy`
- niet-publieke HTML's voorzien van striktere `robots` en no-cache meta-tags
- return-to redirects aangescherpt in:
  - `gejast-config.js`
  - `gejast-home-gate.js`
  - `admin-gate-v105.js`
  - `admin-session-sync.js`

## Wat nog echt op hosting/edge moet gebeuren
Deze repo-patch alleen maakt private pagina's nog niet onopvraagbaar. Daarvoor is edge-configuratie nodig.

### Aanbevolen host-split
- `kalenel.nl` = publiek
- `app.kalenel.nl` = ingelogde gebruikerssite
- `admin.kalenel.nl` = admin

### Cloudflare Access / edge-regels
1. Plaats admin-pagina's alleen op `admin.kalenel.nl`
2. Plaats private gebruikerspagina's alleen op `app.kalenel.nl`
3. Laat root/publiek alleen de publieke startflows serveren
4. Zet op app/admin edge-auth vóórdat HTML wordt geserveerd
5. Gebruik korte admin-sessies en MFA

### Backend-regels die nog server-side bevestigd moeten worden
- private RPC's moeten geldige player-sessie eisen
- admin RPC's moeten geldige admin-sessie eisen
- scope (`friends`/`family`) moet server-side worden afgedwongen
- gevoelige JSON-responses ook `Cache-Control: no-store`

## Deploy-volgorde
1. Upload de bestanden uit de v330-flat-zip
2. Zorg dat je host `_headers` ondersteunt; anders dezelfde headers via hostingregels instellen
3. Gebruik `DEPLOY_ALLOWLIST_v330.txt` om publieke deploy te beperken
4. Verplaats private/admin routes naar edge-beschermde hostnames
5. Test daarna anoniem, als gewone gebruiker en als admin
