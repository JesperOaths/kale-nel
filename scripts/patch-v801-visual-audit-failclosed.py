from pathlib import Path

p=Path('scripts/full-live-visual-audit-v792.mjs')
s=p.read_text()

def one(old,new,label):
    global s
    if s.count(old)!=1:
        raise SystemExit(f'{label}: expected 1 match, got {s.count(old)}')
    s=s.replace(old,new,1)

one(
"const siteScope = String(process.env.GEJAST_SITE_SCOPE || 'friends').trim() || 'friends';",
"const siteScope = String(process.env.GEJAST_SITE_SCOPE || 'friends').trim() || 'friends';\nconst profileTarget = String(process.env.GEJAST_VISUAL_PROFILE_TARGET || 'Antoni').trim() || 'Antoni';",
'profile target env')
one(
"[`player.html?player=${encodeURIComponent(name1)}&game=klaverjas&scope=${encodeURIComponent(siteScope)}`, 'context__player__klaverjas'],",
"[`player.html?player=${encodeURIComponent(profileTarget)}&game=klaverjas&scope=${encodeURIComponent(siteScope)}`, 'context__player__klaverjas'],",
'profile route')
one(
"""  if (state.pikkenId) {
    routes.push([`pikken.html?game_id=${encodeURIComponent(state.pikkenId)}`, 'context__pikken__lobby']);
    routes.push([`pikken_live.html?game_id=${encodeURIComponent(state.pikkenId)}`, 'context__pikken__live']);""",
"""  if (state.pikkenId) {
    routes.push([`pikken_live.html?game_id=${encodeURIComponent(state.pikkenId)}`, 'context__pikken__live']);""",
'invalid Pikken lobby context')
one(
"""  console.log(`RESULT=FULL_LIVE_VISUAL_AUDIT_COMPLETE tracked=${trackedHtml.length} screenshots=${records.length} broken=${counts.broken || 0} warn=${counts.warn || 0} protected=${counts.protected || 0} pass=${counts.pass || 0}`);
}""",
"""  console.log(`RESULT=FULL_LIVE_VISUAL_AUDIT_COMPLETE tracked=${trackedHtml.length} screenshots=${records.length} broken=${counts.broken || 0} warn=${counts.warn || 0} protected=${counts.protected || 0} pass=${counts.pass || 0}`);
  if ((counts.broken || 0) > 0) {
    console.error(`FULL_LIVE_VISUAL_AUDIT_FAIL broken=${counts.broken}`);
    process.exitCode = 1;
  }
  return counts;
}""",
'fail closed on broken')
p.write_text(s)

p=Path('check-v801-full-visual-audit-auth-context.mjs')
s=p.read_text()
insert="""
assert.match(runner, /GEJAST_VISUAL_PROFILE_TARGET \|\| 'Antoni'/, 'context profile capture must use a visible profile target rather than the hidden audit identity');
assert.doesNotMatch(runner, /context__pikken__lobby/, 'invalid Pikken game_id lobby variant must not return');
assert.match(runner, /process\.exitCode = 1/, 'visual audit must fail the workflow when broken pages are recorded');
assert.match(runner, /FULL_LIVE_VISUAL_AUDIT_FAIL broken=/, 'visual audit must expose an explicit broken-page failure marker');
"""
marker="assert.doesNotMatch(runner, /const context = await newContext\\(browser\\);\\s*try \\{\\s*let index = 0;/s, 'single shared authenticated context must not return');\n"
if marker not in s:
    raise SystemExit('checker insertion marker missing')
s=s.replace(marker,marker+insert,1)
p.write_text(s)
