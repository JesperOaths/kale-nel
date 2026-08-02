import fs from 'node:fs';
import { chromium, firefox } from 'playwright';

const target = 'https://admin.kalenel.nl/admin.html';
const maxNavigations = 15;

async function traceBrowser(name, browserType) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await context.clearCookies();
  const page = await context.newPage();
  const events = [];
  const mainRequests = new Set();
  let navCount = 0;
  let cycle = false;
  const seenMainUrls = new Map();

  page.on('request', (request) => {
    const frame = request.frame();
    const isMain = frame === page.mainFrame() && request.resourceType() === 'document';
    const row = {
      event: 'request',
      browser: name,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      isMainDocument: isMain,
      requestCookies: request.headers()['cookie'] || '',
      initiatorType: request.resourceType() === 'document' ? 'document/navigation' : request.resourceType(),
      redirectedFrom: request.redirectedFrom()?.url() || '',
      redirectedTo: request.redirectedTo()?.url() || ''
    };
    events.push(row);
    if (isMain) {
      mainRequests.add(request);
      navCount += 1;
      const previous = seenMainUrls.get(request.url()) || 0;
      seenMainUrls.set(request.url(), previous + 1);
      if (previous > 0 || navCount > maxNavigations) {
        cycle = true;
        page.close().catch(() => {});
      }
    }
  });

  page.on('response', async (response) => {
    const request = response.request();
    const isMain = mainRequests.has(request);
    const headers = response.headers();
    events.push({
      event: 'response',
      browser: name,
      url: response.url(),
      status: response.status(),
      isMainDocument: isMain,
      location: headers.location || '',
      setCookie: headers['set-cookie'] || '',
      fromServiceWorker: response.fromServiceWorker(),
      requestCookies: request.headers()['cookie'] || '',
      initiatorType: request.redirectedFrom() ? 'HTTP redirect' : (isMain ? 'document/navigation' : request.resourceType()),
      redirectedFrom: request.redirectedFrom()?.url() || '',
      redirectedTo: request.redirectedTo()?.url() || ''
    });
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      events.push({ event: 'framenavigated', browser: name, url: frame.url(), isMainDocument: true });
    }
  });

  page.on('console', (message) => {
    events.push({ event: 'console', browser: name, type: message.type(), text: message.text() });
  });
  page.on('pageerror', (error) => {
    events.push({ event: 'pageerror', browser: name, message: error.message });
  });

  let outcome = 'unknown';
  let finalUrl = '';
  try {
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    finalUrl = page.url();
    outcome = response ? `goto resolved status ${response.status()}` : 'goto resolved without response';
  } catch (error) {
    outcome = `goto/page error: ${error.message}`;
    finalUrl = page.url();
  }

  const content = await page.content().catch(() => '');
  const title = await page.title().catch(() => '');
  await browser.close().catch(() => {});

  const mainChain = events.filter((event) => event.isMainDocument || event.event === 'framenavigated');
  return {
    browser: name,
    target,
    outcome,
    finalUrl,
    cycle,
    navCount,
    title,
    hasOuterLoginGate: content.includes('Admin login vereist'),
    hasGithubLoginLink: content.includes('Login met GitHub'),
    hasInnerTotpLock: content.includes('Google Authenticator-code') || content.includes('totpInput'),
    mainChain,
    events
  };
}

const results = [];
for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  try {
    results.push(await traceBrowser(name, type));
  } catch (error) {
    results.push({ browser: name, target, fatal: error.message, stack: error.stack });
  }
}

fs.writeFileSync('ADMIN_BROWSER_NAV_TRACE_20260801.json', `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results.map((result) => ({ browser: result.browser, fatal: result.fatal, outcome: result.outcome, finalUrl: result.finalUrl, cycle: result.cycle, navCount: result.navCount, title: result.title, hasOuterLoginGate: result.hasOuterLoginGate, hasGithubLoginLink: result.hasGithubLoginLink, hasInnerTotpLock: result.hasInnerTotpLock, mainChain: result.mainChain })), null, 2));
