(function(){
  const path = (location.pathname || '').toLowerCase().split('/').pop();
  if (!['paardenrace.html','paardenrace_live.html','paardenrace_stats.html'].includes(path)) return;
  window.GEJAST_HIDE_WATERMARK = true;

  function qs(sel, root){ return (root || document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

  function injectCss(){
    const style = document.createElement('style');
    style.textContent = `
      .site-credit-watermark,[data-version-watermark]{display:none !important}
      @media (max-width:820px){
        body{padding-bottom:110px}
        .top-left .small:first-child,
        .top-left .title,
        .top-left #metaBox,
        .top > div:first-child .small,
        .top > div:first-child .title{display:none !important}
        .hero-meta{display:none !important}
        .status-row .small{display:none !important}
        .focus-card{gap:10px !important}
        .focus-head{align-items:flex-start !important}
        .shell{padding-top:10px !important}
      }
      .pr-last-card-box{display:grid;gap:6px;padding:12px 14px;border-radius:16px;background:#fff;border:1px solid rgba(0,0,0,.08)}
      .pr-last-card-k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8a7a55;font-weight:900}
      .pr-last-card-v{font-size:18px;font-weight:900}
      .pr-last-card-sub{font-size:13px;color:#6d6256;line-height:1.4}
    `;
    document.head.appendChild(style);
  }

  function bootStatsPage(){
    if (path !== 'paardenrace_stats.html') return;
    const style = document.createElement('style');
    style.textContent = '@media (max-width:760px){.subtitle,.eyebrow{display:none !important}}';
    document.head.appendChild(style);
  }

  function ensureLatestCardBox(){
    if (path !== 'paardenrace_live.html') return null;
    const focus = qs('.focus-card');
    if (!focus) return null;
    let box = qs('#prLastCardBox');
    if (!box){
      box = document.createElement('div');
      box.id = 'prLastCardBox';
      box.className = 'pr-last-card-box';
      box.innerHTML = '<div class="pr-last-card-k">Laatste kaart</div><div id="prLastCardValue" class="pr-last-card-v">—</div><div id="prLastCardSub" class="pr-last-card-sub">Wachten op de eerste trek.</div>';
      const autoStatus = qs('#autoStatus');
      if (autoStatus && autoStatus.parentNode) autoStatus.parentNode.insertBefore(box, autoStatus.nextSibling);
      else focus.appendChild(box);
    }
    return box;
  }

  function roomCode(){
    try{
      const params = new URLSearchParams(location.search);
      return params.get('room') || params.get('live') || (window.GEJAST_PAARDENRACE && window.GEJAST_PAARDENRACE.getStoredRoomCode && window.GEJAST_PAARDENRACE.getStoredRoomCode()) || '';
    }catch(_){ return ''; }
  }

  function parseCard(cardCode){
    const raw = String(cardCode || '').trim().toUpperCase();
    const match = raw.match(/^(10|[2-9JQKA])([HDCS])$/);
    if (!match) return null;
    const suitKey = ({ H:'hearts', D:'diamonds', C:'clubs', S:'spades' })[match[2]] || '';
    return { rank: match[1], suitKey, raw };
  }

  async function loadLiveState(){
    if (path !== 'paardenrace_live.html') return null;
    const api = window.GEJAST_PAARDENRACE;
    if (!api || !api.rpc) return null;
    const code = roomCode();
    if (!code) return null;
    try{
      return await api.rpc('tick_paardenrace_room_safe', { room_code_input: code });
    }catch(_){
      return null;
    }
  }

  function updateLatestCardUi(state){
    const api = window.GEJAST_PAARDENRACE;
    const box = ensureLatestCardBox();
    if (!box || !api) return;
    const value = qs('#prLastCardValue');
    const sub = qs('#prLastCardSub');
    const card = String(state?.match?.last_draw_card || '').trim().toUpperCase();
    if (!card){
      if (value) value.textContent = '—';
      if (sub) sub.textContent = 'Wachten op de eerste trek.';
      return;
    }
    const parsed = parseCard(card);
    const plusText = parsed ? `+1 voor ${api.suitLabel(parsed.suitKey)}` : 'Voorwaartse stap';
    const pushbackSuit = state?.match?.last_pushback_suit || state?.match?.pushback_suit || '';
    const pushbackText = pushbackSuit ? ` · gate: -1 voor ${api.suitLabel(pushbackSuit)}` : '';
    if (value) value.textContent = card;
    if (sub) sub.textContent = `${plusText}${pushbackText}`;
  }

  function lobbyChrome(){
    if (path !== 'paardenrace.html') return;
    const summary = qs('#roomHeadline');
    if (summary && /Nog geen actieve room/i.test(summary.textContent || '')) summary.textContent = 'Maak of join direct een room en spring daarna naar live.';
  }

  async function bootLive(){
    if (path !== 'paardenrace_live.html') return;
    ensureLatestCardBox();
    const update = async ()=>{
      const state = await loadLiveState();
      if (state) updateLatestCardUi(state);
    };
    update();
    setInterval(update, 1500);
  }

  function boot(){
    injectCss();
    bootStatsPage();
    lobbyChrome();
    bootLive();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();