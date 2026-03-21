# Hosting plan for kalenel.nl

## Easiest path: GitHub Pages
Because this site is static HTML/CSS/JS, GitHub Pages is enough.

### 1. Push the repo to GitHub
Keep the site files in the repo root, or in a `/docs` folder.

### 2. Enable Pages
In the GitHub repo settings, enable Pages and publish from:
- `main` branch
- `/root` or `/docs`

### 3. Add the custom domain
In GitHub Pages settings, set the custom domain to:
- `kalenel.nl`

Also create a file named `CNAME` in the published folder with exactly:
- `kalenel.nl`

### 4. Set DNS at your domain registrar
Create these records:

For the root domain:
- `A` → `185.199.108.153`
- `A` → `185.199.109.153`
- `A` → `185.199.110.153`
- `A` → `185.199.111.153`

For www:
- `CNAME` → `<your-github-username>.github.io`

### 5. Redirect `www`
Either:
- set `www.kalenel.nl` as a CNAME to GitHub Pages too, or
- redirect `www.kalenel.nl` to `kalenel.nl`

### 6. Wait for DNS
DNS can take a while to propagate.

## Good alternative: Cloudflare Pages
Also very good for static sites. Connect the GitHub repo, deploy automatically on push, then point `kalenel.nl` to Cloudflare Pages with the DNS records Cloudflare gives you.

## Recommendation
For this project, GitHub Pages is the simplest if you just want the site live fast.

## Fastest premium option: Vercel
Connect the GitHub repo to Vercel, keep the site in the repo root, and add `kalenel.nl` as the production domain. For this static site, Vercel usually needs no build command.
