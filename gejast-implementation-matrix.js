(function(){
  const STATUS_LABELS={
    implemented:'Implemented in v655 patch',
    partial:'Partially implemented',
    present_unlinked:'Present but unlinked / not proven end-to-end',
    missing:'Missing / not built in this patch',
    unsafe:'Unsafe to apply before verification'
  };
  const ITEMS=[
    {phase:'0',status:'implemented',title:'Version alignment and shared watermark source',owner:'VERSION + gejast-config.js + page cache-bust refs',evidence:'v655 patch aligns VERSION, GEJAST_CONFIG.VERSION, GEJAST_PAGE_VERSION declarations, script ?v cache-busters, and visible Made by Bruis watermark labels.',next:'After GitHub upload/deploy, open admin_system_health.html and run browser version report.'},
    {phase:'0',status:'implemented',title:'Admin navigation to repair-first diagnostics',owner:'admin.html',evidence:'Admin hub links to Implementation Matrix, System Health, Identity Health, Shared Stats Health, and Ops Observability.',next:'After deploy, confirm the admin hub shown live is the uploaded Beheerhub version rather than older Adminhub output.'},
    {phase:'0',status:'partial',title:'Public-page performance and boot guard verification',owner:'gejast-perf-guards.js + admin_system_health.html',evidence:'Diagnostic helpers are present and linked. Actual browser runtime timing, network waterfall, and mobile behavior are not proven by static files alone.',next:'Run deployed browser checks on index/home/login/drinks/pikken/paardenrace/admin pages.'},
    {phase:'0',status:'partial',title:'Stale diagnostic runtime cleanup',owner:'diagnostic admin pages + helper scripts',evidence:'Known diagnostic pages and helpers have been bumped to v655 in the patch. Runtime correctness still depends on deploy cache and RPC availability.',next:'Verify no stale v638/v639/v651 assets load in DevTools after deploy.'},
    {phase:'0',status:'unsafe',title:'GitHub-vs-deployed mismatch closure',owner:'deployment process, CDN/cache, GitHub main',evidence:'The patch provides files to close the mismatch, but static patch creation cannot prove GitHub main or kalenel.nl have been updated.',next:'After upload/commit/deploy, compare GitHub main, page source, and browser-loaded script URLs.'},

    {phase:'2',status:'partial',title:'Cross-game stats and shared public stat surfaces',owner:'index.html, profiles.html, ladder.html, shared stats helpers',evidence:'Shared/profile/ladder surfaces exist, but cross-game stats are not proven end-to-end against live RPCs or SQL cache content.',next:'Trace which pages consume shared stats and verify RPC outputs per scope.'},
    {phase:'3',status:'implemented',title:'Implementation matrix / owner audit surface',owner:'admin_implementation_matrix.html + gejast-implementation-matrix.js',evidence:'This matrix is implemented as a deployable admin page and contains feature-by-feature status categories.',next:'Use this page as the checklist before each later phase patch.'},
    {phase:'4',status:'partial',title:'System health: versioning, gates, boot, performance',owner:'admin_system_health.html + gejast-version-source.js + gate/perf helpers',evidence:'Diagnostic page and browser helpers are present. SQL audit buttons depend on backend RPCs and an admin session, so static verification is incomplete.',next:'Run browser checks and SQL audit buttons after deploy/admin login.'},
    {phase:'5',status:'partial',title:'Identity, login dropdowns, profiles, avatars, badges',owner:'admin_identity_health.html + gejast-player-selector.js + gejast-profiles-restore.js + profile pages',evidence:'Identity diagnostic helpers and profile pages are present. Actual dropdown speed, avatar restore, badge restore, and RPC payload correctness need live verification.',next:'Audit login.html, request.html, profiles.html, player.html, my_profile.html with real sessions.'},
    {phase:'6',status:'partial',title:'Drinks surfaces: add, pending, speed, stats, admin',owner:'drinks*.html + drinks_admin.html + drinks RPCs',evidence:'All main drinks pages are present in the patch. Crowd verification, speed attempts, unit totals, notification floats, and 06:00 day boundary are not proven here.',next:'Run a drinks-specific RPC/page flow test before changing behavior.'},
    {phase:'7',status:'partial',title:'Shared stats framework/cache/RPC substrate',owner:'admin_shared_stats.html + gejast-shared-stats*.js',evidence:'Shared Stats Health page and helpers are present. SQL cache substrate and row freshness are not verified by the static patch.',next:'Run shared stats admin audit after SQL/runtime access.'},
    {phase:'8',status:'partial',title:'Klaverjassen shared stats and live/stat cleanup',owner:'score.html, scorer.html, klaverjas_live.html, vault.html, leaderboard.html, ladder.html',evidence:'Core klaverjas pages are present, including scorer/live/vault/leaderboard files. Advanced shared stats and current live behavior are not proven.',next:'Trace scorer -> RPC -> match history -> ELO/stats before editing.'},
    {phase:'9',status:'partial',title:'Pikken lobby/live/stats implementation',owner:'pikken.html, pikken_live.html, pikken_spectator.html, pikken_ladder.html, pikken_stats.html, admin_pikken.html',evidence:'Pikken page set is present. Lobby, ready, hand visibility, dice state, reconnect, and RPC contract are not verified in runtime.',next:'Verify pikken_create_lobby_scoped / join / get_state / hand RPC chain with real session tokens.'},
    {phase:'10',status:'partial',title:'Beerpong full implementation pack',owner:'beerpong.html, beerpong_vault.html, ladder.html?game=beerpong',evidence:'Beerpong surfaces are present. Full implementation status, admin editing, ELO rebuild, and live/stat integration are not proven.',next:'Do a Beerpong-specific repo/RPC trace before adding feature work.'},
    {phase:'11',status:'partial',title:'Boerenbridge full implementation pack',owner:'boerenbridge.html, boerenbridge_live.html, boerenbridge_spectator.html, boerenbridge_vault.html',evidence:'Boerenbridge surfaces are present. Match-history draft upsert workflow, live recap, admin correction, and ELO behavior need verification.',next:'Trace live write/read RPCs and match finalization before patching.'},
    {phase:'12',status:'present_unlinked',title:'Klaverjassen cleanup / shared stats continuation',owner:'klaverjas quick stats/scorer legacy files + shared stats framework',evidence:'Legacy/reference files are present, but no clean proof that Phase 12 cleanup is fully linked into current public pages.',next:'Compare current scorer/live/leaderboard pages against legacy quick-stat files and shared stats owner map.'},
    {phase:'13',status:'present_unlinked',title:'Auto Beurs / Despimarkt match markets',owner:'despimarkt*.html + admin_despimarkt.html + beurs.html',evidence:'Despimarkt and Beurs pages are present, but market SQL/RPC contracts and automatic match-market creation are not verified.',next:'Keep as separate subsystem patch; do not mix into base repair or drinks/game patches.'},
    {phase:'14',status:'partial',title:'Ops observability, release readiness, rollback, smoke checks',owner:'admin_ops_observability.html + gejast-ops-observability.js',evidence:'Ops diagnostic surface is present. Real smoke checks, runtime error collection, and rollback readiness need deployed runtime data.',next:'After deploy, capture smoke output and update handoff with actual results.'}
  ];
  function tone(status){return status==='implemented'?'ok':status==='missing'||status==='unsafe'?'bad':'warn';}
  function matchesStatus(item,filter){
    if(filter==='all') return true;
    if(filter==='implemented') return item.status==='implemented';
    if(filter==='partial') return item.status==='partial' || item.status==='present_unlinked';
    if(filter==='missing') return item.status==='missing' || item.status==='unsafe';
    return item.status===filter;
  }
  function card(i){return `<article class="im-card"><div class="im-key">Phase ${i.phase}</div><h3>${i.title}</h3><div class="im-badges"><span class="im-badge ${tone(i.status)}">${STATUS_LABELS[i.status]||i.status}</span><span class="im-badge">${i.owner}</span></div><p><b>Evidence:</b> ${i.evidence}</p><p class="im-next"><b>Next:</b> ${i.next}</p></article>`;}
  function boot(){
    const root=document.getElementById('matrixRoot'); const summary=document.getElementById('matrixSummary'); const search=document.getElementById('matrixSearch'); const statusFilter=document.getElementById('statusFilter'); const phaseFilter=document.getElementById('phaseFilter'); const reload=document.getElementById('reloadMatrixBtn');
    function render(){
      const q=(search&&search.value||'').toLowerCase(); const sf=statusFilter&&statusFilter.value||'all'; const pf=phaseFilter&&phaseFilter.value||'all';
      const rows=ITEMS.filter(i=>matchesStatus(i,sf) && (pf==='all'||i.phase===pf) && JSON.stringify(i).toLowerCase().includes(q));
      if(root) root.innerHTML='<section class="im-grid">'+rows.map(card).join('')+'</section>';
      if(summary) summary.innerHTML=['implemented','partial','present_unlinked','missing','unsafe'].map(st=>`<div class="im-stat"><span>${STATUS_LABELS[st]||st}</span><strong>${ITEMS.filter(i=>i.status===st).length}</strong></div>`).join('');
      const status=document.getElementById('matrixStatus'); if(status) status.textContent=`${rows.length} items zichtbaar van ${ITEMS.length}. Static status: patch evidence only; live GitHub/deploy/RPC checks remain separate proof.`;
    }
    [search,statusFilter,phaseFilter].forEach(el=>el&&el.addEventListener('input',render)); [statusFilter,phaseFilter].forEach(el=>el&&el.addEventListener('change',render)); reload&&reload.addEventListener('click',render); render();
  }
  window.GEJAST_IMPLEMENTATION_MATRIX={ITEMS,STATUS_LABELS,boot};
})();
