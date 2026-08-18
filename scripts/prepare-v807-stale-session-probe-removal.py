from pathlib import Path
import json, subprocess

# 1) Analytics: canonicalize player profile lookup.
p=Path('site-analytics.js')
s=p.read_text()
old="""        const data = await rpc('get_public_state', { session_token: playerToken });
        if (data && data.my_name) {
          profile.player_name = data.my_name;
          profile.is_logged_in = true;
        }
"""
new="""        const data = await rpc('account_public_state_v687', {
          session_token: playerToken,
          session_token_input: playerToken,
          site_scope_input: (() => { try { return new URLSearchParams(location.search || '').get('scope') === 'family' ? 'family' : 'friends'; } catch (_) { return 'friends'; } })()
        });
        const playerName = data && (data.my_name || data.display_name || data.player_name || data.viewer?.display_name || data.player?.display_name || '');
        if (data && data.ok === true && playerName) {
          profile.player_name = playerName;
          profile.is_logged_in = true;
          profile.site_scope = data.site_scope === 'family' ? 'family' : 'friends';
        }
"""
if old not in s: raise SystemExit('site-analytics stale lookup target missing')
p.write_text(s.replace(old,new,1))

# 2) Player session UI: one canonical scope-aware viewer lookup, no legacy probe fan-out.
p=Path('gejast-player-session-ui.js')
s=p.read_text()
start=s.index('  async function fetchViewer(token){')
end=s.index('\n\r\n  async function fetchCoins(token){', start) if '\n\r\n  async function fetchCoins(token){' in s[start:] else s.index('\n  async function fetchCoins(token){', start)
new_block="""  async function fetchViewer(token){
    if (!token || !SUPABASE_URL || !SUPABASE_KEY) return null;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/account_public_state_v687`, {
        method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(),
        body: JSON.stringify({ session_token: token, session_token_input: token, site_scope_input: inferScope() })
      });
      const data = await parseJson(res);
      const responseScope = String(data?.site_scope || '').trim().toLowerCase() === 'family' ? 'family' : 'friends';
      const name = data?.my_name || data?.display_name || data?.player_name || data?.viewer?.display_name || data?.player?.display_name || '';
      if (data?.ok !== true || responseScope !== inferScope() || !name) return null;
      return {
        name,
        avatar: data?.my_avatar_url || data?.avatar_url || data?.viewer?.avatar_url || data?.player?.avatar_url || '',
        coins: Number(data?.caute_coins ?? data?.coin_balance ?? data?.viewer?.caute_coins ?? data?.viewer?.coin_balance ?? 0) || 0,
        profileHref: './my_profile.html'
      };
    } catch (_) {
      return null;
    }
  }
"""
s=s[:start]+new_block+s[end:]
p.write_text(s)

# 3) Klaverjas scorer corner: canonicalize current player name lookup.
p=Path('scorer.html')
s=p.read_text()
old="""  async function fetchMyName(token){
    if (!token || !SUPABASE_URL || !SUPABASE_KEY) return '';
    const payload = JSON.stringify({ session_token: token });
    for (const rpc of ['get_public_state','get_gejast_homepage_state','get_jas_app_state']){
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: payload });
        const data = await res.json().catch(()=>null);
        if (!res.ok) continue;
        const name = data?.my_name || data?.display_name || data?.player_name || '';
        if (name) return name;
      } catch (_) {}
    }
    return '';
  }
"""
new="""  async function fetchMyName(token){
    if (!token || !SUPABASE_URL || !SUPABASE_KEY) return '';
    try {
      const scope = (() => { try { return new URLSearchParams(location.search || '').get('scope') === 'family' ? 'family' : 'friends'; } catch (_) { return 'friends'; } })();
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/account_public_state_v687`, {
        method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(),
        body: JSON.stringify({ session_token: token, session_token_input: token, site_scope_input: scope })
      });
      const data = await res.json().catch(()=>null);
      if (!res.ok || data?.ok !== true) return '';
      const responseScope = String(data?.site_scope || '').trim().toLowerCase() === 'family' ? 'family' : 'friends';
      if (responseScope !== scope) return '';
      return data?.my_name || data?.display_name || data?.player_name || data?.viewer?.display_name || data?.player?.display_name || '';
    } catch (_) {
      return '';
    }
  }
"""
if old not in s: raise SystemExit('scorer stale fetchMyName block missing')
p.write_text(s.replace(old,new,1))

# 4) Make the v806 canonical runtime guard durable for newer releases.
p=Path('check-v806-canonical-session-runtime.mjs')
s=p.read_text()
s=s.replace("const version=fs.readFileSync('VERSION','utf8').trim();\nif(version!=='v806') throw new Error(`Expected v806, got ${version}`);", "const version=fs.readFileSync('VERSION','utf8').trim();\nconst versionNumber=Number(version.match(/^v(\\d+)$/)?.[1]||0);\nif(versionNumber<806) throw new Error(`Expected v806+, got ${version}`);")
p.write_text(s)

# 5) Permanent active-caller regression.
checker="""#!/usr/bin/env node
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\d+)$/)?.[1]||0);
if(n<807) throw new Error(`Expected v807+, got ${version}`);
const analytics=fs.readFileSync('site-analytics.js','utf8');
const ui=fs.readFileSync('gejast-player-session-ui.js','utf8');
const scorer=fs.readFileSync('scorer.html','utf8');
const failures=[];
function between(text,a,b){const i=text.indexOf(a);const j=text.indexOf(b,i+a.length);if(i<0||j<0)throw new Error(`missing block ${a}`);return text.slice(i,j);}
const analyticsBlock=between(analytics,'  async function resolveProfile(){','\n  const visitorId');
const uiBlock=between(ui,'  async function fetchViewer(token){','  async function fetchCoins(token){');
const scorerBlock=between(scorer,'  async function fetchMyName(token){','  function show(');
for(const [label,block] of [['site-analytics resolveProfile',analyticsBlock],['player-session-ui fetchViewer',uiBlock],['scorer fetchMyName',scorerBlock]]){
  if(block.includes('get_public_state')) failures.push(`${label} still calls get_public_state`);
  if(block.includes('get_gejast_homepage_state')) failures.push(`${label} still calls get_gejast_homepage_state`);
  if(block.includes('get_jas_app_state')) failures.push(`${label} still calls get_jas_app_state`);
  if(!block.includes('account_public_state_v687')) failures.push(`${label} missing canonical account_public_state_v687`);
  if(!block.includes('session_token_input')) failures.push(`${label} missing canonical token payload`);
  if(!block.includes('site_scope_input')) failures.push(`${label} missing scope payload`);
}
if(failures.length){console.error('v807 active stale-session probe regression failed:');for(const f of failures)console.error('- '+f);process.exit(1);}
console.log('PASS v807 active session callers use only canonical account_public_state_v687');
"""
Path('check-v807-active-session-callers.mjs').write_text(checker)

# 6) Version/cachebuster/watermark synchronization.
Path('VERSION').write_text('v807\n')
subprocess.run(['node','fix-version-drift.mjs'],check=True)

# 7) Keep safety/readiness/gameplay metadata truthful while v807 awaits fresh live proof.
p=Path('beta-live-write-checklist.json'); checklist=json.loads(p.read_text());
if checklist.get('items')!=[]: raise SystemExit('refusing v807 build: live-write checklist armed')
checklist['site_version']='v807'; p.write_text(json.dumps(checklist,indent=2,ensure_ascii=False)+'\n')

p=Path('beta-readiness.json'); r=json.loads(p.read_text()); r['site_version']='release candidate v807 / live v806 / certified rollback v805'; r['last_updated']='2026-08-18'; d=r.setdefault('deployment_identity',{}); d['status']='ready_to_test'; d['live_version']='v806'; d['release_candidate_version']='v807'; d['frontend_release_merge']='87fa814d28c00035b770c0ff8959def27a00f059'; d['repository_head_at_audit']='87fa814d28c00035b770c0ff8959def27a00f059'; d['note']='v807 is a release candidate over live v806; certified rollback remains v805 b64a116f2b2684d1fbd475b40c2b76f569d40942. v807 removes the three active stale get_public_state session callers proven by v806 Family diagnostic run 32099711741. Fresh exact-current health, owner isolation, deep gameplay, authenticated Family runtime/visual/manual review and zero-residue proof are required before PASS.'; p.write_text(json.dumps(r,indent=2,ensure_ascii=False)+'\n')

p=Path('gameplay-acceptance.json'); g=json.loads(p.read_text()); g['site_version']='v807'; g['last_updated']='2026-08-18'; p.write_text(json.dumps(g,indent=2,ensure_ascii=False)+'\n')

p=Path('release-certification.json'); old=json.loads(p.read_text()); cert={
  'schema_version':1,'current_version':'v807','status':'REVALIDATION_REQUIRED',
  'previous_certified_version':'v805','previous_certified_product_sha':'b64a116f2b2684d1fbd475b40c2b76f569d40942',
  'previous_certified_release_branch':'release/v805-certified-20260818','previous_certified_tag':'v805-certified-20260818',
  'superseded_uncertified_version':'v806','superseded_uncertified_product_sha':'87fa814d28c00035b770c0ff8959def27a00f059',
  'reason':'v807 removes three active stale frontend session probes discovered during strict v806 Family certification; fresh exact-current evidence is required before PASS.',
  'remaining_release_blockers':['Fresh exact-current v807 live health must pass.','Fresh exact-current v807 owner isolation and deep gameplay must pass.','Targeted Family runtime must show zero get_public_state calls.','Fresh authenticated v807 visual audit plus manual screenshot review must pass.','Controlled production fixtures must be independently verified at zero residue.'],
  'required_next':['Merge only after canonical verification.','Run exact-current v807 health, owner isolation and deep live.','Run Family stale-RPC trace and full authenticated visual audit.','Manually review all screenshots and independently prove zero residue before setting PASS.'],
  'previous_certification_snapshot':old.get('previous_certification_snapshot',{})
}; p.write_text(json.dumps(cert,indent=2,ensure_ascii=False)+'\n')

# Wire new regression directly after the durable v806 runtime guard.
p=Path('package.json'); data=json.loads(p.read_text()); script=data['scripts']['verify:static']; anchor='node check-v806-canonical-session-runtime.mjs';
if anchor not in script: raise SystemExit('verify:static v806 anchor missing')
script=script.replace(anchor,anchor+' && node check-v807-active-session-callers.mjs',1); data['scripts']['verify:static']=script; p.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
print('v807 stale session caller patch staged')
