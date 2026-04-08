(function(){
  const links = [
    { href:'./admin.html', label:'Adminhub' },
    { href:'./admin_claims.html', label:'Claims' },
    { href:'./match_control.html', label:'Wedstrijden' },
    { href:'./match_swap.html', label:'Speler vervangen' },
    { href:'./admin_push.html', label:'Notificaties' },
    { href:'./leaderboard.html', label:'Klaverjas' },
    { href:'./boerenbridge_vault.html', label:'Boerenbridge' },
    { href:'./beerpong_vault.html', label:'Beerpong' },
    { href:'./index.html', label:'Home' }
  ];
  function mount(){
    if(document.getElementById('gejastAdminTopNav')) return;
    const nav=document.createElement('nav');
    nav.id='gejastAdminTopNav';
    nav.style.cssText='position:sticky;top:10px;z-index:9998;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin:0 auto 16px;max-width:1200px';
    nav.innerHTML = links.map((link)=>`<a href="${link.href}" style="text-decoration:none;padding:9px 13px;border-radius:999px;background:rgba(17,17,17,.88);color:#f3e3a6;border:1px solid rgba(212,175,55,.35);font:800 12px/1 Inter,system-ui,sans-serif;box-shadow:0 10px 22px rgba(0,0,0,.12)">${link.label}</a>`).join('');
    document.body.insertBefore(nav, document.body.firstChild);
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', mount, {once:true}); }
  else mount();
})();