
(function(global){
  function cfg(){ return global.GEJAST_CONFIG || {}; }
  function scope(){
    try { if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.getScope === 'function') return global.GEJAST_SCOPE_UTILS.getScope(); } catch(_){}
    try { return new URLSearchParams(global.location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch(_){}
    return 'friends';
  }
  function token(){ try { return cfg().getPlayerSessionToken ? cfg().getPlayerSessionToken() : ''; } catch(_) { return ''; } }
  function adminToken(){ try { return global.GEJAST_ADMIN_RPC ? global.GEJAST_ADMIN_RPC.getSessionToken() : (sessionStorage.getItem('jas_admin_session_v8') || localStorage.getItem('jas_admin_session_v8') || ''); } catch(_) { return ''; } }
  function headers(){ const c=cfg(); return { apikey:c.SUPABASE_PUBLISHABLE_KEY||'', Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const t=await res.text(); let d=null; try{ d=t?JSON.parse(t):null; }catch(_){ throw new Error(t||`HTTP ${res.status}`); } if(!res.ok) throw new Error(d?.message||d?.error||d?.details||d?.hint||t||`HTTP ${res.status}`); return d; }
  function unbox(name, data){ if (data && typeof data === 'object' && data[name] !== undefined) return data[name]; return data; }
  async function rpc(name, payload){
    if (global.GEJAST_SCOPED_RPC && typeof global.GEJAST_SCOPED_RPC.callRpc === 'function') {
      return await global.GEJAST_SCOPED_RPC.callRpc(name, payload || {});
    }
    const c=cfg();
    const res=await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(payload||{})});
    return unbox(name, await parse(res));
  }
  async function adminRpc(name, payload){
    const c=cfg();
    const res=await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(payload||{})});
    return unbox(name, await parse(res));
  }
  function esc(v){ return String(v??'').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function money(v){ const n=Number(v||0); return `${Number.isFinite(n)?Math.round(n):0} ₵`; }
  function pct(v){ const n=Number(v||0); return `${Number.isFinite(n)?n.toFixed(1):'0.0'}%`; }
  function fmtDate(v){ if(!v) return '—'; const d=new Date(v); return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleString('nl-NL'); }
  function shortDate(v){ if(!v) return '—'; const d=new Date(v); return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleDateString('nl-NL', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }); }
  function q(name){ return new URLSearchParams(global.location.search).get(name) || ''; }
  function route(path){
    try {
      const u=new URL(path, global.location.href);
      if (scope()==='family') u.searchParams.set('scope','family');
      return u.pathname.split('/').pop() + (u.search||'');
    } catch(_) { return path; }
  }
  function profileHref(name){ return `./player.html?player=${encodeURIComponent(name||'')}${scope()==='family'?'&scope=family':''}`; }
  function playerLink(name){ const label=String(name||'Onbekend'); return `<a class="clean-link" href="${profileHref(label)}">${esc(label)}</a>`; }
  function bar(label, value, max, tone){ const width=max>0 ? Math.max(5, Math.round((Number(value||0)/max)*100)) : 0; return `<div class="dm-bar-row"><div class="dm-bar-meta"><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div><div class="dm-bar-track ${esc(tone||'gold')}"><div class="dm-bar-fill" style="width:${width}%"></div></div></div>`; }
  function note(text){ return `<div class="dm-note">${esc(text)}</div>`; }
  function empty(text){ return `<div class="dm-empty">${esc(text||'Nog geen data.')}</div>`; }
  function normalizeRows(raw, key='rows'){ if (Array.isArray(raw)) return raw; if (Array.isArray(raw?.[key])) return raw[key]; return []; }
  function setStatus(id, msg, kind){ const el=global.document.getElementById(id); if(!el) return; el.textContent = msg || ''; el.className = `status-line${kind?` ${kind}`:''}`; }
  function requirePlayer(returnTo){ try { return cfg().ensurePlayerSessionOrRedirect ? cfg().ensurePlayerSessionOrRedirect(returnTo || `${global.location.pathname.split('/').pop()}${global.location.search||''}`) : true; } catch(_) { return true; } }

  function renderWalletCard(wallet){
    const balance = wallet?.wallet?.balance_cautes ?? wallet?.balance_cautes ?? 0;
    const restriction = wallet?.restriction || wallet?.wallet?.restriction || {};
    return `
      <div class="hero-metric"><span>Balans</span><strong>${money(balance)}</strong><small>${restriction?.is_frozen ? 'Dry Dock actief' : 'Vrij om te handelen'}</small></div>
      <div class="hero-metric"><span>6 uur gemint</span><strong>${money(wallet?.mint_caps?.awarded_last_six_hours || 0)}</strong><small>Nog ${money(wallet?.mint_caps?.remaining_last_six_hours || 0)} beschikbaar</small></div>
      <div class="hero-metric"><span>Pending mints</span><strong>${normalizeRows(wallet?.pending_mint_requests).length}</strong><small>Alleen na verificatie krijg je cautes</small></div>`;
  }

  function ledgerHtml(rows){
    rows = normalizeRows(rows);
    if (!rows.length) return empty('Nog geen ledgerregels.');
    return rows.map((row)=>`<article class="dm-list-card"><div><strong>${esc(row.entry_kind || 'entry')}</strong><div class="muted">${fmtDate(row.created_at)}</div></div><div class="dm-pill ${Number(row.delta_cautes||0)>=0?'plus':'minus'}">${money(row.delta_cautes)}</div><div class="muted">${esc(row.source_key || '')}</div></article>`).join('');
  }

  function mintHistoryHtml(rows){
    rows = normalizeRows(rows);
    if (!rows.length) return empty('Nog geen mintgeschiedenis.');
    return rows.map((row)=>`<article class="dm-list-card"><div><strong>${esc(row.event_type_key || '')}</strong><div class="muted">${fmtDate(row.created_at)}</div></div><div class="dm-stack-right"><div class="dm-pill">${money(row.awarded_cautes ?? row.requested_cautes ?? 0)}</div><div class="muted">${esc(row.status||'')}</div>${row.cap_reason?`<div class="muted">${esc(row.cap_reason)}</div>`:''}</div></article>`).join('');
  }

  function debtCard(row, withAction){
    const deadline = shortDate(row.expires_at);
    return `<article class="dm-list-card debt-card">
      <div>
        <strong>${esc(row.drink_label || row.drink_type_key || 'Drank')}</strong>
        <div class="muted">Door ${playerLink(row.nominator_player_name || row.target_player_name || '')}</div>
        <div class="muted">Aangemaakt: ${fmtDate(row.created_at)}</div>
        <div class="muted">Deadline: ${deadline}</div>
      </div>
      <div class="dm-stack-right">
        <div class="dm-pill">${money(row.nomination_cost_cautes)}</div>
        <div class="muted">${esc(row.status || '')}</div>
        ${withAction?`<button class="btn" data-debt-clear="${Number(row.debt_id||0)}">Drink deze ${esc(row.drink_label || 'schuld')}</button><small class="muted">Deze schuld levert geen ₵ op.</small>`:''}
      </div>
    </article>`;
  }

  function titleCaseTag(tag){ return String(tag||'').replace(/-/g,' ').replace(/\b\w/g, (m)=>m.toUpperCase()); }
  function tagChips(tags){
    const rows = Array.isArray(tags) ? tags.filter(Boolean).slice(0,8) : [];
    return rows.length ? `<div class="tag-row">${rows.map((tag)=>`<span class="market-tag">#${esc(titleCaseTag(tag))}</span>`).join('')}</div>` : '';
  }
  function followButtonHtml(row){
    const following = !!row?.is_following;
    return `<button class="btn alt follow-btn" type="button" data-watch-market="${Number(row?.market_id||0)}" data-watch-next="${following?'0':'1'}">${following?'Volgend':'Volgen'}</button>`;
  }
  function marketTypeLabel(key){
    switch(String(key||'custom_binary')){
      case 'yes_no': return 'Ja / Nee';
      case 'will_wont': return 'Wel / niet';
      case 'over_under': return 'Over / under';
      case 'higher_lower': return 'Higher / lower';
      case 'above_below': return 'Above / below';
      default: return 'Custom binary';
    }
  }
  function promoBadgeHtml(row){
    if (!row?.is_promotional && !row?.promotional_badge_text) return '';
    const badge = row?.promotional_badge_text || 'Promotie';
    return `<span class="dm-pill promo">${esc(badge)}</span>`;
  }
  function promoNoteHtml(row){
    const promo = Number(row?.promo_seed_cautes || 0);
    if (!(promo > 0)) return '';
    const label = String(row?.promo_seed_outcome_key || 'A').toUpperCase() === 'B'
      ? (row?.outcome_b_label || 'Uitkomst B')
      : (row?.outcome_a_label || 'Uitkomst A');
    const source = row?.promo_house_wallet_key ? ` · wallet ${esc(row.promo_house_wallet_key)}` : '';
    return `<div class="promo-note">Promotionele backing: <strong>${money(promo)}</strong> op <strong>${esc(label)}</strong>${source}</div>`;
  }
  function buildTemplateDraft(prefix){
    const get = (id)=> global.document.getElementById(`${prefix}${id}`);
    const marketType = get('TypeSelect')?.value || 'custom_binary';
    const titleInput = String(get('TitleInput')?.value || '').trim();
    const subject = String(get('SubjectInput')?.value || '').trim();
    const threshold = String(get('ThresholdInput')?.value || '').trim();
    const unit = String(get('UnitInput')?.value || '').trim();
    let outcomeA = String(get('OutcomeA')?.value || '').trim();
    let outcomeB = String(get('OutcomeB')?.value || '').trim();
    let title = titleInput;
    const line = [threshold, unit].filter(Boolean).join(' ').trim();
    const templateMeta = { subject, threshold, unit, line_family: marketType };
    switch(marketType){
      case 'yes_no':
        outcomeA = outcomeA || 'Ja';
        outcomeB = outcomeB || 'Nee';
        title = title || `${subject || 'Deze stelling'}?`;
        break;
      case 'will_wont':
        outcomeA = outcomeA || 'Gaat gebeuren';
        outcomeB = outcomeB || 'Gaat niet gebeuren';
        title = title || `${subject || 'Deze gebeurtenis'}?`;
        break;
      case 'over_under':
        outcomeA = outcomeA || `Over ${line || threshold || 'de lijn'}`;
        outcomeB = outcomeB || `Under ${line || threshold || 'de lijn'}`;
        title = title || `${subject || 'Deze metric'} over/under ${line || threshold || ''}?`.replace(/\s+\?/g,'?');
        break;
      case 'higher_lower':
        outcomeA = outcomeA || `Higher than ${line || threshold || 'de lijn'}`;
        outcomeB = outcomeB || `Lower than ${line || threshold || 'de lijn'}`;
        title = title || `${subject || 'Deze metric'} higher/lower dan ${line || threshold || ''}?`.replace(/\s+\?/g,'?');
        break;
      case 'above_below':
        outcomeA = outcomeA || `Above ${line || threshold || 'de lijn'}`;
        outcomeB = outcomeB || `Below ${line || threshold || 'de lijn'}`;
        title = title || `${subject || 'Deze metric'} above/below ${line || threshold || ''}?`.replace(/\s+\?/g,'?');
        break;
      default:
        title = title || `${subject || 'Nieuwe market'}${subject && !/[?]$/.test(subject) ? '?' : ''}`;
        outcomeA = outcomeA || 'Uitkomst A';
        outcomeB = outcomeB || 'Uitkomst B';
        break;
    }
    return { marketType, title, outcomeA, outcomeB, templateMeta };
  }
  function bindTemplateHelpers(prefix){
    const get = (id)=> global.document.getElementById(`${prefix}${id}`);
    const previewEl = get('TemplatePreview');
    const refresh = ()=>{
      if (!previewEl) return;
      const draft = buildTemplateDraft(prefix);
      previewEl.innerHTML = `Type: <strong>${esc(marketTypeLabel(draft.marketType))}</strong><br>Titel: <strong>${esc(draft.title || '—')}</strong><br>A: <strong>${esc(draft.outcomeA || '—')}</strong> · B: <strong>${esc(draft.outcomeB || '—')}</strong>`;
    };
    ['TypeSelect','TitleInput','SubjectInput','ThresholdInput','UnitInput','OutcomeA','OutcomeB'].forEach((id)=>{
      const el = get(id);
      if (el) { el.oninput = refresh; el.onchange = refresh; }
    });
    refresh();
  }
  function swingPill(row){
    const swing = Number(row?.swing_points_a || 0);
    if (!Number.isFinite(swing) || Math.abs(swing) < 0.1) return '<span class="dm-pill">vlak</span>';
    return `<span class="dm-pill ${swing>0?'plus':'minus'}">${swing>0?'+':''}${swing.toFixed(1)} pts</span>`;
  }
  function recentActivityHtml(rows){
    rows = normalizeRows(rows);
    if (!rows.length) return empty('Nog geen live tape.');
    return rows.map((row)=>`<article class="dm-list-card activity-card"><div><strong>${playerLink(row.player_name || '')}</strong><div class="muted">${esc(row.title || 'Market')} · ${esc(row.outcome_label || row.outcome_key || '')}</div>${tagChips(row.market_tags || [])}</div><div class="dm-stack-right"><div class="dm-pill">${money(row.stake_cautes || 0)}</div><div class="muted">${shortDate(row.created_at)}</div></div></article>`).join('');
  }
  function positionSummaryHtml(rows){
    rows = normalizeRows(rows);
    if (!rows.length) return empty('Nog geen open posities.');
    return rows.map((row)=>`<article class="dm-list-card"><div><strong>${esc(row.title || 'Market')}</strong><div class="muted">Kant ${esc(row.outcome_key || '')} · ${row.bet_count || 0} bets</div></div><div class="dm-stack-right"><div class="dm-pill">${money(row.total_stake_cautes || 0)}</div><a class="btn alt" href="${route(`./despimarkt_market.html?market=${encodeURIComponent(row.market_id)}`)}">Open</a></div></article>`).join('');
  }
  function marketCard(row){
    const total = Number(row.total_pot || 0);
    const a = Number(row.outcome_a_pool || 0);
    const b = Number(row.outcome_b_pool || 0);
    const pa = row.probability_a != null ? Number(row.probability_a) : (total>0 ? (a/total*100) : 0);
    const pb = row.probability_b != null ? Number(row.probability_b) : (total>0 ? (b/total*100) : 0);
    const promo = promoNoteHtml(row);
    const typeChip = `<span class="dm-pill type">${esc(marketTypeLabel(row.market_type_key))}</span>`;
    return `<article class="market-card ${esc(String(row.status||'').toLowerCase())} ${row.is_promotional?'promotional-card':''}">
      <div class="market-card-head"><strong>${esc(row.title || 'Market')}</strong><div class="chip-row"><span class="dm-pill">${money(total)}</span>${typeChip}${promoBadgeHtml(row)}${swingPill(row)}</div></div>
      ${tagChips(row.market_tags || [])}
      ${promo}
      <div class="muted">${esc(row.description || row.resolution_summary || 'Geen beschrijving')}</div>
      <div class="market-mini-meta"><span>${row.watcher_count || 0} volgers</span><span>${row.recent_bet_count_24h || 0} bets / 24u</span></div>
      <div class="market-grid-2">
        <a class="outcome-box clean-link" href="${route(`./despimarkt_market.html?market=${encodeURIComponent(row.market_id)}`)}"><span>${esc(row.outcome_a_label || 'A')}</span><strong>${pct(pa)}</strong><small>${money(a)}</small></a>
        <a class="outcome-box clean-link alt" href="${route(`./despimarkt_market.html?market=${encodeURIComponent(row.market_id)}`)}"><span>${esc(row.outcome_b_label || 'B')}</span><strong>${pct(pb)}</strong><small>${money(b)}</small></a>
      </div>
      <div class="market-card-foot"><span>Sluit: ${shortDate(row.closes_at)}</span><div class="inline-actions"><span>${esc(row.status || '')}</span>${followButtonHtml(row)}</div></div>
    </article>`;
  }
  async function bindWatchButtons(statusId, refreshFn){
    global.document.querySelectorAll('[data-watch-market]').forEach((btn)=>btn.onclick = async (ev)=>{
      ev.preventDefault(); ev.stopPropagation();
      const marketId = Number(btn.dataset.watchMarket || 0);
      const next = String(btn.dataset.watchNext || '1') === '1';
      if (!marketId) return;
      setStatus(statusId || 'hubStatus', next ? 'Market volgen…' : 'Market ontvolgen…');
      try {
        await rpc('despimarkt_set_market_watch_state_scoped', { session_token: token(), market_id_input: marketId, is_following_input: next, site_scope_input: scope() });
        setStatus(statusId || 'hubStatus', next ? 'Market toegevoegd aan je watchlist.' : 'Market uit je watchlist gehaald.', 'ok');
        if (typeof refreshFn === 'function') await refreshFn();
      } catch (err) {
        setStatus(statusId || 'hubStatus', err.message || String(err), 'error');
      }
    });
  }

  async function loadHubPage(){
    if(!requirePlayer('despimarkt.html')) return;
    setStatus('hubStatus', "Beurs d'Espinoza laden…");
    async function refresh(){
      try {
        const data = await rpc('despimarkt_get_market_list_scoped', { session_token: token(), site_scope_input: scope() });
        const wallet = data?.wallet || {};
        const active = normalizeRows(data?.active_markets);
        const promo = active.filter((row)=>row?.is_promotional);
        global.document.getElementById('heroMetrics').innerHTML = `
          <div class="hero-metric"><span>Balans</span><strong>${money(wallet?.balance_cautes || 0)}</strong><small>${data?.restriction?.is_frozen ? 'Dry Dock actief' : 'Vrij om te handelen'}</small></div>
          <div class="hero-metric"><span>Open markten</span><strong>${active.length}</strong><small>${normalizeRows(data?.recent_activity).length} live bewegingen in de tape</small></div>
          <div class="hero-metric"><span>Watchlist</span><strong>${normalizeRows(data?.watchlist_markets).length}</strong><small>${normalizeRows(data?.watchlist_markets).reduce((sum,row)=>sum+Number(row.watcher_count||0),0)} volgers in je gevolgde markten</small></div>
          <div class="hero-metric"><span>Promo / oefen</span><strong>${promo.length}</strong><small>${promo.reduce((sum,row)=>sum+Number(row.promo_seed_cautes||0),0)} ₵ aan officiële backing</small></div>`;
        global.document.getElementById('frozenStatus').innerHTML = data?.restriction?.is_frozen ? note(`Dry Dock actief: ${data.restriction.frozen_reason || "je schrijfacties voor Beurs d'Espinoza zijn tijdelijk geblokkeerd."}`) : note('Geen actieve Dry Dock-blokkade. Volg markten om close-soon en marktbewegingen te zien.');
        global.document.getElementById('activeMarkets').innerHTML = active.length ? active.map(marketCard).join('') : empty('Nog geen open markten.');
        global.document.getElementById('myPositions').innerHTML = positionSummaryHtml(data?.my_positions);
        if (global.document.getElementById('watchlistMarkets')) global.document.getElementById('watchlistMarkets').innerHTML = normalizeRows(data?.watchlist_markets).length ? normalizeRows(data.watchlist_markets).map(marketCard).join('') : empty('Je volgt nog geen markten.');
        if (global.document.getElementById('recentActivity')) global.document.getElementById('recentActivity').innerHTML = recentActivityHtml(data?.recent_activity);
        if (global.document.getElementById('promotionalMarkets')) global.document.getElementById('promotionalMarkets').innerHTML = promo.length ? promo.map(marketCard).join('') : empty('Nog geen actieve promotionele markten.');
        global.document.getElementById('resolvedMarkets').innerHTML = normalizeRows(data?.recently_resolved).length ? normalizeRows(data.recently_resolved).map(marketCard).join('') : empty('Nog geen recente settlements.');
        await bindWatchButtons('hubStatus', refresh);
        setStatus('hubStatus',"Beurs d'Espinoza geladen.",'ok');
      } catch (err) {
        setStatus('hubStatus', err.message || String(err), 'error');
      }
    }
    await refresh();
  }

  async function loadWalletPage(){
    if(!requirePlayer('despimarkt_wallet.html')) return;
    setStatus('walletStatus','Wallet laden…');
    try {
      const data = await rpc('despimarkt_get_wallet_scoped', { session_token: token(), site_scope_input: scope(), limit_count: 120 });
      global.document.getElementById('walletHero').innerHTML = renderWalletCard(data);
      global.document.getElementById('walletRestriction').innerHTML = data?.restriction?.is_frozen ? note(`Dry Dock actief: ${data.restriction.frozen_reason || 'je bent tijdelijk geblokkeerd.'}`) : note('Alleen speciale mintverzoeken leveren cautes op. Normale drankverificatie en schuldenafbetaling leveren 0 ₵ op.');
      global.document.getElementById('ledgerList').innerHTML = ledgerHtml(data?.ledger);
      global.document.getElementById('mintPendingList').innerHTML = mintHistoryHtml(data?.pending_mint_requests);
      global.document.getElementById('mintHistoryList').innerHTML = mintHistoryHtml(data?.mint_history);
      const options = normalizeRows(data?.mint_options);
      const select = global.document.getElementById('mintDrinkType');
      select.innerHTML = options.map((row)=>`<option value="${esc(row.event_type_key)}">${esc(row.label)} — ${money(row.cautes)}</option>`).join('');
      global.document.getElementById('mintCapSummary').innerHTML = `${money(data?.mint_caps?.remaining_last_six_hours || 0)} over in de lopende 6-uurscap · max ${money(data?.mint_caps?.single_request_cap_cautes || 100)} per verzoek.`;
      global.document.getElementById('mintForm').onsubmit = async (ev)=>{
        ev.preventDefault();
        setStatus('walletStatus','Mintverzoek versturen…');
        try {
          await rpc('despimarkt_create_caute_mint_request_scoped', { session_token: token(), event_type_key_input: select.value, quantity_input: Number(global.document.getElementById('mintQuantity').value || 1), site_scope_input: scope() });
          setStatus('walletStatus','Mintverzoek aangemaakt en naar de normale drankverificatie gestuurd.','ok');
          await loadWalletPage();
        } catch (err) { setStatus('walletStatus', err.message || String(err), 'error'); }
      };
      setStatus('walletStatus','Wallet geladen.','ok');
    } catch (err) {
      setStatus('walletStatus', err.message || String(err), 'error');
    }
  }

  function wireDebtClearButtons(){
    global.document.querySelectorAll('[data-debt-clear]').forEach((btn)=>{
      btn.onclick = async ()=>{
        const debtId = Number(btn.getAttribute('data-debt-clear') || 0);
        setStatus('debtsStatus', 'Afbetaalverzoek versturen…');
        try {
          await rpc('despimarkt_submit_debt_clear_request_scoped', { session_token: token(), debt_id_input: debtId, site_scope_input: scope() });
          setStatus('debtsStatus', 'Schuld naar verificatie gestuurd. Deze schuld levert geen ₵ op.', 'ok');
          await loadDebtsPage();
        } catch (err) { setStatus('debtsStatus', err.message || String(err), 'error'); }
      };
    });
  }

  async function loadDebtsPage(mode='full'){
    if(!requirePlayer(mode==='force'?'despimarkt_force.html':'despimarkt_debts.html')) return;
    setStatus('debtsStatus','Schulden laden…');
    try {
      const data = await rpc('despimarkt_get_debts_page_scoped', { session_token: token(), site_scope_input: scope(), limit_count: 120 });
      global.document.getElementById('debtsHero').innerHTML = `<div class="hero-metric"><span>Balans</span><strong>${money(data?.wallet?.balance_cautes || 0)}</strong><small>${data?.restriction?.is_frozen?'Dry Dock actief':'Niet bevroren'}</small></div><div class="hero-metric"><span>Open schulden</span><strong>${normalizeRows(data?.my_open_debts).length}</strong><small>Alleen exacte schuld telt</small></div><div class="hero-metric"><span>Uitgaande nominaties</span><strong>${normalizeRows(data?.my_outgoing_nominations).length}</strong><small>Prijs ligt vast bij aankoop</small></div>`;
      global.document.getElementById('dryDockStatus').innerHTML = data?.restriction?.is_frozen ? note(`Dry Dock actief: ${data.restriction.frozen_reason || "je kunt tijdelijk geen acties in Beurs d'Espinoza doen."}`) : note('Geen actieve Dry Dock-blokkade.');
      if (global.document.getElementById('openDebtsList')) global.document.getElementById('openDebtsList').innerHTML = normalizeRows(data?.my_open_debts).length ? normalizeRows(data.my_open_debts).map((row)=>debtCard(row, true)).join('') : empty('Je hebt geen open schulden.');
      if (global.document.getElementById('pendingDebtList')) global.document.getElementById('pendingDebtList').innerHTML = normalizeRows(data?.my_pending_debt_clear_requests).length ? normalizeRows(data.my_pending_debt_clear_requests).map((row)=>debtCard(row, false)).join('') : empty('Geen lopende afbetaalverzoeken.');
      if (global.document.getElementById('outgoingNominationList')) global.document.getElementById('outgoingNominationList').innerHTML = normalizeRows(data?.my_outgoing_nominations).length ? normalizeRows(data.my_outgoing_nominations).map((row)=>`<article class="dm-list-card"><div><strong>${playerLink(row.target_player_name || '')}</strong><div class="muted">${esc(row.drink_label || '')} · ${esc(row.status || '')}</div></div><div class="dm-stack-right"><div class="dm-pill">${money(row.nomination_cost_cautes)}</div><div class="muted">${shortDate(row.expires_at)}</div></div></article>`).join('') : empty('Nog geen uitgegeven nominaties.');
      if (global.document.getElementById('paidDebtList')) global.document.getElementById('paidDebtList').innerHTML = normalizeRows(data?.my_paid_debts).length ? normalizeRows(data.my_paid_debts).map((row)=>`<article class="dm-list-card"><div><strong>${esc(row.drink_label || '')}</strong><div class="muted">${playerLink(row.nominator_player_name || '')}</div></div><div class="dm-stack-right"><div class="dm-pill">${esc(row.status || '')}</div><div class="muted">${fmtDate(row.paid_at || row.penalty_applied_at)}</div></div></article>`).join('') : empty('Nog geen afgeronde schulden.');
      if (global.document.getElementById('wallOfShameSummary')) {
        const stats = data?.wall_of_shame?.stats || {};
        global.document.getElementById('wallOfShameSummary').innerHTML = `<div class="hero-metric"><span>Actief bevroren</span><strong>${Number(stats.active_frozen_users||0)}</strong><small>Scope: ${esc(scope())}</small></div><div class="hero-metric"><span>Refusals ooit</span><strong>${Number(stats.all_time_refusals||0)}</strong><small>Totaal verloren: ${money(stats.total_cautes_lost||0)}</small></div><div class="hero-metric"><span>Grootste ontweken schuld</span><strong>${money(stats.biggest_dodged_debt_cautes||0)}</strong><small>Wall of Shame</small></div>`;
      }
      const target = global.document.getElementById('nominationTarget');
      const drink = global.document.getElementById('nominationDrink');
      if (target) target.innerHTML = normalizeRows(data?.players).map((row)=>`<option value="${esc(row.player_name)}">${esc(row.player_name)}</option>`).join('');
      if (drink) drink.innerHTML = normalizeRows(data?.nomination_rules).filter((row)=>row.enabled_for_nomination).map((row)=>`<option value="${esc(row.drink_type_key || row.canonical_event_type_key)}">${esc(row.display_label)} — ${money(row.nomination_cost_cautes)}</option>`).join('');
      const form = global.document.getElementById('nominationForm');
      if (form) form.onsubmit = async (ev)=>{
        ev.preventDefault();
        setStatus('debtsStatus','Nominatie maken…');
        try {
          await rpc('despimarkt_create_drink_nomination_scoped', { session_token: token(), target_player_name_input: target.value, drink_type_key_input: drink.value, site_scope_input: scope() });
          setStatus('debtsStatus','Nominatie aangemaakt en meteen van je cautes afgeschreven.','ok');
          await loadDebtsPage(mode);
        } catch (err) { setStatus('debtsStatus', err.message || String(err), 'error'); }
      };
      wireDebtClearButtons();
      setStatus('debtsStatus','Schulden geladen.','ok');
    } catch (err) {
      setStatus('debtsStatus', err.message || String(err), 'error');
    }
  }

  function estimateReturn(market, outcomeKey, stake){
    const s = Number(stake || 0); if (!(s > 0)) return 0;
    const total = Number(market?.total_pot || 0); const a = Number(market?.outcome_a_pool || 0); const b = Number(market?.outcome_b_pool || 0);
    const chosen = outcomeKey === 'A' ? a : b;
    const totalAfter = total + s; const chosenAfter = chosen + s;
    if (chosenAfter <= 0) return 0;
    return Math.floor((s * totalAfter) / chosenAfter);
  }

  async function loadMarketPage(){
    if(!requirePlayer('despimarkt_market.html')) return;
    const marketId = Number(q('market') || 0);
    if (!marketId) { setStatus('marketStatus','Geen market-id gevonden.','error'); return; }
    setStatus('marketStatus','Market laden…');
    async function refresh(){
      try {
        const data = await rpc('despimarkt_get_market_state_scoped', { market_id_input: marketId, session_token: token(), site_scope_input: scope() });
        const market = data?.market || {};
        const total = Number(market.total_pot || 0);
        const a = Number(market.outcome_a_pool || 0);
        const b = Number(market.outcome_b_pool || 0);
        const pa = market.probability_a != null ? Number(market.probability_a) : (total>0 ? (a/total*100) : 0);
        const pb = market.probability_b != null ? Number(market.probability_b) : (total>0 ? (b/total*100) : 0);
        const myRows = normalizeRows(data?.my_positions);
        const promo = Number(market.promo_seed_cautes || 0);
        global.document.getElementById('marketTitle').textContent = market.title || "Beurs d'Espinoza";
        global.document.getElementById('marketMeta').innerHTML = `${esc(market.description || 'Geen beschrijving')}<br><span class="muted">Resolutie: ${esc(market.resolution_criteria || 'Niet opgegeven')}</span><br><span class="muted">Type: ${esc(marketTypeLabel(market.market_type_key))}</span>`;
        global.document.getElementById('marketWallet').textContent = money(data?.wallet?.balance_cautes || 0);
        if (global.document.getElementById('marketTagsRow')) global.document.getElementById('marketTagsRow').innerHTML = `${tagChips(market.market_tags || [])}${promoBadgeHtml(market)}`;
        if (global.document.getElementById('marketFollowChip')) global.document.getElementById('marketFollowChip').innerHTML = followButtonHtml(market);
        if (global.document.getElementById('marketPromoBanner')) global.document.getElementById('marketPromoBanner').innerHTML = promo ? `<div class="promo-banner">${promoBadgeHtml(market)} ${promoNoteHtml(market)}<div class="muted">Deze official backing komt uit de promotionele Beurs d'Espinoza-wallet en niet uit een persoonlijke spelerwallet.</div></div>` : '';
        global.document.getElementById('marketHeaderStats').innerHTML = `
          <div class="hero-metric"><span>Status</span><strong>${esc(market.status || '—')}</strong><small>Sluit ${shortDate(market.closes_at)}</small></div>
          <div class="hero-metric"><span>Totale pot</span><strong>${money(total)}</strong><small>${market.participant_count || 0} spelers · ${market.watcher_count || 0} volgers</small></div>
          <div class="hero-metric"><span>Prijsbeweging</span><strong>${Number(market.swing_points_a || 0)>0?'+':''}${Number(market.swing_points_a || 0).toFixed(1)} pts</strong><small>Opende op ${pct(market.opening_probability_a || 0)} voor kant A</small></div>
          <div class="hero-metric"><span>Promo backing</span><strong>${money(promo)}</strong><small>${promo ? `Official practice/promo liquidity op ${esc(String(market.promo_seed_outcome_key||'A')==='B'?(market.outcome_b_label||'B'):(market.outcome_a_label||'A'))}` : 'Geen promotionele backing'}</small></div>`;
        global.document.getElementById('outcomeA').innerHTML = `<span>${esc(market.outcome_a_label || 'A')}</span><strong>${pct(pa)}</strong><small>${money(a)}</small>`;
        global.document.getElementById('outcomeB').innerHTML = `<span>${esc(market.outcome_b_label || 'B')}</span><strong>${pct(pb)}</strong><small>${money(b)}</small>`;
        global.document.getElementById('probabilityBars').innerHTML = `${bar(market.outcome_a_label || 'A', `${pct(pa)} · ${money(a)}`, Math.max(pa,pb,1), 'gold')}${bar(market.outcome_b_label || 'B', `${pct(pb)} · ${money(b)}`, Math.max(pa,pb,1), 'sky')}`;
        global.document.getElementById('recentBets').innerHTML = normalizeRows(data?.recent_bets).length ? normalizeRows(data.recent_bets).map((row)=>`<article class="dm-list-card"><div><strong>${playerLink(row.player_name || '')}</strong><div class="muted">${esc(row.outcome_label || row.outcome_key || '')} · ${shortDate(row.created_at)}</div></div><div class="dm-stack-right"><div class="dm-pill">${money(row.stake_cautes || 0)}</div><div class="muted">${pct(row.probability_snapshot || 0)}</div></div></article>`).join('') : empty('Nog geen recente bets.');
        global.document.getElementById('myMarketPositions').innerHTML = myRows.length ? myRows.map((row)=>`<article class="dm-list-card"><div><strong>Kant ${esc(row.outcome_key || '')}</strong><div class="muted">${row.bet_count || 0} bets sinds ${shortDate(row.first_position_at)}</div></div><div class="dm-stack-right"><div class="dm-pill">${money(row.total_stake_cautes || 0)}</div><div class="muted">Laatste ${shortDate(row.last_position_at)}</div></div></article>`).join('') : empty('Nog geen eigen posities in deze market.');
        global.document.getElementById('settlementSummary').innerHTML = normalizeRows(data?.winner_payouts).length ? normalizeRows(data.winner_payouts).map((row)=>`<article class="dm-list-card"><div><strong>${playerLink(row.player_name || '')}</strong><div class="muted">Winnende stake ${money(row.winning_stake_cautes || 0)}</div></div><div class="dm-pill plus">${money(row.payout_cautes || 0)}</div></article>`).join('') : empty('Nog geen settlementregels.');
        const stakeField = global.document.getElementById('betStake');
        const outcomeField = global.document.getElementById('betOutcome');
        const preview = ()=>{
          const stake = Number(stakeField.value || 0);
          const chosen = outcomeField.value === 'B' ? 'B' : 'A';
          const chosenPool = chosen === 'A' ? a : b;
          const estimated = stake > 0 ? Math.floor(stake * ((total + stake) / Math.max(1, chosenPool + stake))) : 0;
          const nextProb = chosen === 'A' ? ((a + stake) / Math.max(1, total + stake)) * 100 : ((b + stake) / Math.max(1, total + stake)) * 100;
          global.document.getElementById('betPreview').innerHTML = `Indicatieve payout: <strong>${money(estimated)}</strong> · nieuwe ${chosen === 'A' ? esc(market.outcome_a_label || 'A') : esc(market.outcome_b_label || 'B')} kans: <strong>${pct(nextProb)}</strong>${promo ? ` · inclusief ${money(promo)} promotionele backing in de pot` : ''}`;
        };
        stakeField.oninput = preview; outcomeField.onchange = preview; preview();
        global.document.getElementById('betForm').onsubmit = async (ev)=>{
          ev.preventDefault();
          setStatus('marketStatus','Bet plaatsen…');
          try {
            await rpc('despimarkt_place_bet_scoped', { session_token: token(), market_id_input: marketId, outcome_key_input: outcomeField.value, stake_cautes_input: Number(stakeField.value||0), site_scope_input: scope() });
            setStatus('marketStatus','Bet geplaatst.','ok');
            await refresh();
          } catch (err) { setStatus('marketStatus', err.message || String(err), 'error'); }
        };
        await bindWatchButtons('marketStatus', refresh);
        setStatus('marketStatus','Market geladen.','ok');
      } catch (err) {
        setStatus('marketStatus', err.message || String(err), 'error');
      }
    }
    await refresh();
  }

  async function loadCreatePage(){
    if(!requirePlayer('despimarkt_create.html')) return;
    bindTemplateHelpers('market');
    global.document.getElementById('createForm').onsubmit = async (ev)=>{
      ev.preventDefault();
      setStatus('createStatus','Market maken…');
      try {
        const rawTags = String(global.document.getElementById('marketTagsInput')?.value || '');
        const tags = rawTags.split(',').map((tag)=>tag.trim()).filter(Boolean);
        const draft = buildTemplateDraft('market');
        const payload = {
          session_token: token(),
          title_input: draft.title,
          description_input: global.document.getElementById('marketDescriptionInput').value,
          resolution_criteria_input: global.document.getElementById('marketCriteriaInput').value,
          outcome_a_label_input: draft.outcomeA,
          outcome_b_label_input: draft.outcomeB,
          closes_at_input: new Date(global.document.getElementById('marketCloseAt').value).toISOString(),
          opening_probability_a_input: Number(global.document.getElementById('marketOpeningA').value || 50),
          seed_cautes_input: Number(global.document.getElementById('marketSeed').value || 0),
          market_tags_input: tags,
          market_type_key_input: draft.marketType,
          market_template_meta_input: draft.templateMeta,
          site_scope_input: scope()
        };
        const data = await rpc('despimarkt_create_market_scoped', payload);
        const marketId = data?.market?.market_id || q('market') || '';
        setStatus('createStatus','Market aangemaakt. Doorsturen…','ok');
        global.location.href = route(`./despimarkt_market.html?market=${encodeURIComponent(marketId)}`);
      } catch (err) { setStatus('createStatus', err.message || String(err), 'error'); }
    };
  }

  async function loadAdminPage(){
    if (!(global.GEJAST_ADMIN_RPC && await global.GEJAST_ADMIN_RPC.requirePage('admin_despimarkt.html'))) return;
    setStatus('adminStatus','Adminconsole laden…');
    bindTemplateHelpers('promoMarket');
    const scopeValue = ()=> (global.document.getElementById('adminScopeSelect')?.value || scope());
    async function refresh(){
      try {
        const [queue, audit, insights, mints, dry, debts, wallets] = await Promise.all([
          adminRpc('admin_get_despimarkt_resolution_queue_action', { admin_session_token: adminToken(), site_scope_input: scopeValue() }),
          adminRpc('admin_get_despimarkt_audit_action', { admin_session_token: adminToken(), site_scope_input: scopeValue(), limit_count: 100 }),
          adminRpc('admin_get_despimarkt_insights_action', { admin_session_token: adminToken(), site_scope_input: scopeValue(), limit_count: 40 }),
          adminRpc('admin_get_caute_mint_audit_action', { admin_session_token: adminToken(), site_scope_input: scopeValue(), limit_count: 80 }),
          rpc('despimarkt_get_wall_of_shame_scoped', { site_scope_input: scopeValue() }),
          adminRpc('admin_get_despimarkt_debt_queue_action', { admin_session_token: adminToken(), site_scope_input: scopeValue(), limit_count: 80 }),
          adminRpc('admin_get_despimarkt_house_wallets_action', { admin_session_token: adminToken(), site_scope_input: scopeValue(), limit_count: 20 })
        ]);

        global.document.getElementById('houseWalletList').innerHTML = normalizeRows(wallets?.rows).length ? normalizeRows(wallets.rows).map((row)=>`<article class="dm-list-card"><div><strong>${esc(row.display_label || row.wallet_key || '')}</strong><div class="muted">${esc(row.wallet_key || '')} · ${esc(row.site_scope || '')}</div></div><div class="dm-stack-right"><div class="dm-pill plus">${money(row.balance_cautes || 0)}</div><div class="muted">${shortDate(row.updated_at || row.created_at)}</div></div></article>`).join('') : empty('Nog geen promotionele wallets.');

        global.document.getElementById('resolutionQueue').innerHTML = normalizeRows(queue?.rows).length ? normalizeRows(queue.rows).map((row)=>`<article class="dm-list-card"><div><strong>${esc(row.title || '')}</strong><div class="muted">${money(row.total_pot || 0)} · ${row.participant_count || 0} spelers · sluit ${shortDate(row.closes_at)}</div>${tagChips(row.market_tags || [])}${promoBadgeHtml(row)}${promoNoteHtml(row)}</div><div class="admin-actions"><button class="btn alt" type="button" data-preview-market="${row.market_id}" data-preview-side="A">Preview A</button><button class="btn alt" type="button" data-preview-market="${row.market_id}" data-preview-side="B">Preview B</button><button class="btn success" type="button" data-resolve-market="${row.market_id}" data-resolve-side="A">Resolve A</button><button class="btn success alt" type="button" data-resolve-market="${row.market_id}" data-resolve-side="B">Resolve B</button><button class="btn danger" type="button" data-cancel-market="${row.market_id}">Refund</button></div></article>`).join('') : empty('Geen markten in de resolutiequeue.');

        if (global.document.getElementById('despimarktPulseCards')) {
          const pulseCards = Array.isArray(insights?.story_cards) ? insights.story_cards.slice(0,3) : [];
          const pulseOverview = Array.isArray(insights?.overview_cards) ? insights.overview_cards.slice(0,4) : [];
          global.document.getElementById('despimarktPulseCards').innerHTML = pulseOverview.concat(pulseCards).map((c)=>`<article class="card"><div class="k">${esc(c.label||'')}</div><div class="v">${esc(c.value||'')}</div><div class="sub">${esc(c.sub||'')}</div></article>`).join('') || '<div class="note">Nog geen pulse-data.</div>';
        }
        if (global.document.getElementById('despimarktPulseLeaders')) {
          const sections = Array.isArray(insights?.leaderboard_sections) ? insights.leaderboard_sections.slice(0,2) : [];
          global.document.getElementById('despimarktPulseLeaders').innerHTML = sections.map((sec)=>`<article class="section-card"><div><h3>${esc(sec.title||'')}</h3><p>${esc(sec.subtitle||'')}</p></div><div class="bar-list">${Array.isArray(sec.rows)&&sec.rows.length?sec.rows.slice(0,5).map((r)=>`<div class="bar-row"><div class="bar-head"><strong>${esc(r.label||'')}</strong><span>${esc(r.value||'')}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(6, Math.min(100, Number(r.value||0)))}%"></div></div><div class="bar-sub">${esc(r.sub||'')}</div></div>`).join(''):'<div class="note">Nog geen data.</div>'}</div></article>`).join('') || '<div class="note">Nog geen pulse-data.</div>';
        }

        global.document.getElementById('mintAudit').innerHTML = normalizeRows(mints?.rows).length ? normalizeRows(mints.rows).map((row)=>`<article class="dm-list-card"><div><strong>${playerLink(row.requester_player_name || '')}</strong><div class="muted">#${row.mint_request_id || 0} · ${esc(row.event_type_key || '')} · ${esc(row.status || '')}</div>${row.admin_cap_bypass ? '<div class="dm-pill plus">Bypass actief</div>' : ''}</div><div class="dm-stack-right"><div class="dm-pill">${money(row.awarded_cautes ?? row.requested_cautes ?? 0)}</div><div class="muted">req ${money(row.requested_cautes || 0)}</div><div class="muted">${shortDate(row.created_at)}</div>${(row.status === 'pending_verification' || row.status === 'verified_capped') ? `<button class="btn alt" type="button" data-mint-bypass="${row.mint_request_id}" data-mint-bypass-next="${row.admin_cap_bypass ? '0' : '1'}">${row.admin_cap_bypass ? 'Bypass uit' : 'Bypass aan'}</button>` : ''}</div></article>`).join('') : empty('Nog geen mintaudit.');

        global.document.getElementById('auditList').innerHTML = normalizeRows(audit?.rows).length ? normalizeRows(audit.rows).map((row)=>`<article class="dm-list-card"><div><strong>${esc(row.domain || '')} · ${esc(row.action_name || '')}</strong><div class="muted">${esc(row.actor_name || 'systeem')} · ${shortDate(row.created_at)}</div></div><div class="muted">${esc(JSON.stringify(row.payload || {}))}</div></article>`).join('') : empty('Nog geen auditregels.');

        const wallRows = normalizeRows(dry?.rows);
        global.document.getElementById('freezeList').innerHTML = wallRows.length ? wallRows.map((row)=>`<article class="dm-list-card"><div><strong>${playerLink(row.player_name || '')}</strong><div class="muted">Refusals: ${row.refusal_count || 0} · verlies ${money(row.total_penalty_cautes || 0)}</div></div><div class="dm-stack-right">${row.is_frozen?'<div class="dm-pill danger">Frozen</div>':'<div class="dm-pill">Historisch</div>'}${row.is_frozen?`<button class="btn alt" type="button" data-unfreeze-player="${esc(row.player_name || '')}">Unfreeze</button>`:''}</div></article>`).join('') : empty('Geen Dry Dock-gevallen.');

        if (global.document.getElementById('debtQueue')) global.document.getElementById('debtQueue').innerHTML = normalizeRows(debts?.rows).length ? normalizeRows(debts.rows).map((row)=>`<article class="dm-list-card"><div><strong>${playerLink(row.target_player_name || '')}</strong><div class="muted">Door ${playerLink(row.nominator_player_name || '')} · ${esc(row.drink_label || row.drink_type_key || '')} · ${esc(row.status || '')}</div><div class="muted">Deadline ${shortDate(row.expires_at)}</div></div><div class="admin-actions"><button class="btn alt" type="button" data-extend-debt="${row.debt_id}" data-extend-hours="6">+6u</button><button class="btn alt" type="button" data-extend-debt="${row.debt_id}" data-extend-hours="24">+24u</button><button class="btn alt" type="button" data-extend-debt="${row.debt_id}" data-extend-hours="72">+72u</button></div></article>`).join('') : empty('Geen open of pending schulden.');

        global.document.querySelectorAll('[data-preview-market]').forEach((btn)=>btn.onclick = async ()=>{
          setStatus('adminStatus','Settlement preview laden…');
          try {
            const data = await adminRpc('admin_preview_despimarkt_market_settlement_action', { admin_session_token: adminToken(), market_id_input: Number(btn.dataset.previewMarket), winning_outcome_key_input: btn.dataset.previewSide, site_scope_input: scopeValue() });
            global.document.getElementById('previewPane').innerHTML = `<div class="preview-box"><h3>${esc(data?.market?.title || 'Preview')}</h3><p class="muted">${data?.is_invalid ? 'Deze markt lijkt ongeldig en hoort waarschijnlijk naar refund.' : 'Serverpreview van de settlement.'}</p>${promoBadgeHtml(data?.market)}${promoNoteHtml(data?.market)}${normalizeRows(data?.preview_payouts).length ? normalizeRows(data.preview_payouts).map((row)=>`<div class="dm-list-card"><div><strong>${playerLink(row.player_name || '')}</strong><div class="muted">Winnende stake ${money(row.winning_stake_cautes || 0)}</div></div><div class="dm-pill plus">${money(row.payout_cautes || 0)}</div></div>`).join('') : note('Geen payoutpreview beschikbaar.')}</div>`;
            setStatus('adminStatus','Settlement preview geladen.','ok');
          } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
        });
        global.document.querySelectorAll('[data-resolve-market]').forEach((btn)=>btn.onclick = async ()=>{
          const summary = global.prompt('Korte resolutiesamenvatting:', '');
          if (summary === null) return;
          setStatus('adminStatus','Market resolven…');
          try {
            await adminRpc('admin_resolve_despimarkt_market_action', { admin_session_token: adminToken(), market_id_input: Number(btn.dataset.resolveMarket), winning_outcome_key_input: btn.dataset.resolveSide, resolution_summary_input: summary, site_scope_input: scopeValue() });
            setStatus('adminStatus','Market resolved en payout-announcement aangemaakt.','ok');
            await refresh();
          } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
        });
        global.document.querySelectorAll('[data-cancel-market]').forEach((btn)=>btn.onclick = async ()=>{
          const reason = global.prompt('Reden voor refund/cancel:', '');
          if (reason === null) return;
          setStatus('adminStatus','Market refunden…');
          try {
            await adminRpc('admin_cancel_despimarkt_market_action', { admin_session_token: adminToken(), market_id_input: Number(btn.dataset.cancelMarket), reason_input: reason, site_scope_input: scopeValue() });
            setStatus('adminStatus','Market geannuleerd en refunds geschreven.','ok');
            await refresh();
          } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
        });
        global.document.querySelectorAll('[data-unfreeze-player]').forEach((btn)=>btn.onclick = async ()=>{
          setStatus('adminStatus','Speler unfreezen…');
          try {
            await adminRpc('admin_unfreeze_despimarkt_player_action', { admin_session_token: adminToken(), player_name_input: btn.dataset.unfreezePlayer, site_scope_input: scopeValue() });
            setStatus('adminStatus','Speler ge-unfreezed.','ok');
            await refresh();
          } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
        });
        global.document.querySelectorAll('[data-mint-bypass]').forEach((btn)=>btn.onclick = async ()=>{
          const next = String(btn.dataset.mintBypassNext || '1') === '1';
          const reason = global.prompt(next ? 'Reden voor mint-cap bypass:' : 'Reden om bypass weer uit te zetten:', '');
          if (reason === null) return;
          setStatus('adminStatus', next ? 'Mint-bypass activeren…' : 'Mint-bypass uitschakelen…');
          try {
            await adminRpc('admin_override_despimarkt_mint_cap_action', { admin_session_token: adminToken(), mint_request_id_input: Number(btn.dataset.mintBypass), bypass_enabled_input: next, reason_input: reason, site_scope_input: scopeValue() });
            setStatus('adminStatus', next ? 'Mint-cap bypass toegepast.' : 'Mint-cap bypass verwijderd.', 'ok');
            await refresh();
          } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
        });
        global.document.querySelectorAll('[data-extend-debt]').forEach((btn)=>btn.onclick = async ()=>{
          const hours = Number(btn.dataset.extendHours || 24);
          const reason = global.prompt(`Reden voor +${hours} uur deadline-extensie:`, '');
          if (reason === null) return;
          setStatus('adminStatus','Debt deadline verlengen…');
          try {
            await adminRpc('admin_extend_despimarkt_debt_deadline_action', { admin_session_token: adminToken(), debt_id_input: Number(btn.dataset.extendDebt), extend_hours_input: hours, reason_input: reason, site_scope_input: scopeValue() });
            setStatus('adminStatus', 'Debt deadline verlengd.', 'ok');
            await refresh();
          } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
        });
        setStatus('adminStatus',"Adminconsole van Beurs d'Espinoza geladen.",'ok');
      } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
    }

    global.document.getElementById('adminScopeSelect').onchange = refresh;
    const runNow = global.document.getElementById('runMaintenanceNow');
    if (runNow) runNow.onclick = async ()=>{
      setStatus('adminStatus','Achtergrondonderhoud uitvoeren…');
      try {
        const data = await adminRpc('admin_run_despimarkt_maintenance_action', { admin_session_token: adminToken(), site_scope_input: scopeValue() });
        setStatus('adminStatus', `Onderhoud klaar · ${data?.penalized_count || 0} Dry Dock penalties · ${data?.close_soon_notifications || 0} follow-alerts.`, 'ok');
        await refresh();
      } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
    };
    global.document.getElementById('adjustForm').onsubmit = async (ev)=>{
      ev.preventDefault();
      setStatus('adminStatus','Balans aanpassen…');
      try {
        await adminRpc('admin_adjust_despimarkt_cautes_action', { admin_session_token: adminToken(), player_name_input: global.document.getElementById('adjustPlayerName').value, delta_cautes_input: Number(global.document.getElementById('adjustDelta').value || 0), reason_input: global.document.getElementById('adjustReason').value, site_scope_input: scopeValue() });
        setStatus('adminStatus','Balans aangepast.','ok');
        global.document.getElementById('adjustForm').reset();
        await refresh();
      } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
    };
    const houseForm = global.document.getElementById('houseWalletForm');
    if (houseForm) houseForm.onsubmit = async (ev)=>{
      ev.preventDefault();
      setStatus('adminStatus','Promotionele wallet aanpassen…');
      try {
        await adminRpc('admin_adjust_despimarkt_house_wallet_action', {
          admin_session_token: adminToken(),
          wallet_key_input: global.document.getElementById('houseWalletKey').value,
          delta_cautes_input: Number(global.document.getElementById('houseWalletDelta').value || 0),
          reason_input: global.document.getElementById('houseWalletReason').value,
          display_label_input: "Beurs d'Espinoza promotionele wallet",
          site_scope_input: scopeValue()
        });
        setStatus('adminStatus','Promotionele wallet bijgewerkt.','ok');
        houseForm.reset();
        global.document.getElementById('houseWalletKey').value = 'promo_pool';
        global.document.getElementById('houseWalletDelta').value = '250';
        await refresh();
      } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
    };
    const promoForm = global.document.getElementById('promoMarketForm');
    if (promoForm) promoForm.onsubmit = async (ev)=>{
      ev.preventDefault();
      setStatus('adminStatus','Promotionele market maken…');
      try {
        const rawTags = String(global.document.getElementById('promoMarketTagsInput')?.value || '');
        const tags = rawTags.split(',').map((tag)=>tag.trim()).filter(Boolean);
        const draft = buildTemplateDraft('promoMarket');
        const data = await adminRpc('admin_create_promotional_market_action', {
          admin_session_token: adminToken(),
          title_input: draft.title,
          description_input: global.document.getElementById('promoMarketDescriptionInput').value,
          resolution_criteria_input: global.document.getElementById('promoMarketCriteriaInput').value,
          outcome_a_label_input: draft.outcomeA,
          outcome_b_label_input: draft.outcomeB,
          closes_at_input: new Date(global.document.getElementById('promoMarketCloseAt').value).toISOString(),
          opening_probability_a_input: Number(global.document.getElementById('promoMarketOpeningA').value || 50),
          promo_backed_outcome_key_input: global.document.getElementById('promoBackedOutcome').value,
          promo_seed_cautes_input: Number(global.document.getElementById('promoMarketSeed').value || 0),
          badge_text_input: global.document.getElementById('promoBadgeText').value || 'Promotie',
          house_wallet_key_input: 'promo_pool',
          market_tags_input: tags,
          market_type_key_input: draft.marketType,
          market_template_meta_input: draft.templateMeta,
          site_scope_input: scopeValue()
        });
        const marketId = data?.market?.market_id || data?.market_id || '';
        setStatus('adminStatus','Promotionele market aangemaakt.','ok');
        await refresh();
        if (marketId) global.location.href = route(`./despimarkt_market.html?market=${encodeURIComponent(marketId)}`);
      } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
    };
    const practiceBtn = global.document.getElementById('quickPracticeMarket');
    if (practiceBtn) practiceBtn.onclick = async ()=>{
      setStatus('adminStatus','Oefenmarkt Wolf / April maken…');
      try {
        const data = await adminRpc('admin_create_default_practice_market_action', { admin_session_token: adminToken(), site_scope_input: scopeValue() });
        const marketId = data?.market?.market_id || data?.market_id || '';
        setStatus('adminStatus', data?.already_exists ? 'Oefenmarkt bestond al en is geopend.' : 'Oefenmarkt aangemaakt.', 'ok');
        await refresh();
        if (marketId) global.location.href = route(`./despimarkt_market.html?market=${encodeURIComponent(marketId)}`);
      } catch (err) { setStatus('adminStatus', err.message || String(err), 'error'); }
    };
    await refresh();
  }

  async function loadLadderPage(kind){
    setStatus('ladderStatus','Ladder laden…');
    try {
      const rpcName = kind === 'paardenrace' ? 'get_paardenrace_ladder_public_scoped' : kind === 'pikken' ? 'get_pikken_ladder_public_scoped' : 'get_despimarkt_ladder_public_scoped';
      const data = await rpc(rpcName, { site_scope_input: scope(), limit_count: 100 });
      const rows = normalizeRows(data?.rows);
      const title = kind === 'paardenrace' ? 'Paardenrace-ladder' : kind === 'pikken' ? 'Pikken-ladder' : 'Beurs d\'Espinoza-ladder';
      global.document.getElementById('ladderTitle').textContent = title;
      global.document.getElementById('ladderIntro').textContent = kind === 'despimarkt' ? 'Hoogste huidige cautebalansen.' : 'Generieke ELO-infrastructuur op basis van de huidige ratings.';
      global.document.getElementById('ladderRows').innerHTML = rows.length ? rows.map((row, idx)=>`<article class="ladder-rank-card"><div class="rank-pill">#${idx+1}</div><div><strong>${playerLink(row.player_name || row.display_name || '')}</strong><div class="muted">${kind==='despimarkt' ? `${row.markets_joined || 0} markten · ${row.markets_won || 0} gewonnen` : `${row.games_played || 0} games · ${row.wins || 0} wins`}</div></div><div class="dm-pill ${kind==='despimarkt'?'plus':''}">${kind==='despimarkt'?money(row.balance_cautes || row.caute_coins || 0):Math.round(Number(row.elo_rating || 0))}</div></article>`).join('') : empty('Nog geen ladderdata.');
      if (global.document.getElementById('ladderHistory')) {
        const hist = normalizeRows(data?.history);
        global.document.getElementById('ladderHistory').innerHTML = hist.length ? hist.slice(0,40).map((row)=>`<article class="dm-list-card"><div><strong>${playerLink(row.player_name || '')}</strong><div class="muted">${shortDate(row.event_at)}</div></div><div class="dm-stack-right"><div class="dm-pill">${Math.round(Number(row.rating_after || 0))}</div><div class="muted">Δ ${Number(row.delta || 0).toFixed(2)}</div></div></article>`).join('') : empty('Nog geen geschiedenisregels.');
      }
      setStatus('ladderStatus','Ladder geladen.','ok');
    } catch (err) { setStatus('ladderStatus', err.message || String(err), 'error'); }
  }

  async function loadDryDockStatsInto(containerId='despimarktDryDockPanel', listId='despimarktDryDockList'){
    const shell = global.document.getElementById(containerId); if(!shell) return;
    try {
      const data = await rpc('despimarkt_get_dry_dock_stats_scoped', { site_scope_input: scope() });
      shell.innerHTML = `<div class="metric"><div class="metric-label">Actief bevroren</div><div class="metric-value">${Number(data.active_frozen_users||0)}</div><div class="metric-note">Dry Dock</div></div><div class="metric"><div class="metric-label">Refusals ooit</div><div class="metric-value">${Number(data.all_time_refusals||0)}</div><div class="metric-note">In deze scope</div></div><div class="metric"><div class="metric-label">Verloren cautes</div><div class="metric-value">${money(data.total_cautes_lost||0)}</div><div class="metric-note">Strafpunten</div></div><div class="metric"><div class="metric-label">Grootste ontweken schuld</div><div class="metric-value">${money(data.biggest_dodged_debt_cautes||0)}</div><div class="metric-note">Wall of Shame</div></div>`;
      const list = global.document.getElementById(listId); if(list) list.innerHTML = normalizeRows(data?.offenders).length ? normalizeRows(data.offenders).slice(0,5).map((row)=>`<div class="item"><div class="item-main"><div class="item-title">${playerLink(row.player_name || '')}</div><div class="item-sub">${row.refusal_count || 0} refusals · ${row.is_frozen?'nu frozen':'historisch'}</div></div><div class="item-value">${money(row.total_penalty_cautes || 0)}</div></div>`).join('') : '<div class="note">Nog geen Dry Dock-gevallen.</div>';
    } catch (err) {
      shell.innerHTML = `<div class="note">${esc(err.message || String(err))}</div>`;
    }
  }

  global.GEJAST_DESPIMARKT = {
    rpc,
    adminRpc,
    route,
    scope,
    token,
    money,
    pct,
    fmtDate,
    shortDate,
    playerLink,
    loadHubPage,
    loadWalletPage,
    loadDebtsPage,
    loadMarketPage,
    loadCreatePage,
    loadAdminPage,
    loadLadderPage,
    loadDryDockStatsInto
  };
})(window);
