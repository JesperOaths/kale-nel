(function(){
  if (window.GEJAST_HOME_PROFILE_RUNTIME && window.GEJAST_HOME_PROFILE_RUNTIME.VERSION === 'v685') return;
  const cfg = window.GEJAST_CONFIG || {};
  const VERSION = 'v685';
  const RPC = {
    home:'get_homepage_runtime_bundle_v685',
    profiles:'get_profiles_runtime_bundle_v685',
    player:'get_player_runtime_bundle_v685',
    admin:'admin_get_home_profile_runtime_audit_v685'
  };
  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function num(v, digits=0){ const n=Number(v||0); return Number.isFinite(n) ? n.toFixed(digits).replace(/\.0+$/,'') : '0'; }
  function scope(){ try { if(window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope) return window.GEJAST_SCOPE_UTILS.getScope(); } catch(_){} try { return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch(_){} return 'friends'; }
  function playerSession(){ try { if(cfg.getPlayerSessionToken) return String(cfg.getPlayerSessionToken()||'').trim(); } catch(_){} return localStorage.getItem('jas_session_token_v11') || localStorage.getItem('jas_session_token_v10') || sessionStorage.getItem('jas_session_token_v11') || sessionStorage.getItem('jas_session_token_v10') || ''; }
  function adminSession(){ try { if(window.GEJAST_ADMIN_SESSION && window.GEJAST_ADMIN_SESSION.getToken) return String(window.GEJAST_ADMIN_SESSION.getToken()||'').trim(); } catch(_){} return localStorage.getItem('jas_admin_session_v8') || sessionStorage.getItem('jas_admin_session_v8') || ''; }
  function headers(){ return {'Content-Type':'application/json',apikey:cfg.SUPABASE_PUBLISHABLE_KEY||'',Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY||''}`,Accept:'application/json'}; }
  async function parse(res){ const txt=await res.text(); let data=null; try{ data=txt?JSON.parse(txt):null; }catch(_){ throw new Error(txt||`HTTP ${res.status}`); } if(!res.ok) throw new Error(data?.message||data?.error||data?.details||data?.hint||`HTTP ${res.status}`); return data && data[Object.keys(data)[0]] !== undefined && Object.keys(data).length===1 ? data[Object.keys(data)[0]] : data; }
  async function rpc(name, payload, timeoutMs){ if(!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase config ontbreekt.'); const fast = window.GEJAST_FAST_RUNTIME; const opts={method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(payload||{})}; const raw = fast && fast.fetchJson ? await fast.fetchJson(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, opts, timeoutMs||3200).then((data)=> data && data[Object.keys(data)[0]] !== undefined && Object.keys(data).length===1 ? data[Object.keys(data)[0]] : data) : await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`,opts).then(parse); return raw && raw[name] !== undefined ? raw[name] : raw; }
  function playerHref(name){ return `./player.html?player=${encodeURIComponent(name||'')}&scope=${encodeURIComponent(scope())}`; }
  function ladderHref(game){ if(game==='beerpong') return './beerpong.html'; if(game==='boerenbridge') return './ladder.html?game=boerenbridge'; return './leaderboard.html'; }
  function gameLabel(game){ return ({klaverjas:'Klaverjassen',klaverjassen:'Klaverjassen',boerenbridge:'Boerenbridge',beerpong:'Beerpong'}[String(game||'').toLowerCase()] || game || 'Spel'); }
  function bestName(row){ return row.player_name || row.display_name || row.public_display_name || row.name || row.nickname || 'Onbekend'; }
  function byArray(v){ if(Array.isArray(v)) return v; if(Array.isArray(v?.items)) return v.items; if(Array.isArray(v?.players)) return v.players; if(Array.isArray(v?.leaderboard)) return v.leaderboard; return []; }
  function normalGameRows(bundle, game){
    const lower=String(game||'').toLowerCase();
    const source = bundle?.game_ladders?.[lower] || bundle?.game_ladders?.[lower+'s'] || [];
    return byArray(source).slice(0,5);
  }
  function speedGroups(bundle){
    const groups = bundle?.drinks?.speed_leaderboards || bundle?.drinks?.speedLeaderboards || [];
    if(Array.isArray(groups) && groups.length) return groups.map((g)=>({ label:g.label||g.drink_type||g.type||'Snelheid', rows:byArray(g.rows||g.items||g.leaderboard).slice(0,5) }));
    const rows = byArray(bundle?.drinks?.speed_rows || bundle?.drinks?.speed || []);
    const byType = {};
    rows.forEach((r)=>{ const k=r.drink_type||r.event_type||r.type||'Snelheid'; (byType[k]||(byType[k]=[])).push(r); });
    return Object.entries(byType).map(([label, rows])=>({label, rows:rows.slice(0,5)}));
  }
  function drinkUnitRows(bundle, key){
    return byArray(bundle?.drinks?.[key] || bundle?.[key] || []);
  }
  function cardSection(id, title, inner, cls=''){
    return `<section id="${id}" class="ghpr-section ${cls}"><div class="ghpr-head"><h2>${esc(title)}</h2><span>${VERSION}</span></div>${inner}</section>`;
  }
  function injectStyles(){
    if($('ghprStyles')) return;
    const css = `.ghpr-section{margin:18px 0;display:grid;gap:12px;text-align:left}.ghpr-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.ghpr-head h2{margin:0;font-size:1.15rem}.ghpr-head span{font-size:12px;color:#8a7a55;font-weight:900}.ghpr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.ghpr-card{display:block;text-decoration:none;color:#17130f;background:rgba(255,255,255,.9);border:1px solid rgba(0,0,0,.07);border-radius:20px;padding:15px;box-shadow:0 10px 22px rgba(0,0,0,.035)}.ghpr-card.dark{background:#111;color:#fff}.ghpr-card.gold{background:#9a8241;color:#111}.ghpr-card h3{margin:0 0 9px;font-size:16px}.ghpr-list{display:grid;gap:8px}.ghpr-row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px 10px;border-radius:14px;background:rgba(249,247,242,.86);border:1px solid rgba(0,0,0,.05)}.ghpr-rank{width:24px;height:24px;border-radius:999px;background:#111;color:#fff;display:grid;place-items:center;font-size:12px;font-weight:900}.ghpr-name{font-weight:900;min-width:0;overflow:hidden;text-overflow:ellipsis}.ghpr-value{text-align:right;font-weight:900}.ghpr-meta{font-size:12px;color:#6b6257;margin-top:3px}.ghpr-hero{display:grid;grid-template-columns:76px minmax(0,1fr);gap:14px;align-items:center}.ghpr-avatar{width:76px;height:76px;border-radius:50%;background:#f4ead6;border:2px solid rgba(154,130,65,.32);display:grid;place-items:center;font-weight:900;overflow:hidden}.ghpr-avatar img{width:100%;height:100%;object-fit:cover}.ghpr-big{font-size:30px;font-weight:900;line-height:1}.ghpr-alert{padding:12px 14px;border-radius:16px;background:#fff8e6;border:1px solid rgba(154,130,65,.22);color:#654c14;font-weight:800}.ghpr-runtime-top{margin-top:14px}.ghpr-badge{display:inline-flex;padding:5px 9px;border-radius:999px;background:#111;color:#fff;font-size:12px;font-weight:900}.ghpr-admin-pre{white-space:pre-wrap;word-break:break-word;background:#111;color:#f4e2a0;border-radius:16px;padding:14px;max-height:420px;overflow:auto}@media(max-width:760px){.ghpr-row{grid-template-columns:24px minmax(0,1fr);}.ghpr-value{grid-column:2;text-align:left}.ghpr-hero{grid-template-columns:1fr;text-align:center}.ghpr-avatar{margin:0 auto}}`;
    const st=document.createElement('style'); st.id='ghprStyles'; st.textContent=css; document.head.appendChild(st);
  }
  function rowsHtml(rows, valueFn){
    const list = byArray(rows).slice(0,5);
    if(!list.length) return '<div class="ghpr-alert">Nog geen data.</div>';
    return `<div class="ghpr-list">${list.map((r,i)=>`<div class="ghpr-row"><span class="ghpr-rank">${i+1}</span><a class="ghpr-name" href="${playerHref(bestName(r))}">${esc(bestName(r))}</a><span class="ghpr-value">${esc(valueFn(r))}</span></div>`).join('')}</div>`;
  }
  function renderHome(bundle){
    injectStyles();
    const target = document.querySelector('.public-links') || document.querySelector('.main-card') || document.body;
    const existing = $('ghprHomeRuntime'); if(existing) existing.remove();
    const biggest = bundle?.drinks?.biggest_player || bundle?.biggest_player || {};
    const avatar = biggest.avatar_url || biggest.profile_picture_url || '';
    const topCards = ['klaverjas','boerenbridge','beerpong'].map((game)=>`<a class="ghpr-card" href="${ladderHref(game)}"><h3>${gameLabel(game)} top 5</h3>${rowsHtml(normalGameRows(bundle, game), (r)=>Math.round(Number(r.elo_rating||r.rating||1000))+' ELO')}</a>`).join('');
    const speed = speedGroups(bundle);
    const speedCard = `<a class="ghpr-card" href="./drinks_speed_stats.html"><h3 id="ghprSpeedTitle">${esc(speed[0]?.label || 'Snelheid top 5')}</h3><div id="ghprSpeedRows">${rowsHtml(speed[0]?.rows||[], (r)=>{ const s=Number(r.seconds||r.best_seconds||r.elapsed_seconds||0); return s ? s.toFixed(1)+'s' : '—'; })}</div></a>`;
    const unitsToday = `<a class="ghpr-card gold" href="./drinks_stats.html"><h3>Vandaag / sessie units</h3>${rowsHtml(drinkUnitRows(bundle,'daily_units_top'), (r)=>num(r.units||r.total_units,1)+' u')}</a>`;
    const unitsAll = `<a class="ghpr-card dark" href="./drinks_stats.html"><h3>All-time units</h3>${rowsHtml(drinkUnitRows(bundle,'all_time_units_top'), (r)=>num(r.units||r.total_units,1)+' u')}</a>`;
    const biggestCard = `<a class="ghpr-card" href="${playerHref(bestName(biggest))}"><h3>Grootste Speler</h3><div class="ghpr-hero"><div class="ghpr-avatar">${avatar?`<img src="${esc(avatar)}" alt="${esc(bestName(biggest))}">`:esc((bestName(biggest)||'?').slice(0,1).toUpperCase())}</div><div><div class="ghpr-big">${esc(bestName(biggest))}</div><div class="ghpr-meta">${num(biggest.units||biggest.total_units,1)} units all-time</div></div></div></a>`;
    const html = `<div id="ghprHomeRuntime" class="ghpr-runtime-top">${cardSection('ghprHomeLadders','Live ladders & spelers',`<div class="ghpr-grid">${topCards}${speedCard}${unitsToday}${unitsAll}${biggestCard}</div>`)}</div>`;
    target.insertAdjacentHTML(target === document.body ? 'beforeend' : 'afterend', html);
    if(speed.length>1){ let idx=0; setInterval(()=>{ idx=(idx+1)%speed.length; const g=speed[idx]; const title=$('ghprSpeedTitle'), rows=$('ghprSpeedRows'); if(title) title.textContent=g.label; if(rows) rows.innerHTML=rowsHtml(g.rows,(r)=>{ const s=Number(r.seconds||r.best_seconds||r.elapsed_seconds||0); return s?s.toFixed(1)+'s':'—'; }); }, 6500); }
  }
  function renderProfiles(bundle){
    injectStyles();
    const top = document.querySelector('.sheet .top') || document.querySelector('.top') || document.body;
    const existing=$('ghprProfilesRuntime'); if(existing) existing.remove();
    const rows=byArray(bundle?.players || bundle?.cross_game?.items || []);
    const inner = `<div class="ghpr-grid"><div class="ghpr-card"><h3>Meeste potjes</h3>${rowsHtml(rows.slice().sort((a,b)=>Number(b.total_games||b.total_matches||0)-Number(a.total_games||a.total_matches||0)), (r)=>num(r.total_games||r.total_matches)+' potjes')}</div><div class="ghpr-card"><h3>Beste gemiddelde ELO</h3>${rowsHtml(rows.slice().sort((a,b)=>Number(b.avg_elo||b.best_rating||0)-Number(a.avg_elo||a.best_rating||0)), (r)=>num(r.avg_elo||r.best_rating||1000)+' ELO')}</div><div class="ghpr-card"><h3>Drank units</h3>${rowsHtml(byArray(bundle?.drinks?.all_time_units_top), (r)=>num(r.units||r.total_units,1)+' u')}</div></div>`;
    top.insertAdjacentHTML('afterend', `<div id="ghprProfilesRuntime" style="padding:0 18px 8px">${cardSection('ghprProfilesSummary','Profielsamenvatting',inner)}</div>`);
  }
  function renderPlayer(bundle){
    injectStyles();
    const wrap = $('extraStatsWrap') || document.querySelector('.card') || document.body;
    const existing=$('ghprPlayerRuntime'); if(existing) existing.remove();
    const player = bundle?.player || {};
    const games = bundle?.games || {};
    const drinks = bundle?.drinks || {};
    const gameCards = Object.entries(games).map(([game,row])=>`<div class="ghpr-card"><h3>${gameLabel(game)}</h3><div class="ghpr-big">${num(row.elo_rating||row.rating||1000)}</div><div class="ghpr-meta">${num(row.games_played||row.matches_played||0)} potjes · ${num(row.win_pct||0,1)}% winst</div></div>`).join('') || '<div class="ghpr-alert">Nog geen game stats.</div>';
    const drinkCard = `<div class="ghpr-card gold"><h3>Drinks</h3><div class="ghpr-big">${num(drinks.units||drinks.total_units||0,1)}</div><div class="ghpr-meta">${num(drinks.events||0)} events · favoriete type ${esc(drinks.favorite_type||'—')}</div></div>`;
    const html = `<div id="ghprPlayerRuntime">${cardSection('ghprPlayerSummary',`Runtime profiel · ${bestName(player)}`,`<div class="ghpr-grid">${gameCards}${drinkCard}</div>`)}</div>`;
    wrap.insertAdjacentHTML(wrap.id==='extraStatsWrap' ? 'afterbegin' : 'beforeend', html);
  }
  async function loadHome(){ const data=await rpc(RPC.home,{site_scope_input:scope(),session_token_input:playerSession()||null}); renderHome(data); return data; }
  async function loadProfiles(){ const data=await rpc(RPC.profiles,{site_scope_input:scope(),limit_input:80}); renderProfiles(data); return data; }
  async function loadPlayer(){ const p=new URLSearchParams(location.search).get('player')||''; if(!p) return null; const data=await rpc(RPC.player,{player_name_input:p,site_scope_input:scope(),session_token_input:playerSession()||null}); renderPlayer(data); return data; }
  async function loadAdmin(){
    injectStyles();
    const out=$('runtimeOutput'); if(!out) return;
    const data=await rpc(RPC.admin,{admin_session_token:adminSession(),site_scope_input:scope()});
    out.textContent=JSON.stringify(data,null,2);
    const home=$('runtimeHomePreview'); if(home) home.innerHTML = `<div class="ghpr-grid"><div class="ghpr-card"><h3>Players</h3><div class="ghpr-big">${num(data?.summary?.players||0)}</div></div><div class="ghpr-card"><h3>Game rows</h3><div class="ghpr-big">${num(data?.summary?.game_rows||0)}</div></div><div class="ghpr-card"><h3>Drink rows</h3><div class="ghpr-big">${num(data?.summary?.drink_rows||0)}</div></div></div>`;
  }
  async function boot(){
    const path=(location.pathname||'').split('/').pop() || 'index.html';
    try{
      if(path==='index.html' || path==='home.html' || path==='') { return; }
      else if(path==='profiles.html') await loadProfiles();
      else if(path==='player.html') await loadPlayer();
      else if(path==='admin_home_profiles_runtime.html') await loadAdmin();
    }catch(err){ console.warn('[home-profile-runtime]', err); /* v685: optional runtime must never add visible timeout errors or slow/block the page. Existing page-owned boxes remain visible. */ }
  }
  window.GEJAST_HOME_PROFILE_RUNTIME={VERSION,rpc,loadHome,loadProfiles,loadPlayer,loadAdmin,renderHome,renderProfiles,renderPlayer};
  function start(){ const fast=window.GEJAST_FAST_RUNTIME; if(fast&&fast.idle) fast.idle(()=>boot(), 1500); else setTimeout(()=>boot(),120); } if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();