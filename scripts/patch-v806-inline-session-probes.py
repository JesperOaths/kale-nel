from pathlib import Path

# home.html: replace six legacy state attempts with one canonical account-state call.
p=Path('home.html'); s=p.read_text()
start=s.index('      async function validateToken(token){')
end=s.index('\n      if (cfg.isPlayerSessionExpired', start)
new="""      async function validateToken(token){
        if (!token || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return false;
        try {
          const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/account_public_state_v687`, {
            method:'POST', mode:'cors', cache:'no-store', headers:rpcHeaders(),
            body:JSON.stringify({ session_token:token, session_token_input:token, site_scope_input:family?'family':'friends' })
          });
          const data = await parseResponse(res);
          return !!(data && data.ok === true);
        } catch (_) { return false; }
      }"""
p.write_text(s[:start]+new+s[end:])

# scorer.html: player chip identity uses the same canonical account-state contract.
p=Path('scorer.html'); s=p.read_text()
start=s.index('  async function fetchMyName(token){')
end=s.index('\n  function show(name)', start)
new="""  async function fetchMyName(token){
    if (!token || !SUPABASE_URL || !SUPABASE_KEY) return '';
    try {
      const scope = window.GEJAST_SCOPE_UTILS?.getScope?.() || (new URLSearchParams(location.search||'').get('scope')==='family'?'family':'friends');
      const payload = JSON.stringify({ session_token:token, session_token_input:token, site_scope_input:scope });
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/account_public_state_v687`, { method:'POST', mode:'cors', cache:'no-store', headers:rpcHeaders(), body:payload });
      const data = await res.json().catch(()=>null);
      if (!res.ok || data?.ok !== true) return '';
      return data?.my_name || data?.display_name || data?.player_name || data?.viewer?.display_name || data?.player?.display_name || '';
    } catch (_) { return ''; }
  }"""
p.write_text(s[:start]+new+s[end:])

print('PASS patched remaining inline session probes')
