(function(){
  const REGISTRY = [
    { key:'starter', name:'Starter', rarity:1, nickname:'Nieuweling', description:'Je hebt je eerste stappen op de site gezet.', image:'./badges/starter.png', test:(s)=>true },
    { key:'debutant', name:'Debutant', rarity:2, nickname:'Debutant', description:'Speel minstens 1 geregistreerde wedstrijd.', image:'./badges/debutant.png', test:(s)=>(s.total_matches||0) >= 1 },
    { key:'stamgast', name:'Stamgast', rarity:3, nickname:'Stamgast', description:'Speel minstens 10 wedstrijden op de site.', image:'./badges/stamgast.png', test:(s)=>(s.total_matches||0) >= 10 },
    { key:'serieuze_speler', name:'Serieuze speler', rarity:4, nickname:'Volhouder', description:'Speel minstens 25 wedstrijden.', image:'./badges/serieuze_speler.png', test:(s)=>(s.total_matches||0) >= 25 },
    { key:'klaverkoning', name:'Klaverkoning', rarity:5, nickname:'Klaverkoning', description:'Speel minstens 15 potjes klaverjas.', image:'./badges/klaverkoning.png', test:(s)=>(s.klaverjas_matches||0) >= 15 },
    { key:'bridgebrein', name:'Bridgebrein', rarity:5, nickname:'Bridgebrein', description:'Speel minstens 15 potjes Boerenbridge.', image:'./badges/bridgebrein.png', test:(s)=>(s.boerenbridge_matches||0) >= 15 },
    { key:'pongbeul', name:'Pongbeul', rarity:5, nickname:'Pongbeul', description:'Speel minstens 10 potjes Beerpong.', image:'./badges/pongbeul.png', test:(s)=>(s.beerpong_matches||0) >= 10 },
    { key:'winnaar', name:'Winnaar', rarity:6, nickname:'Winnaar', description:'Win minstens 10 wedstrijden.', image:'./badges/winnaar.png', test:(s)=>(s.total_wins||0) >= 10 },
    { key:'gouden_hand', name:'Gouden hand', rarity:7, nickname:'Gouden hand', description:'Bereik een beste ELO van minstens 1200.', image:'./badges/gouden_hand.png', test:(s)=>(s.best_rating||0) >= 1200 },
    { key:'nachtburgemeester', name:'Nachtburgemeester', rarity:7, nickname:'Nachtburgemeester', description:'Drink minstens 25 units in totaal.', image:'./badges/nachtburgemeester.png', test:(s)=>(s.drink_units||0) >= 25 },
    { key:'snelheidsduivel', name:'Snelheidsduivel', rarity:8, nickname:'Snelheidsduivel', description:'Zet een bevestigd snelheidsrecord neer.', image:'./badges/snelheidsduivel.png', test:(s)=>Number(s.speed_best_seconds||0) > 0 },
    { key:'living_legend', name:'Living Legend', rarity:10, nickname:'Living Legend', description:'Speel minstens 50 wedstrijden op de site.', image:'./badges/living_legend.png', test:(s)=>(s.total_matches||0) >= 50 },
    { key:'pussykoning', name:'Pussykoning', rarity:9, nickname:'Pussykoning', description:'Haal een pussycup-percentage van minstens 50% in Beerpong.', image:'./badges/pussykoning.png', test:(s)=>(s.pussycup_pct||0) >= 50 && (s.beerpong_matches||0) >= 4 }
  ];

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function normalizeStats(input){
    const s = input || {};
    const total_matches = Number(s.total_matches ?? s.games_played ?? s.matches_played ?? 0) || 0;
    const total_wins = Number(s.total_wins ?? s.wins ?? 0) || 0;
    const best_rating = Number(s.best_rating ?? s.elo_rating ?? 0) || 0;
    return {
      total_matches,
      total_wins,
      best_rating,
      klaverjas_matches: Number(s.klaverjas_matches||0) || 0,
      boerenbridge_matches: Number(s.boerenbridge_matches||0) || 0,
      beerpong_matches: Number(s.beerpong_matches||0) || 0,
      drink_units: Number(s.drink_units||0) || 0,
      speed_best_seconds: Number(s.speed_best_seconds||0) || 0,
      pussycup_pct: Number(s.pussycup_pct||0) || 0
    };
  }
  function getRegistry(){ return REGISTRY.slice().sort((a,b)=>a.rarity-b.rarity); }
  function getAttained(stats){ const s=normalizeStats(stats); return getRegistry().filter((b)=>{ try{return !!b.test(s);}catch(_){return false;} }); }
  function getRarest(attained){ const rows=(attained||[]).slice().sort((a,b)=>b.rarity-a.rarity); return rows[0] || REGISTRY[0]; }
  function badgeImageHtml(badge, small=false){ const size = small ? 34 : 52; return `<img src="${esc(badge.image)}" alt="${esc(badge.name)}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;object-fit:contain;border-radius:14px;background:#fffaf1;border:1px solid rgba(17,17,17,.08);padding:${small?4:6}px" onerror="this.style.display='none'">`; }
  function renderMiniBadges(attained){ const rows=(attained||[]); if(!rows.length) return '<span class="badge soft">Starter</span>'; return rows.slice().sort((a,b)=>b.rarity-a.rarity).slice(0,5).map((badge)=>`<span class="badge soft" title="${esc(badge.description)}">${badgeImageHtml(badge,true)}<span>${esc(badge.name)}</span></span>`).join(''); }
  function renderGallery(attainedKeys){ const have=new Set((attainedKeys||[]).map((k)=>String(k))); return `<div class="badge-gallery">${getRegistry().map((badge)=>`<div class="badge-card ${have.has(badge.key)?'earned':''}">${badgeImageHtml(badge,false)}<strong>${esc(badge.name)}</strong><span>${esc(badge.description)}</span>${badge.nickname?`<em>Bijnaam: ${esc(badge.nickname)}</em>`:''}</div>`).join('')}</div>`; }
  function injectStyles(){
    if(document.getElementById('gejast-badge-styles')) return;
    const css = `.badge-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.badge-card{display:grid;gap:8px;padding:14px;border-radius:18px;background:#fff;border:1px solid rgba(17,17,17,.08)}.badge-card.earned{background:linear-gradient(180deg,#fff9ec,#f6edd1);border-color:rgba(154,130,65,.35)}.badge-card strong{font-size:14px}.badge-card span,.badge-card em{font-size:12px;color:#6b6257;font-style:normal}.badge-mini-row{display:flex;flex-wrap:wrap;gap:8px}.badge.soft{display:inline-flex;align-items:center;gap:6px;padding:6px 8px}`;
    const style=document.createElement('style'); style.id='gejast-badge-styles'; style.textContent=css; document.head.appendChild(style);
  }
  window.GEJAST_BADGES = { getRegistry, getAttained, getRarest, renderGallery, renderMiniBadges, normalizeStats, injectStyles };
})();
