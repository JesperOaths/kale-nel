(function(){
  const cfg = window.GEJAST_CONFIG || {};
  function scope(){
    try {
      if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.getScope === 'function') return window.GEJAST_SCOPE_UTILS.getScope();
      const raw = new URLSearchParams(location.search).get('scope') || 'friends';
      return String(raw).toLowerCase() === 'family' ? 'family' : 'friends';
    } catch (_) {
      return 'friends';
    }
  }
  function headers(){
    const key = cfg.SUPABASE_PUBLISHABLE_KEY || '';
    return { apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', Accept:'application/json' };
  }
  async function parse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.hint || `HTTP ${res.status}`);
    return data;
  }
  function unwrap(raw, key){
    if (raw && key && raw[key] !== undefined) return raw[key];
    if (Array.isArray(raw) && raw[0] && key && raw[0][key] !== undefined) return raw[0][key];
    if (Array.isArray(raw) && raw[0] !== undefined) return raw[0];
    return raw || {};
  }
  async function rpc(fn, body){
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method:'POST',
      mode:'cors',
      cache:'no-store',
      headers: headers(),
      body: JSON.stringify(body || {})
    });
    const raw = await parse(res);
    return unwrap(raw, fn);
  }
  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }
  function n(value, fallback=0){
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }
  function pct(value, digits=0){ return `${(n(value, 0) * 100).toFixed(digits)}%`; }
  function pctMaybeWhole(value, digits=0){
    const num = n(value, NaN);
    if (!Number.isFinite(num)) return '0%';
    return `${(num > 1 ? num : num * 100).toFixed(digits)}%`;
  }
  function fmt(value, digits=0){ return n(value, 0).toFixed(digits); }
  function compact(value){ return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(n(value, 0)); }
  function dateLabel(value){
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value || '—') : d.toLocaleDateString('nl-NL', { day:'numeric', month:'short' });
  }
  function dateTimeLabel(value){
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value || '—') : d.toLocaleString('nl-NL');
  }
  function playerName(row){
    return String(row?.player_name || row?.display_name || row?.public_display_name || row?.chosen_username || row?.nickname || row?.name || 'Onbekend');
  }
  function playerLink(name, game){
    const href = `./player.html?player=${encodeURIComponent(name || '')}${game ? `&game=${encodeURIComponent(game)}` : ''}`;
    return `<a href="${href}" style="color:inherit;text-decoration:none;font-weight:800">${esc(name || 'Onbekend')}</a>`;
  }
  function dedupeNames(values){
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map((v)=>String(v || '').trim()).filter((v)=>{
      const key = v.toLowerCase();
      if (!v || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function normalizeLadderPayload(raw){
    const data = unwrap(raw);
    return {
      ladder: Array.isArray(data?.ladder) ? data.ladder : [],
      recent_matches: Array.isArray(data?.recent_matches) ? data.recent_matches : [],
      history_series: Array.isArray(data?.history_series) ? data.history_series : [],
      pair_stats: Array.isArray(data?.pair_stats) ? data.pair_stats : [],
      matchup_stats: Array.isArray(data?.matchup_stats) ? data.matchup_stats : []
    };
  }
  function statCard(card){
    return `<article class="lab-stat-card"><div class="lab-k">${esc(card.k || '')}</div><div class="lab-v">${esc(card.v || '—')}</div>${card.sub ? `<div class="lab-sub">${esc(card.sub)}</div>` : ''}</article>`;
  }
  function renderStats(cards){
    const rows = (Array.isArray(cards) ? cards : []).filter((card)=>card && (card.k || card.v !== undefined));
    return rows.length ? `<div class="lab-stats-grid">${rows.map(statCard).join('')}</div>` : '<div class="lab-empty">Nog geen statistieken beschikbaar.</div>';
  }
  function renderLeaderboard(rows, options={}){
    const list = (Array.isArray(rows) ? rows : []).slice(0, options.limit || 12);
    if (!list.length) return '<div class="lab-empty">Nog geen ladderdata.</div>';
    return `<div class="lab-leaderboard">${list.map((row, idx)=>{
      const name = playerName(row);
      const right = options.rightText ? options.rightText(row, idx) : `${Math.round(n(row?.elo_rating || row?.rating || row?.coins || row?.balance || 0))}`;
      const meta = options.metaText ? options.metaText(row, idx) : `${Math.round(n(row?.games_played || row?.matches_played || 0))} gespeeld · ${pctMaybeWhole(row?.win_pct || 0)}`;
      return `<div class="lab-leader-row"><div class="lab-rank">#${idx+1}</div><div class="lab-main"><div class="lab-name">${playerLink(name, options.game || '')}</div><div class="lab-meta">${esc(meta)}</div></div><div class="lab-right">${esc(right)}</div></div>`;
    }).join('')}</div>`;
  }
  function smoothPath(points, xFn, yFn){
    if (!points.length) return '';
    if (points.length === 1) return `M ${xFn(0)} ${yFn(points[0].y)} L ${xFn(0)+1} ${yFn(points[0].y)}`;
    let d = `M ${xFn(0)} ${yFn(points[0].y)}`;
    for (let i=0; i<points.length-1; i++){
      const x0 = xFn(i), y0 = yFn(points[i].y), x1 = xFn(i+1), y1 = yFn(points[i+1].y);
      const mid = (x0 + x1) / 2;
      d += ` C ${mid} ${y0}, ${mid} ${y1}, ${x1} ${y1}`;
    }
    return d;
  }
  function renderLineChart(series, options={}){
    const rows = (Array.isArray(series) ? series : []).filter((s)=>s && Array.isArray(s.points) && s.points.length);
    if (!rows.length) return '<div class="lab-empty">Nog geen grafiekdata.</div>';
    const palette = options.palette || ['#9a8241','#3b82f6','#e53935','#16a34a','#7c3aed','#ea580c','#0f766e','#be185d'];
    const W = 960, H = 360, L = 58, R = 24, T = 20, B = 44;
    const allY = rows.flatMap((s)=>s.points.map((p)=>n(p.y,0)));
    const minY = Math.min(...allY);
    const maxY = Math.max(...allY);
    const pad = Math.max(1, (maxY - minY) * 0.08 || 10);
    const low = minY - pad;
    const high = maxY + pad;
    const maxPoints = Math.max(...rows.map((s)=>s.points.length));
    const xFn = (idx)=> L + ((W - L - R) * (maxPoints <= 1 ? 0 : idx / (maxPoints - 1)));
    const yFn = (value)=> T + ((H - T - B) * (1 - ((n(value,0) - low) / Math.max(1, high - low))));
    const ticks = 4;
    const yTicks = Array.from({length: ticks + 1}, (_, i)=>{
      const val = low + ((high - low) * (i / ticks));
      const y = yFn(val);
      return `<g><line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" stroke="rgba(0,0,0,.08)" /><text x="10" y="${y+4}" font-size="12" fill="#6b6257">${Math.round(val)}</text></g>`;
    }).join('');
    const xLabels = Array.from({length:maxPoints}, (_, i)=>{
      const label = options.labelForIndex ? options.labelForIndex(i) : String(i+1);
      return `<text x="${xFn(i)}" y="${H-12}" text-anchor="middle" font-size="12" fill="#6b6257">${esc(label)}</text>`;
    }).join('');
    const body = rows.map((s, idx)=>{
      const color = palette[idx % palette.length];
      const pts = s.points.map((p)=>({ x:p.x, y:n(p.y,0) }));
      const path = smoothPath(pts, xFn, yFn);
      const dots = pts.map((p, pointIdx)=>`<circle cx="${xFn(pointIdx)}" cy="${yFn(p.y)}" r="4" fill="${color}" stroke="#fff" stroke-width="2"></circle>`).join('');
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>${dots}`;
    }).join('');
    return `<div class="lab-chart"><div class="lab-legend">${rows.map((s, idx)=>`<span class="lab-legend-item"><span class="lab-swatch" style="background:${palette[idx % palette.length]}"></span>${esc(s.name || `Serie ${idx+1}`)}</span>`).join('')}</div><div class="lab-chart-shell"><svg viewBox="0 0 ${W} ${H}" class="lab-svg" preserveAspectRatio="none">${yTicks}<line x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}" stroke="#bfb4a0"></line><line x1="${L}" y1="${T}" x2="${L}" y2="${H-B}" stroke="#bfb4a0"></line>${xLabels}${body}</svg></div></div>`;
  }
  function renderBarChart(rows, options={}){
    const list = (Array.isArray(rows) ? rows : []).filter((row)=>row && Number.isFinite(n(options.value ? row[options.value] : row.value, NaN)));
    if (!list.length) return '<div class="lab-empty">Nog geen grafiekdata.</div>';
    const max = Math.max(1, ...list.map((row)=>n(options.value ? row[options.value] : row.value, 0)));
    return `<div class="lab-bars">${list.map((row)=>{
      const value = n(options.value ? row[options.value] : row.value, 0);
      const label = options.label ? row[options.label] : row.label;
      const sub = options.sub ? row[options.sub] : row.sub;
      const pctWidth = Math.max(6, (value / max) * 100);
      const shown = options.formatValue ? options.formatValue(value, row) : compact(value);
      return `<div class="lab-bar-row"><div class="lab-bar-head"><strong>${esc(label || '—')}</strong><span>${esc(shown)}</span></div>${sub ? `<div class="lab-meta">${esc(sub)}</div>` : ''}<div class="lab-track"><div class="lab-fill" style="width:${pctWidth}%"></div></div></div>`;
    }).join('')}</div>`;
  }
  function topPlayersByMetric(rows, metric, limit=8){
    return (Array.isArray(rows) ? rows : []).map((row)=>({
      label: playerName(row),
      value: n(row?.[metric], 0),
      row
    })).filter((row)=>Number.isFinite(row.value)).sort((a,b)=>b.value-a.value).slice(0, limit);
  }
  function sessionToken(){
    try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch (_) { return ''; }
  }
  function styleBlock(){
    return `
      .lab-empty{padding:18px;border:1px dashed rgba(0,0,0,.12);border-radius:18px;color:#6b6257;background:rgba(255,255,255,.55)}
      .lab-stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
      .lab-stat-card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:20px;padding:16px;display:grid;gap:8px}
      .lab-k{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8a7a55;font-weight:900}
      .lab-v{font-size:1.9rem;line-height:1.05;font-weight:900;color:#17130f}
      .lab-sub{font-size:.92rem;color:#6b6257}
      .lab-leaderboard{display:grid;gap:10px}
      .lab-leader-row{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border-radius:18px;background:#fff;border:1px solid rgba(0,0,0,.08)}
      .lab-rank{width:34px;height:34px;border-radius:999px;background:#17130f;color:#fff;display:grid;place-items:center;font-weight:900}
      .lab-main{min-width:0}.lab-name{font-size:1rem;font-weight:900}.lab-meta{font-size:.9rem;color:#6b6257;margin-top:3px}.lab-right{font-weight:900;color:#5e4d1d}
      .lab-chart{display:grid;gap:12px}.lab-legend{display:flex;flex-wrap:wrap;gap:8px}.lab-legend-item{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:#fff;border:1px solid rgba(0,0,0,.08);font-size:12px;font-weight:800}.lab-swatch{width:12px;height:12px;border-radius:999px;display:inline-block}
      .lab-chart-shell{border:1px solid rgba(0,0,0,.08);border-radius:22px;background:rgba(255,255,255,.86);padding:12px}.lab-svg{display:block;width:100%;height:360px}
      .lab-bars{display:grid;gap:12px}.lab-bar-row{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:12px 14px}.lab-bar-head{display:flex;justify-content:space-between;gap:10px;align-items:center}.lab-track{height:12px;border-radius:999px;background:#efe6d6;overflow:hidden;margin-top:10px}.lab-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#9a8241,#e8d6a4)}
      .lab-two{display:grid;grid-template-columns:1.1fr .9fr;gap:14px}.lab-list{display:grid;gap:10px}.lab-list-card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:14px}.lab-list-title{font-weight:900}.lab-chip-row{display:flex;flex-wrap:wrap;gap:8px}.lab-chip{display:inline-flex;padding:7px 10px;border-radius:999px;background:rgba(154,130,65,.12);color:#5e4d1d;font-weight:800;font-size:12px}
      @media(max-width:900px){.lab-two{grid-template-columns:1fr}.lab-svg{height:300px}}
    `;
  }
  window.GEJAST_LADDER_LAB = {
    cfg, scope, headers, parse, rpc, esc, n, pct, pctMaybeWhole, fmt, compact, dateLabel, dateTimeLabel,
    playerName, playerLink, dedupeNames, normalizeLadderPayload, renderStats, renderLeaderboard,
    renderLineChart, renderBarChart, topPlayersByMetric, sessionToken, styleBlock
  };
})();
