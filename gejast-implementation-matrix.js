(function(){
  const ITEMS=[
    {phase:'0',status:'repair-first',title:'Version/config/admin-link/performance drift',owner:'gejast-config.js, VERSION, admin diagnostic pages',next:'Base repair must be verified before feature expansion.'},
    {phase:'3',status:'present',title:'Implementation matrix / owner audit',owner:'admin_implementation_matrix.html + gejast-implementation-matrix.js',next:'Use as checklist for phase review.'},
    {phase:'4',status:'present',title:'System health / versioning / gates / boot perf',owner:'admin_system_health.html + helpers',next:'Run browser checks after deploy.'},
    {phase:'5',status:'partial',title:'Identity / dropdowns / profiles / avatars / badges',owner:'gejast-player-selector.js, gejast-profiles-restore.js',next:'Verify RPCs and actual profile pages.'},
    {phase:'6',status:'partial',title:'Drinks surfaces',owner:'drinks*.html + drinks RPCs',next:'Separate crowd verify, speed attempts and unit stats audit.'},
    {phase:'7',status:'partial',title:'Shared stats framework',owner:'admin_shared_stats.html + shared stats helpers',next:'Verify SQL cache substrate.'},
    {phase:'8',status:'planned',title:'Klaverjassen shared stats',owner:'score/scorer/live/ladder pages',next:'Audit before advanced metrics.'},
    {phase:'9',status:'partial',title:'Pikken',owner:'pikken.html, pikken_live.html, pikken RPCs',next:'Check lobby/live/hand functions.'},
    {phase:'10',status:'planned',title:'Beerpong full implementation',owner:'beerpong pages/RPCs',next:'Build only after base repair.'},
    {phase:'11',status:'planned',title:'Boerenbridge full implementation',owner:'boerenbridge pages/RPCs',next:'Build after Beerpong or in scoped package.'},
    {phase:'13',status:'planned',title:'Auto Beurs / Despimarkt markets',owner:'despimarkt pages + market SQL',next:'Keep as later subsystem, not mixed into repair.'}
  ];
  function card(i){return `<article class="panel"><h2>Phase ${i.phase}: ${i.title}</h2><div class="row"><span class="pill ${i.status==='present'?'ok':i.status==='repair-first'?'bad':'warn'}">${i.status}</span><span class="pill">${i.owner}</span></div><p class="sub"><b>Next:</b> ${i.next}</p></article>`;}
  function boot(){const root=document.getElementById('matrixRoot');const summary=document.getElementById('matrixSummary');const search=document.getElementById('matrixSearch');const filt=document.getElementById('statusFilter');function render(){const q=(search?.value||'').toLowerCase();const f=filt?.value||'all';const rows=ITEMS.filter(i=>(f==='all'||i.status===f)&&JSON.stringify(i).toLowerCase().includes(q));root.innerHTML='<section class="grid">'+rows.map(card).join('')+'</section>';summary.innerHTML=['repair-first','present','partial','planned'].map(st=>`<div class="panel"><h2>${st}</h2><pre>${ITEMS.filter(i=>i.status===st).length}</pre></div>`).join('');document.getElementById('matrixStatus').textContent=`${rows.length} items zichtbaar van ${ITEMS.length}.`;}
    search?.addEventListener('input',render);filt?.addEventListener('change',render);render();}
  window.GEJAST_IMPLEMENTATION_MATRIX={ITEMS,boot};
})();
