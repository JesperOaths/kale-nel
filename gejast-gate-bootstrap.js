(function(){
  const PUBLIC=['home.html','login.html','request.html','activate.html','index.html'];
  function token(keys){for(const k of keys){try{const v=localStorage.getItem(k)||sessionStorage.getItem(k); if(v) return v;}catch(_){}}return '';}
  function localSessionState(){const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();const admin=token(['jas_admin_session_v8','jas_admin_session_token','gejast_admin_session_token']);const player=token(['jas_session_token_v11','jas_session_token_v10']);return{ok:true,page,is_public:PUBLIC.includes(page),has_admin_token:!!admin,has_player_token:!!player,expected_gate:page.startsWith('admin')?'admin':(PUBLIC.includes(page)?'public':'player')};}
  window.GEJAST_GATE_BOOTSTRAP={localSessionState};
})();
