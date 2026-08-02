import { chromium, firefox } from 'playwright';

const target = 'https://admin.kalenel.nl/admin.html';
for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  const browser = await type.launch({ headless: true });
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const response = await page.goto(target, { waitUntil: 'load', timeout: 20000 });
  await page.screenshot({ path: `ADMIN_${name.toUpperCase()}_FRESH_ADMINHTML_20260801.png`, fullPage: true });
  console.log(`${name}: ${response?.status()} ${page.url()} ${await page.title()}`);
  await browser.close();
}
