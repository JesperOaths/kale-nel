#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const root = process.cwd();
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.webp', 'image/webp'], ['.svg', 'image/svg+xml']
]);
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': mime.get(path.extname(file)) || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const engines = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]];
const viewports = [['phone', { width: 390, height: 844 }], ['desktop', { width: 1366, height: 768 }]];
const routes = ['/scorer.html', '/familie/scorer.html'];
const failures = [];
let cases = 0;

for (const [engineName, engine] of engines) {
  const browser = await engine.launch({ headless: true });
  for (const [viewportName, viewport] of viewports) {
    for (const route of routes) {
      cases += 1;
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      await context.route('**/*', async (routeHandle) => {
        const request = routeHandle.request();
        const url = new URL(request.url());
        if (url.origin !== base) return routeHandle.abort('blockedbyclient');
        if (url.pathname === '/gejast-home-gate.js') {
          return routeHandle.fulfill({ status: 200, contentType: 'application/javascript', body: "document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');document.body&&document.body.classList.remove('boot-pending');" });
        }
        if (url.pathname === '/gejast-config.js') {
          const upstream = await routeHandle.fetch();
          const body = await upstream.text();
          return routeHandle.fulfill({ response: upstream, contentType: 'application/javascript', body: `${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};` });
        }
        if (!['GET', 'HEAD'].includes(request.method())) return routeHandle.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return routeHandle.continue();
      });
      page.on('pageerror', (err) => errors.push(String(err?.message || err)));
      try {
        await page.goto(`${base}${route}?proof=v788-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(400);
        const result = await page.evaluate(() => {
          const inspect = (selector, expectedId) => {
            const dialog = document.querySelector(selector);
            if (!dialog) return { exists: false };
            const labelledby = dialog.getAttribute('aria-labelledby') || '';
            const title = labelledby ? document.getElementById(labelledby) : null;
            return {
              exists: true,
              role: dialog.getAttribute('role'),
              modal: dialog.getAttribute('aria-modal'),
              labelledby,
              expectedId,
              titleExists: Boolean(title),
              titleText: (title?.textContent || '').replace(/\s+/g, ' ').trim(),
              titleInsideDialog: Boolean(title && dialog.contains(title))
            };
          };
          return {
            path: location.pathname,
            scope: new URLSearchParams(location.search).get('scope') || '',
            version: window.GEJAST_PAGE_VERSION || '',
            setup: inspect('#setupOverlay [role="dialog"]', 'setupDialogTitle'),
            bid: inspect('#bidModal', 'bidDialogTitle')
          };
        });
        const expectedScope = route.startsWith('/familie/') ? 'family' : '';
        const ok = result.path === '/scorer.html'
          && result.scope === expectedScope
          && result.version === 'v788'
          && result.setup.exists && result.setup.role === 'dialog' && result.setup.modal === 'true'
          && result.setup.labelledby === 'setupDialogTitle' && result.setup.titleExists && result.setup.titleInsideDialog
          && result.setup.titleText === 'Wie spelen er mee?'
          && result.bid.exists && result.bid.role === 'dialog' && result.bid.modal === 'true'
          && result.bid.labelledby === 'bidDialogTitle' && result.bid.titleExists && result.bid.titleInsideDialog
          && result.bid.titleText === 'Bieding voor ronde 1'
          && errors.length === 0;
        if (!ok) failures.push({ engineName, viewportName, route, result, errors });
        console.log(`V788_DIALOG_CASE ${engineName}/${viewportName}${route} ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(result)}`);
      } catch (error) {
        failures.push({ engineName, viewportName, route, fatal: String(error?.stack || error) });
      }
      await context.close();
    }
  }
  await browser.close();
}
server.close();

console.log(`V788_DIALOG_CASES=${cases}`);
console.log(`V788_DIALOG_FAILURES=${failures.length}`);
if (failures.length) {
  for (const failure of failures) console.error(`V788_DIALOG_FAIL ${JSON.stringify(failure)}`);
  process.exit(1);
}
console.log('V788_SCORER_DIALOG_BROWSER_PROOF=PASS');
