(function(){
  const PUBLIC=['home.html','login.html','request.html','activate.html','index.html','invite.html'];
  const LONG_ENTRY=['score.html','scorer.html','boerenbridge.html','beerpong.html','paardenrace.html','pikken.html'];
  function token(keys){for(const k of keys){try{const v=localStorage.getItem(k)||sessionStorage.getItem(k);if(v)return v;}catch(_){}}return '';}
  function pageName(){return (location.pathname.split('/').pop()||'index.html').toLowerCase();}
  function localSessionState(){const page=pageName();const admin=token(['jas_admin_session_v8','jas_admin_session_token','gejast_admin_session_token']);const player=token(['jas_session_token_v11','jas_session_token_v10']);const expected=page.startsWith('admin')?'admin':(PUBLIC.includes(page)?'public':'player');return{ok:true,page,is_public:PUBLIC.includes(page),is_long_entry_page:LONG_ENTRY.includes(page),has_admin_token:!!admin,has_player_token:!!player,expected_gate:expected,gate_satisfied:expected==='public'||(expected==='admin'?!!admin:!!player)};}
  function auditLoadedGateHelpers(){const scripts=Array.from(document.scripts||[]).map(s=>s.getAttribute('src')||s.src||'').filter(Boolean);return{ok:true,page:pageName(),has_home_gate:scripts.some(s=>/gejast-home-gate\.js/i.test(s)),has_scope_context:scripts.some(s=>/gejast-scope-context\.js/i.test(s)),has_gate_bootstrap:scripts.some(s=>/gejast-gate-bootstrap\.js/i.test(s)),scripts};}
  window.GEJAST_GATE_BOOTSTRAP={localSessionState,auditLoadedGateHelpers};
})();