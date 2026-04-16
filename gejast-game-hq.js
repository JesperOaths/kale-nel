
(function(global){
  function cfg(){ return global.GEJAST_CONFIG || {}; }
  function scope(){ try{ return global.GEJAST_ADMIN_RPC && global.GEJAST_ADMIN_RPC.getScope ? global.GEJAST_ADMIN_RPC.getScope() : (global.GEJAST_SCOPE_UTILS && global.GEJAST_SCOPE_UTILS.getScope ? global.GEJAST_SCOPE_UTILS.getScope() : 'friends'); }catch(_){ return 'friends'; } }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function rpcHeaders(){ const c=cfg(); return { apikey:c.SUPABASE_PUBLISHABLE_KEY||'', Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const t=await res.text(); let d=null; try{ d=t?JSON.parse(t):null; }catch(_){ throw new Error(t||`HTTP ${res.status}`); } if(!res.ok) throw new Error(d?.message||d?.error||d?.details||d?.hint||t||`HTTP ${res.status}`); return d; }
  async function publicRpc(name, payload){ if(global.GEJAST_SCOPED_RPC && typeof global.GEJAST_SCOPED_RPC.callRpc==='function') return global.GEJAST_SCOPED_RPC.callRpc(name, payload||{}); const c=cfg(); const res=await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:rpcHeaders(), body:JSON.stringify(payload||{})}); const raw=await parse(res); return raw && raw[name]!==undefined ? raw[name] : raw; }
  async function adminRpc(name, payload){ if(global.GEJAST_ADMIN_RPC && typeof global.GEJAST_ADMIN_RPC.rpc==='function'){ const raw=await global.GEJAST_ADMIN_RPC.rpc(name, payload||{}); return raw && raw[name]!==undefined ? raw[name] : raw; } const c=cfg(); const res=await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:rpcHeaders(), body:JSON.stringify(payload||{})}); const raw=await parse(res); return raw && raw[name]!==undefined ? raw[name] : raw; }
  function setStatus(id,msg,kind){ const el=global.document.getElementById(id||'pageStatus'); if(!el) return; el.textContent=msg||''; el.className=`status${kind?` ${kind}`:''}`; }
  function num(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
  function queryPlayer(){ try{ return new URLSearchParams(global.location.search).get('player') || ''; }catch(_){ return ''; } }
  function currentPageHref(playerName){ try{ const url = new URL(global.location.href); if(playerName){ url.searchParams.set('player', playerName); } else { url.searchParams.delete('player'); } return `${url.pathname.split('/').pop()}${url.search}`; }catch(_){ return '#'; } }
  function mergeDashboardData(a,b){
    const out = Object.assign({}, a||{}, b||{});
    const keys = ['overview_cards','story_cards','leaderboard_sections','table_sections','recent_rows','trend_sections','player_link_titles'];
    keys.forEach((key)=>{
      if(Array.isArray(a?.[key]) || Array.isArray(b?.[key])){
        out[key] = [...(Array.isArray(a?.[key])?a[key]:[]), ...(Array.isArray(b?.[key])?b[key]:[])];
      }
    });
    return out;
  }
  function renderCards(targetId, cards, story){ const el=global.document.getElementById(targetId); if(!el) return; const rows=Array.isArray(cards)?cards:[]; el.className=`grid ${story?'story':'overview'}`; el.innerHTML=rows.length?rows.map((c)=>`<article class="card${story?' story-card':''}"><div class="k">${esc(c.label||c.k||'')}</div><div class="v">${esc(c.value||c.v||'')}</div><div class="sub">${esc(c.sub||'')}</div></article>`).join(''):`<div class="note">Nog geen data.</div>`; }
  function rowNeedsPlayerLink(section,row,playerLinkTitles){
    if(row && row.href) return true;
    if(row && row.player_name) return true;
    const titles = Array.isArray(playerLinkTitles) ? playerLinkTitles : [];
    if(section && section.row_kind === 'player') return true;
    if(section && section.title && titles.includes(section.title)) return true;
    return false;
  }
  function rowHref(section,row){
    if(row?.href) return row.href;
    const player = row?.player_name || row?.label;
    return player ? currentPageHref(player) : '#';
  }
  function renderLeaderboards(targetId, sections, kind, playerLinkTitles){ const el=global.document.getElementById(targetId); if(!el) return; const list=Array.isArray(sections)?sections:[]; el.className='section-list'; el.innerHTML=list.length?list.map((sec)=>{ const rows=Array.isArray(sec.rows)?sec.rows:[]; const max=Math.max(1,...rows.map((r)=>num(r.value))); return `<article class="section-card"><div><h3>${esc(sec.title||'')}</h3><p>${esc(sec.subtitle||'')}</p></div><div class="bar-list">${rows.length?rows.map((r)=>{ const pct=Math.max(6,Math.round((num(r.value)/max)*100)); const labelHtml = rowNeedsPlayerLink(sec,r,playerLinkTitles) ? `<a class="player-link" href="${esc(rowHref(sec,r))}">${esc(r.label||'')}</a>` : `<strong>${esc(r.label||'')}</strong>`; return `<div class="bar-row"><div class="bar-head">${labelHtml}<span>${esc(r.value||'')}</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><div class="bar-sub">${esc(r.sub||'')}</div></div>`; }).join(''):`<div class="note">Nog geen data.</div>`}</div></article>`; }).join(''):`<div class="note">Nog geen leaderboards.</div>`; }
  function svgLineChart(series){
    const width = 720, height = 180, padX = 26, padY = 16;
    const points = (Array.isArray(series)?series:[]).flatMap((s)=>(Array.isArray(s.points)?s.points:[]).map((p)=>num(p.value)));
    const max = Math.max(1,...points), count = Math.max(2,...(series||[]).map((s)=>(s.points||[]).length));
    const palette = ['line-a','line-b','line-c'];
    const toXY = (idx,val)=>{
      const x = padX + ((width - padX*2) * (count===1?0:idx/(count-1)));
      const y = height - padY - ((height - padY*2) * (num(val)/max));
      return [x,y];
    };
    const paths = (series||[]).map((s, i)=>{
      const pts = (s.points||[]).map((p,idx)=>toXY(idx,p.value));
      const d = pts.map((xy,idx)=>`${idx?'L':'M'} ${xy[0].toFixed(1)} ${xy[1].toFixed(1)}`).join(' ');
      return `<path class="trend-path ${palette[i%palette.length]}" d="${d}"></path>` + pts.map((xy)=>`<circle class="trend-dot ${palette[i%palette.length]}" cx="${xy[0].toFixed(1)}" cy="${xy[1].toFixed(1)}" r="3"></circle>`).join('');
    }).join('');
    const labels = ((series?.[0]?.points)||[]).map((p,idx)=>{ const [x]=toXY(idx,0); return `<text x="${x.toFixed(1)}" y="170" text-anchor="middle">${esc(p.label||'')}</text>`; }).join('');
    const grid = [0.25,0.5,0.75,1].map((f)=>{ const y = height - padY - ((height - padY*2) * f); return `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${width-padX}" y2="${y.toFixed(1)}"></line>`; }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" class="trend-svg" preserveAspectRatio="none"><g class="trend-grid">${grid}</g>${paths}<g class="trend-labels">${labels}</g></svg>`;
  }
  function renderTrendSections(targetId, sections){ const el=global.document.getElementById(targetId); if(!el) return; const list=Array.isArray(sections)?sections:[]; el.innerHTML=list.length?list.map((sec)=>`<article class="trend-card"><div class="trend-head"><div><h3>${esc(sec.title||'')}</h3><p>${esc(sec.subtitle||'')}</p></div><div class="trend-legend">${(sec.series||[]).map((s,idx)=>`<span class="legend-chip chip-${idx+1}">${esc(s.name||`Lijn ${idx+1}`)}</span>`).join('')}</div></div>${svgLineChart(sec.series||[])}<div class="trend-foot">${(sec.series||[]).map((s)=>`<div><strong>${esc(s.name||'')}</strong><span>${esc(s.summary||'')}</span></div>`).join('')}</div></article>`).join(''):`<div class="note">Nog geen trends.</div>`; }
  function renderRecent(targetId, rows){ const el=global.document.getElementById(targetId); if(!el) return; const list=Array.isArray(rows)?rows:[]; el.className='feed'; el.innerHTML=list.length?list.map((r)=>`<article class="feed-row"><div class="main"><strong>${esc(r.title||'')}</strong><div class="meta">${esc(r.sub||'')}</div><div class="meta">${esc(r.meta||'')}</div></div><div class="pill">${esc(r.value||'')}</div></article>`).join(''):`<div class="note">Nog geen recente regels.</div>`; }
  function renderTables(targetId, sections){ const el=global.document.getElementById(targetId); if(!el) return; const list=Array.isArray(sections)?sections:[]; el.innerHTML=list.length?list.map((sec)=>{ const columns=Array.isArray(sec.columns)?sec.columns:[]; const rows=Array.isArray(sec.rows)?sec.rows:[]; return `<section class="panel"><h2>${esc(sec.title||'')}</h2><p>${esc(sec.subtitle||'')}</p><div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr>${columns.map((c)=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map((row)=>`<tr>${(Array.isArray(row)?row:[]).map((cell)=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${Math.max(columns.length,1)}">Nog geen data.</td></tr>`}</tbody></table></div></section>`; }).join(''):`<div class="note">Nog geen tabellen.</div>`; }
  function renderCareer(targetId, data){
    const wrap=global.document.getElementById(targetId);
    const panel=global.document.getElementById('careerPanel');
    if(!wrap || !panel) return;
    if(!data || !(Array.isArray(data.summary_cards)||Array.isArray(data.table_sections)||Array.isArray(data.recent_rows))){ panel.style.display='none'; wrap.innerHTML=''; return; }
    panel.style.display='block';
    wrap.innerHTML = `
      <div class="career-top">
        <div>
          <div class="eyebrow">Spelercard</div>
          <h2 class="career-title">${esc(data.player_name||queryPlayer()||'Speler')}</h2>
          <p class="career-sub">${esc(data.description||'Persoonlijke samenvatting met vorm, matchups en recente prestaties.')}</p>
        </div>
        <div class="actions"><a class="btn alt" href="${esc(currentPageHref(''))}">Wis spelerfilter</a></div>
      </div>
      <div id="careerCards" class="grid overview"></div>
      <div id="careerTrends" class="career-trends"></div>
      <div id="careerRecent" class="feed"></div>
      <div id="careerTables"></div>`;
    renderCards('careerCards', data.summary_cards, false);
    renderTrendSections('careerTrends', data.trend_sections);
    renderRecent('careerRecent', data.recent_rows);
    renderTables('careerTables', data.table_sections);
  }
  const publicMap={ despimarkt:'despimarkt_get_stats_scoped', pikken:'get_pikken_stats_scoped', paardenrace:'get_paardenrace_stats_scoped', rad:'get_rad_stats_scoped' };
  const adminMap={ despimarkt:'admin_get_despimarkt_insights_action', pikken:'admin_get_pikken_dashboard_action', paardenrace:'admin_get_paardenrace_dashboard_action', rad:'admin_get_rad_dashboard_action' };
  const deepMap={ despimarkt:'despimarkt_get_deep_stats_scoped', pikken:'pikken_get_deep_stats_scoped', paardenrace:'paardenrace_get_deep_stats_scoped', rad:'rad_get_deep_stats_scoped' };
  const careerMap={ despimarkt:'despimarkt_get_player_career_scoped', pikken:'pikken_get_player_career_scoped', paardenrace:'paardenrace_get_player_career_scoped', rad:'rad_get_player_career_scoped' };
  async function loadPublicPage(kind){
    setStatus('pageStatus','Stats laden…');
    try{
      const playerName = queryPlayer();
      const [base, deep, career] = await Promise.all([
        publicRpc(publicMap[kind], { site_scope_input: scope(), limit_count: 40 }),
        deepMap[kind] ? publicRpc(deepMap[kind], { site_scope_input: scope(), limit_count: 40 }) : Promise.resolve({}),
        playerName && careerMap[kind] ? publicRpc(careerMap[kind], { site_scope_input: scope(), player_name_input: playerName, limit_count: 24 }) : Promise.resolve(null)
      ]);
      const data = mergeDashboardData(base, deep);
      renderCards('overviewGrid', data?.overview_cards, false);
      renderCards('storyGrid', data?.story_cards, true);
      renderLeaderboards('leaderboardsMount', data?.leaderboard_sections, kind, data?.player_link_titles);
      renderRecent('recentMount', data?.recent_rows);
      renderTables('tablesMount', data?.table_sections);
      renderTrendSections('trendMount', career?.trend_sections?.length ? career.trend_sections : data?.trend_sections);
      renderCareer('careerMount', career);
      setStatus('pageStatus', playerName ? `Stats geladen · filter op ${playerName}.` : 'Stats geladen.', 'ok');
    }catch(err){ setStatus('pageStatus', err.message||String(err), 'error'); }
  }
  async function loadAdminPage(kind){
    if(global.GEJAST_ADMIN_RPC && typeof global.GEJAST_ADMIN_RPC.requirePage==='function'){ const ok=await global.GEJAST_ADMIN_RPC.requirePage(`admin_${kind}.html`); if(!ok) return; }
    setStatus('pageStatus','Adminstats laden…');
    try{
      const playerName = queryPlayer();
      const [base, deep, career] = await Promise.all([
        adminRpc(adminMap[kind], { admin_session_token: global.GEJAST_ADMIN_RPC && global.GEJAST_ADMIN_RPC.getSessionToken ? global.GEJAST_ADMIN_RPC.getSessionToken() : '', site_scope_input: scope(), limit_count: 60 }),
        deepMap[kind] ? publicRpc(deepMap[kind], { site_scope_input: scope(), limit_count: 60 }) : Promise.resolve({}),
        playerName && careerMap[kind] ? publicRpc(careerMap[kind], { site_scope_input: scope(), player_name_input: playerName, limit_count: 30 }) : Promise.resolve(null)
      ]);
      const data = mergeDashboardData(base, deep);
      renderCards('opsGrid', data?.ops_cards, false);
      renderCards('overviewGrid', data?.overview_cards, false);
      renderCards('storyGrid', data?.story_cards, true);
      renderLeaderboards('leaderboardsMount', data?.leaderboard_sections, kind, data?.player_link_titles);
      renderRecent('recentMount', data?.recent_rows);
      renderTables('tablesMount', data?.table_sections);
      renderTrendSections('trendMount', career?.trend_sections?.length ? career.trend_sections : data?.trend_sections);
      renderCareer('careerMount', career);
      setStatus('pageStatus', playerName ? `Adminstats geladen · filter op ${playerName}.` : 'Adminstats geladen.', 'ok');
    }catch(err){ setStatus('pageStatus', err.message||String(err), 'error'); }
  }
  global.GEJAST_GAME_HQ={ loadPublicPage, loadAdminPage, publicRpc, adminRpc, setStatus };
})(window);
