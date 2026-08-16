from pathlib import Path

p=Path('scripts/full-live-visual-audit-v792.mjs')
s=p.read_text()

def replace_once(old,new,label):
    global s
    if s.count(old)!=1:
        raise SystemExit(f'{label}: expected exactly one match, got {s.count(old)}')
    s=s.replace(old,new,1)

replace_once(
"""const token2 = String(process.env.GEJAST_PLAYER2_TOKEN || '').trim();
const name1 = String(process.env.GEJAST_PLAYER1_NAME || '').trim();
const name2 = String(process.env.GEJAST_PLAYER2_NAME || '').trim();
const siteScope = String(process.env.GEJAST_SITE_SCOPE || 'friends').trim() || 'friends';""",
"""const token2 = String(process.env.GEJAST_PLAYER2_TOKEN || '').trim();
const familyToken = String(process.env.GEJAST_FAMILY_TOKEN || '').trim();
const name1 = String(process.env.GEJAST_PLAYER1_NAME || '').trim();
const name2 = String(process.env.GEJAST_PLAYER2_NAME || '').trim();
const familyName = String(process.env.GEJAST_FAMILY_NAME || '').trim();
const siteScope = String(process.env.GEJAST_SITE_SCOPE || 'friends').trim() || 'friends';""",
'env declarations')
replace_once(
"if (!token1 || !token2 || !name1 || !name2) throw new Error('Two disposable visual-audit sessions/names are required');",
"if (!token1 || !token2 || !familyToken || !name1 || !name2 || !familyName) throw new Error('Two Friends sessions plus one Family visual-audit session/name are required');",
'env requirement')
replace_once(
"const safe = (value) => String(value?.message || value || 'unknown').replaceAll(token1, '[TOKEN1]').replaceAll(token2, '[TOKEN2]');",
"const safe = (value) => String(value?.message || value || 'unknown').replaceAll(token1, '[TOKEN1]').replaceAll(token2, '[TOKEN2]').replaceAll(familyToken, '[FAMILY_TOKEN]');",
'safe masking')

old_new_context="""async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(({ tokenValue, paardCode }) => {
    localStorage.setItem('jas_session_token_v11', tokenValue);
    localStorage.setItem('jas_session_token_v10', tokenValue);
    localStorage.setItem('jas_last_activity_at_v1', String(Date.now()));
    if (paardCode) {
      localStorage.setItem('gejast_paardenrace_room_code_v687', paardCode);
      localStorage.setItem('gejast_paardenrace_room_code_v506', paardCode);
    }
  }, { tokenValue: token1, paardCode: state.paardenCode });
  return context;
}"""
new_new_context="""async function newContext(browser, tokenValue = token1, paardCode = '') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(({ sessionToken, savedPaardCode }) => {
    for (const store of [localStorage, sessionStorage]) {
      store.setItem('jas_session_token_v11', sessionToken);
      store.setItem('jas_session_token_v10', sessionToken);
      store.setItem('jas_last_activity_at_v1', String(Date.now()));
    }
    if (savedPaardCode) {
      localStorage.setItem('gejast_paardenrace_room_code_v687', savedPaardCode);
      localStorage.setItem('gejast_paardenrace_room_code_v506', savedPaardCode);
    }
  }, { sessionToken: tokenValue, savedPaardCode: paardCode });
  return context;
}"""
replace_once(old_new_context,new_new_context,'newContext')

replace_once(
"""    response = await page.goto(routeUrl(route), { waitUntil: 'domcontentloaded', timeout });
    await page.waitForTimeout(settleMs);""",
"""    response = await page.goto(routeUrl(route), { waitUntil: 'domcontentloaded', timeout });
    if (kind === 'context') {
      await page.waitForFunction(() => document.documentElement.getAttribute('data-gejast-auth-state') === 'authenticated', null, { timeout: Math.min(timeout, 12000) }).catch(() => {});
    }
    await page.waitForTimeout(settleMs);""",
'context auth settle')

replace_once(
"""  const status = response?.status() || 0;
  const finalUrl = page.url();
  const title = await page.title().catch(() => '');""",
"""  const status = response?.status() || 0;
  const finalUrl = page.url();
  let finalPath = '';
  try { finalPath = new URL(finalUrl).pathname; } catch {}
  const authState = await page.evaluate(() => document.documentElement.getAttribute('data-gejast-auth-state') || '').catch(() => '');
  const title = await page.title().catch(() => '');""",
'auth state capture')

replace_once(
"""  if (signals.length) { judgement = 'broken'; reasons.push(`visible runtime signal: ${signals.join(', ')}`); }
  if (seriousConsole.length && judgement !== 'broken') { judgement = 'warn'; reasons.push(`${seriousConsole.length} console error(s)`); }""",
"""  if (signals.length) { judgement = 'broken'; reasons.push(`visible runtime signal: ${signals.join(', ')}`); }
  if (kind === 'context' && finalPath === '/login.html') { judgement = 'broken'; reasons.push('contextual authenticated capture ended at login'); }
  if (kind === 'context' && authState !== 'authenticated') { judgement = 'broken'; reasons.push(`contextual auth state is ${authState || 'missing'}, expected authenticated`); }
  if (seriousConsole.length && judgement !== 'broken') { judgement = 'warn'; reasons.push(`${seriousConsole.length} console error(s)`); }""",
'context auth judgement')

replace_once(
"""    title,
    elapsed_ms: Date.now() - started,""",
"""    title,
    auth_state: authState,
    elapsed_ms: Date.now() - started,""",
'record auth state')

replace_once(
"""  const routes = [
    ['ladder.html?game=klaverjas', 'context__ladder__klaverjas'],""",
"""  const routes = [
    ['index.html', 'context__index__authenticated'],
    ['ladder.html?game=klaverjas', 'context__ladder__klaverjas'],""",
'friends main context')

needle="""function writeReports() {"""
family_fn="""function contextualFamilyRoutes() {
  return [
    ['familie/index.html', 'context__family__index'],
    ['familie/ladder.html', 'context__family__ladder'],
    ['familie/leaderboard.html', 'context__family__leaderboard'],
    ['familie/profiles.html', 'context__family__profiles'],
    [`familie/player.html?player=${encodeURIComponent(familyName)}&scope=family`, 'context__family__player'],
    ['familie/boerenbridge.html', 'context__family__boerenbridge'],
    ['familie/scorer.html', 'context__family__scorer'],
  ];
}

function writeReports() {"""
replace_once(needle,family_fn,'family contextual routes')

old_main="""await setupContextRooms();
const browser = await chromium.launch({ headless: true });
const context = await newContext(browser);
try {
  let index = 0;
  for (const htmlPath of trackedHtml) {
    await capture(context, htmlPath, htmlPath, index++, 'tracked');
  }
  for (const [route, label] of contextualRoutes()) {
    await capture(context, route, label, index++, 'context');
  }
} finally {
  await context.close();
  await browser.close();
  writeReports();
}"""
new_main="""await setupContextRooms();
const browser = await chromium.launch({ headless: true });
try {
  let index = 0;
  for (const htmlPath of trackedHtml) {
    const familyRoute = htmlPath === 'familie.html' || htmlPath.startsWith('familie/');
    const context = await newContext(browser, familyRoute ? familyToken : token1, familyRoute ? '' : state.paardenCode);
    try { await capture(context, htmlPath, htmlPath, index++, 'tracked'); }
    finally { await context.close(); }
  }
  for (const [route, label] of contextualRoutes()) {
    const context = await newContext(browser, token1, state.paardenCode);
    try { await capture(context, route, label, index++, 'context'); }
    finally { await context.close(); }
  }
  for (const [route, label] of contextualFamilyRoutes()) {
    const context = await newContext(browser, familyToken, '');
    try { await capture(context, route, label, index++, 'context'); }
    finally { await context.close(); }
  }
} finally {
  await browser.close();
  writeReports();
}"""
replace_once(old_main,new_main,'isolated capture loop')

p.write_text(s)
print('patched full-live-visual-audit-v792.mjs')
