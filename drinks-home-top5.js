
(function(){
  function esc(s){
    return String(s ?? '').replace(/[&<>"]/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];
    });
  }

  function renderDrinkTop5(data){
    const host = document.querySelector('.drinks-home-section, #drinksHomeSection, [data-drinks-home]');
    if(!host) return;

    let anchor =
      host.querySelector('.drinks-home-head') ||
      host.querySelector('h2,h3,.section-title') ||
      host.firstElementChild;

    let block = host.querySelector('#drinksTop5HomeBlock');
    if(!block){
      block = document.createElement('section');
      block.id = 'drinksTop5HomeBlock';
      block.className = 'drinks-top5-home-block';
      if(anchor && anchor.parentNode === host){
        anchor.insertAdjacentElement('afterend', block);
      } else {
        host.prepend(block);
      }
    }

    const sessionRows = data?.session_top5 || [];
    const allTimeRows = data?.all_time_top5 || [];
    const empty = (rows) => !rows || !rows.length;

    block.innerHTML = `
      <div class="drinks-top5-home-header">
        <div>
          <h3>Drinks Top 5</h3>
          <p>Sessie en all-time top 5 op gewogen units.</p>
        </div>
      </div>
      <div class="drinks-top5-home-grid">
        <article class="drinks-top5-card">
          <div class="drinks-top5-card-head">
            <span class="drinks-top5-title">Sessie</span>
            <span class="drinks-top5-mini">Top 5</span>
          </div>
          <div class="drinks-top5-list">
            ${empty(sessionRows) ? '<div class="drinks-top5-empty">Nog geen sessiedata.</div>' :
              sessionRows.map((row, i) => `
                <div class="drinks-top5-row">
                  <span class="drinks-rank">${i+1}</span>
                  <span class="drinks-name">${esc(row.display_name || row.player_name)}</span>
                  <span class="drinks-score">${Number(row.total_units || 0).toFixed(1)}</span>
                </div>
              `).join('')}
          </div>
        </article>
        <article class="drinks-top5-card">
          <div class="drinks-top5-card-head">
            <span class="drinks-top5-title">All-time</span>
            <span class="drinks-top5-mini">Top 5</span>
          </div>
          <div class="drinks-top5-list">
            ${empty(allTimeRows) ? '<div class="drinks-top5-empty">Nog geen all-time data.</div>' :
              allTimeRows.map((row, i) => `
                <div class="drinks-top5-row">
                  <span class="drinks-rank">${i+1}</span>
                  <span class="drinks-name">${esc(row.display_name || row.player_name)}</span>
                  <span class="drinks-score">${Number(row.total_units || 0).toFixed(1)}</span>
                </div>
              `).join('')}
          </div>
        </article>
      </div>
    `;
  }

  async function fetchDrinksTop5(){
    try{
      const data = window.DRINKS_WORKFLOW ? await window.DRINKS_WORKFLOW.loadHomepageHighlights() : null;
      const payload = data && (data.top5 || data.home_top5 || data);
      if (payload) return renderDrinkTop5(payload || {});
      if (!window.supabase || !window.supabaseClient) return;
      const { data: legacy, error } = await window.supabaseClient.rpc('get_drinks_homepage_top5_public');
      if(error) throw error;
      renderDrinkTop5(legacy || {});
    } catch (err){
      console.error('drinks top5 load failed', err);
    }
  }

  function injectStyles(){
    if(document.getElementById('drinksTop5HomeStyle')) return;
    const style = document.createElement('style');
    style.id = 'drinksTop5HomeStyle';
    style.textContent = `
      .drinks-top5-home-block{margin:10px 0 16px 0}
      .drinks-top5-home-header h3{margin:0;font-size:1.6rem;line-height:1.1}
      .drinks-top5-home-header p{margin:4px 0 10px 0;color:var(--muted-text,#6b6256)}
      .drinks-top5-home-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .drinks-top5-card{background:rgba(255,255,255,.72);border:1px solid rgba(17,17,17,.06);border-radius:18px;padding:12px}
      .drinks-top5-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
      .drinks-top5-title{font-weight:900;font-size:1.1rem}
      .drinks-top5-mini{text-transform:uppercase;letter-spacing:.08em;font-size:.8rem;color:#8a7a55;font-weight:800}
      .drinks-top5-list{display:grid;gap:8px}
      .drinks-top5-row{display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:10px;background:rgba(255,255,255,.55);border-radius:14px;padding:8px 10px}
      .drinks-rank{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:999px;background:#111;color:#fff;font-weight:900}
      .drinks-name{font-weight:800}
      .drinks-score{font-weight:900}
      .drinks-top5-empty{padding:10px;border-radius:12px;background:rgba(255,255,255,.55);color:var(--muted-text,#6b6256)}
      @media (max-width: 900px){.drinks-top5-home-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function boot(){
    injectStyles();
    fetchDrinksTop5();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
