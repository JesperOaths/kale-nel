(function(){
  var TOKEN_KEYS=['jas_session_token_v11','jas_session_token_v10'];
  var ACTIVITY_KEY='jas_last_activity_at_v1';
  var IDLE_MS=12*60*60*1000;
  function getToken(){
    for(var i=0;i<TOKEN_KEYS.length;i++){
      var k=TOKEN_KEYS[i];
      var v=localStorage.getItem(k)||sessionStorage.getItem(k);
      if(v) return v;
    }
    return '';
  }
  function lastActivity(){
    var raw=localStorage.getItem(ACTIVITY_KEY)||sessionStorage.getItem(ACTIVITY_KEY)||'';
    var n=Number(raw||0);
    return Number.isFinite(n)?n:0;
  }
  function clearTokens(){
    TOKEN_KEYS.forEach(function(k){ localStorage.removeItem(k); sessionStorage.removeItem(k); });
    localStorage.removeItem(ACTIVITY_KEY); sessionStorage.removeItem(ACTIVITY_KEY);
  }
  function expired(){
    var token=getToken();
    if(!token) return true;
    var last=lastActivity();
    if(!last) return false;
    return (Date.now()-last)>IDLE_MS;
  }
  function isFamily(){
    try{
      var qs=new URLSearchParams(location.search);
      if(qs.get('scope')==='family') return true;
    }catch(_){}
    return (location.pathname||'').indexOf('/familie/')!==-1;
  }
  function homeUrl(){
    var family=isFamily();
    var path=(location.pathname||'');
    var home=path.indexOf('/familie/')!==-1 ? '../home.html' : './home.html';
    return family ? (home + (home.indexOf('?')===-1?'?':'&') + 'scope=family') : home;
  }
  if(expired()) clearTokens();
  if(!getToken()){
    try{ document.documentElement.style.display='none'; }catch(_){ }
    location.replace(homeUrl());
  }
})();
