from pathlib import Path
import json
import subprocess

# Legacy home gate: delegate to canonical fail-closed gate when present.
p = Path('gejast-home-gate.js')
s = p.read_text()
anchor = "  var VERSION = 'v747';\n"
insert = """  var VERSION = 'v747';
  var root = document.documentElement;
  if (root && root.hasAttribute('data-gejast-auth-state')) {
    window.GEJAST_HOME_GATE = { VERSION: VERSION, delegated: 'gejast-auth-gate' };
    return;
  }
"""
if anchor not in s:
    raise SystemExit('home-gate delegation anchor missing')
s = s.replace(anchor, insert, 1)
old = """  async function fetchViewerState(token){
    var attempts=[['get_public_state',{session_token:token}],['get_public_state',{session_token_input:token}],['account_public_state_v687',{session_token_input:token}]];
    var hardInvalid=false;
    var checks = attempts.map(function(attempt){
      return rpc(attempt[0], attempt[1], 1500).then(function(data){
        if(validState(data)) return { ok:true, data:data };
        if(invalidState(data)) hardInvalid=true;
        return { ok:false, transient:true };
      }).catch(function(){ return { ok:false, transient:true }; });
    });
    try {
      var results = await Promise.all(checks);
      for(var i=0;i<results.length;i++){
        if(results[i] && results[i].ok) return results[i];
      }
    } catch(_) {}
    return hardInvalid ? { ok:false, hardInvalid:true } : { ok:false, transient:true };
  }
"""
new = """  async function fetchViewerState(token){
    try {
      var data = await rpc('account_public_state_v687', {
        session_token: token,
        session_token_input: token,
        site_scope_input: currentScope()
      }, 1800);
      var responseScope = String(data && data.site_scope || '').trim().toLowerCase() === 'family' ? 'family' : 'friends';
      if (validState(data) && responseScope === currentScope()) return { ok:true, data:data };
      if (invalidState(data)) return { ok:false, hardInvalid:true };
      return { ok:false, transient:true };
    } catch(_) {
      return { ok:false, transient:true };
    }
  }
"""
if old not in s:
    raise SystemExit('legacy viewer-state block missing')
p.write_text(s.replace(old, new, 1))

# Shared runtime: canonical server touch, canonical session snapshot, root asset URLs.
p = Path('gejast-config.js')
s = p.read_text()
if "fetch('./VERSION?ts=' + Date.now()" not in s:
    raise SystemExit('relative VERSION fetch target missing')
s = s.replace("fetch('./VERSION?ts=' + Date.now()", "fetch('/VERSION?ts=' + Date.now()", 1)

old = """  const payloads = [
    { input_token: token },
    { session_token: token },
    { token }
  ];
  for (const payload of payloads){
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? window.setTimeout(()=>{ try { controller.abort(); } catch (_) {} }, 4000) : null;
    try {
      const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/player_touch_session`, {
        method:'POST',
        mode:'cors',
        cache:'no-store',
        headers,
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
      if (res.ok) {
        const stamp = String(now);
        localStorage.setItem(CONFIG.PLAYER_LAST_SERVER_TOUCH_KEY, stamp);
        sessionStorage.setItem(CONFIG.PLAYER_LAST_SERVER_TOUCH_KEY, stamp);
        return data;
      }
      const raw = String((data && (data.message || data.error || data.hint)) || text || `HTTP ${res.status}`);
      if (!/schema cache|could not find the function|no function matches|does not exist|rpc/i.test(raw)) break;
    } catch (_) {
    } finally {
      if (timeout) window.clearTimeout(timeout);
    }
  }
  return null;
"""
new = """  const payload = {
    session_token: token,
    session_token_input: token,
    page_input: (location.pathname || '').split('/').pop() || null,
    site_scope_input: inferRuntimeScope()
  };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(()=>{ try { controller.abort(); } catch (_) {} }, 4000) : null;
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/player_touch_session`, {
      method:'POST',
      mode:'cors',
      cache:'no-store',
      headers,
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!res.ok) return null;
    const stamp = String(now);
    localStorage.setItem(CONFIG.PLAYER_LAST_SERVER_TOUCH_KEY, stamp);
    sessionStorage.setItem(CONFIG.PLAYER_LAST_SERVER_TOUCH_KEY, stamp);
    return data;
  } catch (_) {
    return null;
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
"""
if old not in s:
    raise SystemExit('touch session legacy payload block missing')
s = s.replace(old, new, 1)

start = s.index('async function fetchPlayerSessionSnapshot(token){')
end = s.index('function inferRuntimeScope()', start)
new_snapshot = """async function fetchPlayerSessionSnapshot(token){
  const value = String(token || '').trim();
  if (!value || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_PUBLISHABLE_KEY) return { status:'missing', state:null, aliases:[] };
  const headers = {
    'Content-Type':'application/json',
    apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY || '',
    Authorization:`Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY || ''}`,
    Accept:'application/json'
  };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(()=>{ try { controller.abort(); } catch (_) {} }, 4000) : null;
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/account_public_state_v687`, {
      method:'POST',
      mode:'cors',
      cache:'no-store',
      headers,
      body: JSON.stringify({
        session_token: value,
        session_token_input: value,
        site_scope_input: inferRuntimeScope()
      }),
      signal: controller ? controller.signal : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!res.ok) return { status:'unknown', state:null, aliases:[] };
    const aliases = playerSessionNamesFromState(data);
    if (data && data.ok === true) return { status:'valid', state:data, aliases };
    return { status:'invalid', state:data, aliases:[] };
  } catch (_) {
    return { status:'unknown', state:null, aliases:[] };
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
}
"""
s = s[:start] + new_snapshot + s[end:]

for old, new in {
    "script.src = `./gejast-site-announcements.js?${effectiveVersion}`;": "script.src = `/gejast-site-announcements.js?${effectiveVersion}`;",
    "script.src = `./gejast-scope-hardening.js?${effectiveVersion}`;": "script.src = `/gejast-scope-hardening.js?${effectiveVersion}`;",
    "script.src = `./gejast-v725-repair.js?${effectiveVersion}`;": "script.src = `/gejast-v725-repair.js?${effectiveVersion}`;",
}.items():
    if old not in s:
        raise SystemExit(f'root runtime path target missing: {old}')
    s = s.replace(old, new, 1)
p.write_text(s)

# Product version bump using the repository's established drift fixer.
Path('VERSION').write_text('v806\n')
subprocess.run(['node', 'fix-version-drift.mjs'], check=True)

checker = """#!/usr/bin/env node
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
if(version!=='v806') throw new Error(`Expected v806, got ${version}`);
const home=fs.readFileSync('gejast-home-gate.js','utf8');
const cfg=fs.readFileSync('gejast-config.js','utf8');
for(const needle of ["hasAttribute('data-gejast-auth-state')","delegated: 'gejast-auth-gate'","rpc('account_public_state_v687'",'session_token_input: token','site_scope_input: currentScope()']) if(!home.includes(needle)) throw new Error(`Home gate missing: ${needle}`);
if(/get_public_state/.test(home)) throw new Error('Legacy home gate reintroduced invalid get_public_state session probes');
const snapshot=cfg.slice(cfg.indexOf('async function fetchPlayerSessionSnapshot(token){'),cfg.indexOf('function inferRuntimeScope()',cfg.indexOf('async function fetchPlayerSessionSnapshot(token){')));
if(!snapshot.includes('/rest/v1/rpc/account_public_state_v687')) throw new Error('Session snapshot is not canonical account_public_state_v687');
for(const stale of ['get_public_state','get_gejast_homepage_state','get_jas_app_state']) if(snapshot.includes(stale)) throw new Error(`Session snapshot contains stale probe ${stale}`);
const touch=cfg.slice(cfg.indexOf('async function touchPlayerSessionServer(force){'),cfg.indexOf('function touchPlayerActivity(options)',cfg.indexOf('async function touchPlayerSessionServer(force){')));
for(const needle of ['session_token: token','session_token_input: token','page_input:','site_scope_input: inferRuntimeScope()']) if(!touch.includes(needle)) throw new Error(`Touch payload missing ${needle}`);
for(const stale of ['input_token:', '{ token }','const payloads = [']) if(touch.includes(stale)) throw new Error(`Touch path contains stale fallback ${stale}`);
for(const needle of ["fetch('/VERSION?ts=' + Date.now()",'script.src = `/gejast-site-announcements.js?${effectiveVersion}`;','script.src = `/gejast-scope-hardening.js?${effectiveVersion}`;','script.src = `/gejast-v725-repair.js?${effectiveVersion}`;']) if(!cfg.includes(needle)) throw new Error(`Root runtime path missing ${needle}`);
for(const stale of ['./gejast-site-announcements.js','./gejast-scope-hardening.js','./gejast-v725-repair.js',"fetch('./VERSION?ts='"]) if(cfg.includes(stale)) throw new Error(`Nested runtime path remains ${stale}`);
console.log('PASS v806 canonical session runtime and root asset contract');
"""
Path('check-v806-canonical-session-runtime.mjs').write_text(checker)

pkg = Path('package.json')
data = json.loads(pkg.read_text())
anchor = 'node check-v805-visual-response-diagnostics.mjs'
replacement = anchor + ' && node check-v806-canonical-session-runtime.mjs'
script = data['scripts']['verify:static']
if anchor not in script:
    raise SystemExit('verify:static insertion anchor missing')
data['scripts']['verify:static'] = script.replace(anchor, replacement, 1)
pkg.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')

print('V806 patch staged successfully')
