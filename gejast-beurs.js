(function(){
  const CONFIG = window.GEJAST_CONFIG || {};
  const UI = {
    hero: document.getElementById('beursHeroStatus'),
    stats: document.getElementById('beursStats'),
    desk: document.getElementById('beursDesk'),
    leaderboard: document.getElementById('beursLeaderboard'),
    depth: document.getElementById('beursDepth'),
    pulse: document.getElementById('beursPulse'),
    notes: document.getElementById('beursNotes')
  };

  function headers(){
    return {
      apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY || ''}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  async function parse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_){ throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || text || `HTTP ${res.status}`);
    return data;
  }

  async function rpc(name, payload){
    const raw = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: headers(),
      body: JSON.stringify(payload || {})
    }).then(parse);
    return raw?.[name] !== undefined ? raw[name] : raw;
  }

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, (ch)=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }

  function n(value){ return Number(value || 0) || 0; }
  function round(value, digits){ const p = Math.pow(10, digits || 0); return Math.round(n(value) * p) / p; }
  function fmtCoins(value){ return `₵ ${Math.round(n(value))}`; }
  function fmtPct(value){ return `${round(value, 1)}%`; }

  function sessionToken(){
    return CONFIG.getPlayerSessionToken ? (CONFIG.getPlayerSessionToken() || '') : '';
  }

  async function fetchViewer(){
    const token = sessionToken();
    if (!token) return { name:'Niet ingelogd', balance:null, loggedIn:false };
    let name = 'Ingelogde speler';
    try {
      if (CONFIG.fetchViewerProfile) {
        const viewer = await CONFIG.fetchViewerProfile();
        name = viewer?.player_name || viewer?.chosen_username || viewer?.public_display_name || name;
      }
    } catch (_) {}
    try {
      const balance = await rpc('get_my_caute_coins_public', { session_token: token, session_token_input: token });
      return {
        name,
        balance: n(balance?.balance ?? balance?.caute_coins ?? balance?.viewer_balance),
        loggedIn:true
      };
    } catch (error) {
      return { name, balance:null, loggedIn:true, error: error?.message || String(error) };
    }
  }

  async function fetchTop(){
    const payload = await rpc('get_caute_coin_top5_public', {});
    const rows = Array.isArray(payload?.rows) ? payload.rows : (Array.isArray(payload) ? payload : []);
    return rows.map((row, idx)=>(
      {
        rank: idx + 1,
        name: row.player_name || row.display_name || row.public_display_name || 'Onbekend',
        balance: n(row.coins ?? row.caute_coins ?? row.balance),
        raw: row
      }
    ));
  }

  function metrics(top, viewer){
    const leader = top[0] || null;
    const runner = top[1] || null;
    const total = top.reduce((sum, row)=>sum + row.balance, 0);
    const average = top.length ? total / top.length : 0;
    const spread = leader && runner ? leader.balance - runner.balance : leader ? leader.balance : 0;
    const concentration = total ? ((leader ? leader.balance : 0) / total) * 100 : 0;
    const viewerGap = leader && Number.isFinite(viewer.balance) ? Math.max(0, leader.balance - viewer.balance) : null;
    const viewerInTop = Number.isFinite(viewer.balance) ? top.some((row)=>row.name.toLowerCase() === String(viewer.name || '').toLowerCase()) : false;
    return { leader, runner, total, average, spread, concentration, viewerGap, viewerInTop };
  }

  function renderStats(top, viewer, meta){
    const cards = [
      {
        label:'Speler',
        value: esc(viewer.name || '—'),
        sub: viewer.loggedIn ? (viewer.error ? `Coinsaldo niet geladen: ${esc(viewer.error)}` : 'Huidige spelersessie gedetecteerd.') : 'Log in om je eigen coinstand te laden.'
      },
      {
        label:'Mijn caute coins',
        value: viewer.balance === null ? '—' : fmtCoins(viewer.balance),
        sub: viewer.balance === null ? 'Nog geen persoonlijk saldo beschikbaar.' : (meta.viewerGap !== null ? `${fmtCoins(meta.viewerGap)} achter de koploper.` : 'Vergelijkbaar met de publieke top.')
      },
      {
        label:'Koploper',
        value: meta.leader ? esc(meta.leader.name) : '—',
        sub: meta.leader ? `${fmtCoins(meta.leader.balance)} · ${fmtPct(meta.concentration)} van zichtbare markt` : 'Nog geen publieke coinstand.'
      },
      {
        label:'Top 5 samen',
        value: fmtCoins(meta.total),
        sub: top.length ? `${top.length} zichtbare posities in de huidige marktlaag.` : 'Nog geen zichtbare posities.'
      },
      {
        label:'Spread 1 → 2',
        value: fmtCoins(meta.spread),
        sub: meta.runner ? `${esc(meta.leader.name)} staat ${fmtCoins(meta.spread)} voor op ${esc(meta.runner.name)}.` : 'Nog geen tweede positie zichtbaar.'
      },
      {
        label:'Gemiddelde',
        value: fmtCoins(meta.average),
        sub: top.length ? 'Gemiddelde coinstand van de huidige top 5.' : 'Wacht op publieke coindata.'
      }
    ];
    UI.stats.innerHTML = cards.map((card)=>`
      <div class="stat-card">
        <div class="stat-label">${card.label}</div>
        <div class="stat-value">${card.value}</div>
        <div class="stat-sub">${card.sub}</div>
      </div>
    `).join('');
  }

  function renderDesk(top, viewer, meta){
    UI.desk.innerHTML = `
      <div class="notice-card">
        <strong>DespiMarket is nu weer bruikbaar als live marktbord</strong>
        <p>Deze pagina trekt weer echte data uit de bestaande Caute Coins-RPC's: je eigen coinstand, de publieke top en de zichtbare marktverdeling. De handelsmotor zelf staat nog niet in deze repo, maar de marktlaag is niet langer een dode placeholder.</p>
      </div>
      <div class="notice-card ${top.length ? '' : 'warn'}">
        <strong>Handelsmotor</strong>
        <p>${top.length ? `De coinvloer draait en laat ${top.length} publieke posities zien. Zolang er geen marktbied-RPC en bied-opslag-SQL in de repo zit, blijft dit een live marktbord en geen orderinvoer.` : 'Er komt nog geen publieke coindata terug. Dan blijft de vloer leeg tot de backend weer iets teruggeeft.'}</p>
      </div>
      <div class="notice-card ${viewer.loggedIn ? '' : 'warn'}">
        <strong>Jouw positie</strong>
        <p>${viewer.loggedIn ? (viewer.balance === null ? 'Je sessie is wel gevonden, maar je coinstand kwam nog niet terug uit de backend.' : (meta.viewerGap === null ? 'Je coinstand is geladen.' : `Je staat ${fmtCoins(meta.viewerGap)} achter de huidige koploper.`)) : 'Log in om je eigen coinstand en relatieve marktpositie direct op de vloer te zien.'}</p>
      </div>
    `;
  }

  function renderLeaderboard(top, meta){
    if (!top.length) {
      UI.leaderboard.innerHTML = '<div class="empty">Nog geen coin-ranglijst gevonden.</div>';
      return;
    }
    UI.leaderboard.innerHTML = top.map((row)=>{
      const share = meta.total ? (row.balance / meta.total) * 100 : 0;
      const behind = meta.leader ? Math.max(0, meta.leader.balance - row.balance) : 0;
      return `
        <div class="leader-row">
          <div class="leader-rank">${row.rank}</div>
          <div>
            <strong>${esc(row.name)}</strong>
            <div class="leader-meta">
              <span class="chip">${fmtPct(share)} van top 5</span>
              <span class="chip">${row.rank === 1 ? 'marktleider' : `${fmtCoins(behind)} achter`}</span>
            </div>
          </div>
          <div class="leader-coins">${fmtCoins(row.balance)}</div>
        </div>
      `;
    }).join('');
  }

  function renderDepth(top, meta){
    if (!top.length) {
      UI.depth.innerHTML = '<div class="empty">Nog geen coinverdeling beschikbaar.</div>';
      return;
    }
    UI.depth.innerHTML = top.map((row)=>{
      const share = meta.total ? (row.balance / meta.total) * 100 : 0;
      return `
        <div class="depth-row">
          <div class="depth-head">
            <span>${esc(row.name)}</span>
            <span>${fmtCoins(row.balance)}</span>
          </div>
          <div class="depth-bar"><div class="depth-fill" style="width:${Math.max(4, Math.min(100, share))}%"></div></div>
          <div class="muted">${fmtPct(share)} van de zichtbare top-5 coinmassa</div>
        </div>
      `;
    }).join('');
  }

  function renderPulse(top, viewer, meta){
    const cards = [
      {
        kicker:'Marktleider',
        title: meta.leader ? esc(meta.leader.name) : '—',
        body: meta.leader ? `${fmtCoins(meta.leader.balance)} op kop.` : 'Nog geen leider zichtbaar.'
      },
      {
        kicker:'Druk op plek 2',
        title: meta.runner ? fmtCoins(meta.spread) : '—',
        body: meta.runner ? `${esc(meta.runner.name)} moet nog ${fmtCoins(meta.spread)} overbruggen.` : 'Nog geen tweede positie zichtbaar.'
      },
      {
        kicker:'Concentratie',
        title: fmtPct(meta.concentration),
        body: 'Aandeel van de leider binnen de zichtbare top 5.'
      },
      {
        kicker:'Jouw zicht',
        title: viewer.balance === null ? '—' : (meta.viewerInTop ? 'Top 5' : fmtCoins(viewer.balance)),
        body: viewer.balance === null ? 'Log in of laad je coinstand opnieuw.' : (meta.viewerInTop ? 'Je huidige coinstand zit al in de zichtbare top.' : 'Je coinstand staat buiten de zichtbare top of is lager dan de huidige kopgroep.')
      }
    ];
    UI.pulse.innerHTML = cards.map((card)=>`
      <div class="meta-card">
        <div class="kicker">${card.kicker}</div>
        <strong>${card.title}</strong>
        <div class="muted" style="margin-top:8px">${card.body}</div>
      </div>
    `).join('');
  }

  function renderNotes(top, viewer, meta){
    const notes = [];
    if (!top.length) {
      notes.push({ title:'De vloer is leeg', body:'Er komt nog geen publieke coinstand terug. Dan kun je hier pas iets leren zodra de coin-RPC weer data levert.' });
    } else {
      notes.push({ title:'Wie drukt de markt?', body:`${esc(meta.leader.name)} trekt momenteel ${fmtPct(meta.concentration)} van de zichtbare top-5 coinmassa naar zich toe.` });
      if (meta.runner) notes.push({ title:'Hoe spannend is de top?', body:`Tussen plek 1 en 2 zit nu ${fmtCoins(meta.spread)} verschil.` });
      notes.push({ title:'Wat kun je hier al wél volgen?', body:'Coinverdeling, kopgroepdruk, zichtbare concentratie en je eigen relatieve positie ten opzichte van de leider.' });
    }
    notes.push({ title:'Wat staat nog uit?', body:'Voor echte biedingen, orderinvoer en admin-correcties is nog steeds een echte backend-owner path nodig: marktbied-RPC plus bied-opslag-SQL.' });
    if (!viewer.loggedIn) notes.push({ title:'Log in voor je eigen desk', body:'Dan zie je je eigen coinstand direct op deze marktvloer naast de publieke top.' });
    UI.notes.innerHTML = notes.map((note, idx)=>`<div class="notice-card ${idx === notes.length - 1 ? 'warn' : ''}"><strong>${note.title}</strong><p>${note.body}</p></div>`).join('');
  }

  async function boot(){
    UI.hero.textContent = 'Live marktbord op basis van de bestaande Caute Coins-laag.';
    const [viewerResult, topResult] = await Promise.allSettled([fetchViewer(), fetchTop()]);
    const viewer = viewerResult.status === 'fulfilled' ? viewerResult.value : { name:'Onbekend', balance:null, loggedIn:false, error: viewerResult.reason?.message || String(viewerResult.reason || '') };
    const top = topResult.status === 'fulfilled' ? topResult.value : [];
    const meta = metrics(top, viewer);

    if (topResult.status === 'rejected') {
      UI.hero.textContent = `Marktbord gedeeltelijk geladen — coinranglijst faalde: ${topResult.reason?.message || 'onbekende fout'}`;
    } else if (!top.length) {
      UI.hero.textContent = 'Marktbord live, maar de coinvloer geeft nog geen publieke posities terug.';
    } else {
      UI.hero.textContent = `${esc(meta.leader.name)} leidt met ${fmtCoins(meta.leader.balance)} · zichtbare top 5 samen ${fmtCoins(meta.total)}.`;
    }

    renderStats(top, viewer, meta);
    renderDesk(top, viewer, meta);
    renderLeaderboard(top, meta);
    renderDepth(top, meta);
    renderPulse(top, viewer, meta);
    renderNotes(top, viewer, meta);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();
