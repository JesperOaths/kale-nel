#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DEFAULT_URL = 'https://kalenel.nl/league/';
const url = String(process.env.KALENEL_LEAGUE_SMOKE_URL || '').trim();
const timeoutMs = Number(process.env.KALENEL_LEAGUE_SMOKE_TIMEOUT_MS || 20000);

const REQUIRED_PUBLIC_COPY = [
  'No Kalenel login required',
  'Riot API key is session-only',
  'Riot API key is never saved',
  'Choose a player to review',
];

function assertPublicLeagueMarkup(html, sourceLabel) {
  assert.match(html, /<main[^>]+id=["']league-main["']/i, `${sourceLabel} must render the League main landmark`);
  for (const copy of REQUIRED_PUBLIC_COPY) {
    assert.ok(html.includes(copy), `${sourceLabel} must include public/session-only copy: ${copy}`);
  }
  assert.ok(!/gejast-(auth|home)-gate\.js/i.test(html), `${sourceLabel} must not load private Kalenel login gates`);
  assert.ok(!/requireMatchEntrySession|jas_session_token|x-gejast-session/i.test(html), `${sourceLabel} must not require private Kalenel sessions`);
  assert.ok(!/login\.html/i.test(html), `${sourceLabel} must not point the League page at login.html`);
  assert.match(html, /<input[^>]+id=["']riotApiKey["'][^>]+type=["']password["']/i, `${sourceLabel} must keep the Riot key field password-only`);
  assert.match(html, /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*index,follow/i, `${sourceLabel} must stay publicly indexable`);
}

function assetPaths(html) {
  return [...html.matchAll(/(?:src|href)=["']([^"']*\/league\/(?:app\.js|styles\.css)[^"']*)["']/gi)].map((m) => m[1]);
}

async function fetchText(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, { signal: controller.signal, redirect: 'manual' });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(timer);
  }
}

async function assertLivePage(targetUrl) {
  const { res, text } = await fetchText(targetUrl);
  assert.equal(res.status, 200, `live /league/ must return HTTP 200, got ${res.status}`);
  assert.match(res.headers.get('content-type') || '', /text\/html/i, 'live /league/ must return HTML');
  assertPublicLeagueMarkup(text, `live ${targetUrl}`);

  const paths = assetPaths(text);
  assert.ok(paths.some((p) => /app\.js/i.test(p)), 'live /league/ must reference its app.js asset');
  assert.ok(paths.some((p) => /styles\.css/i.test(p)), 'live /league/ must reference its styles.css asset');
  for (const path of paths) {
    const assetUrl = new URL(path, targetUrl).toString();
    const { res: assetRes } = await fetchText(assetUrl);
    assert.equal(assetRes.status, 200, `live asset must load: ${assetUrl}`);
  }
}

const localHtml = fs.readFileSync('league/index.html', 'utf8');
assertPublicLeagueMarkup(localHtml, 'local league/index.html');

if (url) {
  await assertLivePage(url === '1' ? DEFAULT_URL : url);
  console.log(`League public page smoke PASS (${url === '1' ? DEFAULT_URL : url})`);
} else {
  console.log('League public page smoke PASS (local markup; set KALENEL_LEAGUE_SMOKE_URL=1 for live HTTP checks)');
}
