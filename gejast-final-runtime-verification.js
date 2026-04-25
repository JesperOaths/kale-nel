(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const ADMIN_KEY = 'jas_admin_session_v8';
  const INSTALL_ORDER = [
    ['v664','GEJAST_v664_drinks_runtime_complete.sql','Use latest drinks runtime SQL. Supersedes v663.'],
    ['v665b','GEJAST_v665b_push_action_runtime_sql_fix.sql','Use this instead of v665/v665a. Fixes parameter-name conflicts.'],
    ['v666b','GEJAST_v666b_pikken_runtime_sql_fix.sql','Use this instead of v666/v666a. Drops overloaded Pikken RPC variants before recreate.'],
    ['v667','GEJAST_v667_paardenrace_runtime_complete.sql','Paardenrace runtime SQL.'],
    ['v668','GEJAST_v668_game_group_a_runtime_complete.sql','Beerpong + Boerenbridge runtime SQL.'],
    ['v669a','GEJAST_v669a_despimarkt_runtime_sql_fix.sql','Use this instead of v669. Fixes expression unique index.'],
    ['v670a','GEJAST_v670a_home_profiles_stats_runtime_sql_fix.sql','Use this instead of v670. Fixes ambiguous pg_proc oid.'],
    ['v671a','GEJAST_v671a_account_identity_mail_runtime_sql_fix.sql','Use this instead of v671. Drops reshaped mail views safely.'],
    ['v672','GEJAST_v672_scope_hardening_runtime_complete.sql','Friend/family scope hardening.'],
    ['v673','GEJAST_v673_klaverjas_runtime_complete.sql','Klaverjassen runtime SQL.'],
    ['v674','GEJAST_v674_final_runtime_verification.sql','Read-only final verification SQL.']
  ];
  const BUNDLES = [
    ['v664','Drinks runtime','create/verify/reject/cancel + speed attempts','contract_drinks_write_v663 or contract_drinks_write_v664'],
    ['v665b','Push action runtime','queue/claim/send/action-token consume','consume_web_push_action_v3'],
    ['v666b','Pikken runtime','lobby/start/round/vote/reveal/winner','get_pikken_runtime_bundle_v666'],
    ['v667','Paardenrace runtime','lobby/wager/race/gates/nominations','get_paardenrace_runtime_bundle_v667'],
    ['v668','Game Group A runtime','Beerpong + Boerenbridge storage/rating/admin','get_game_group_a_runtime_bundle_v668'],
    ['v669a','Despimarkt runtime','wallets/markets/positions/debts/settlement','get_despimarkt_runtime_bundle_v669'],
    ['v670a','Home + profiles runtime','homepage ladders, Grootste Speler, player summaries','get_homepage_runtime_bundle_v670'],
    ['v671a','Account + mail safety','login/request/activate + Make mailguards','admin_get_mail_diagnostics'],
    ['v672','Scope hardening','friend/family scope membership and page policy','get_scope_hardening_bundle_v672'],
    ['v673','Klaverjassen runtime','scorer/live/history/ELO/admin','get_klaverjas_runtime_bundle_v673']
  ];
  function adminToken(){
    try { if (window.GEJAST_ADMIN_SESSION && window.GEJAST_ADMIN_SESSION.getToken) return window.GEJAST_ADMIN_SESSION.getToken() || ''; } catch(_){}
    try { return sessionStorage.getItem(ADMIN_KEY) || localStorage.getItem(ADMIN_KEY) || ''; } catch(_) { return ''; }
  }
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){
    const text = await res.text(); let data = null;
    try { data = text ? JSON.parse(text) : null; } catch(_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data && (data.message || data.error || data.hint) || `HTTP ${res.status}`);
    return data;
  }
  async function rpc(name, payload, timeoutMs){
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(()=>controller.abort(), Math.max(1200, timeoutMs || 6500)) : null;
    try {
      const data = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(payload || {}), signal:controller ? controller.signal : undefined }).then(parse);
      return data && data[name] !== undefined ? data[name] : data;
    } finally { if (timer) clearTimeout(timer); }
  }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, (m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function pill(state, label){
    const s = state === true || state === 'ok' || state === 'present' ? 'ok' : (state === false || state === 'missing' || state === 'bad' ? 'bad' : 'warn');
    return `<span class="pill ${s}">${esc(label || (s === 'ok' ? 'OK' : s === 'bad' ? 'MISSING' : 'CHECK'))}</span>`;
  }
  function table(headers, rows){
    return `<table><thead><tr>${headers.map((h)=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row)=>`<tr>${row.map((cell)=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  function setStatus(msg, tone){ const el = $('statusBox'); if (el) { el.textContent = msg || ''; el.style.color = tone === 'bad' ? '#9d2f22' : tone === 'ok' ? '#1f6f43' : '#6b6257'; } }
  function browserChecks(){
    const checks = [
      ['Config version', cfg.VERSION || window.GEJAST_PAGE_VERSION || '', String(cfg.VERSION || '').includes('674') || String(window.GEJAST_PAGE_VERSION||'').includes('674')],
      ['Service worker API', 'serviceWorker' in navigator ? 'available' : 'missing', 'serviceWorker' in navigator],
      ['Notification API', 'Notification' in window ? Notification.permission : 'missing', 'Notification' in window],
      ['PushManager API', 'PushManager' in window ? 'available' : 'missing', 'PushManager' in window],
      ['Geolocation API', navigator.geolocation ? 'available' : 'missing', !!navigator.geolocation],
      ['Secure context', window.isSecureContext ? 'yes' : 'no', !!window.isSecureContext],
      ['Admin session token', adminToken() ? 'present' : 'missing', !!adminToken()],
      ['Supabase config', cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY ? 'present' : 'missing', !!(cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY)]
    ];
    return checks;
  }
  function renderInstallOrder(){
    $('installOrderBox').innerHTML = table(['Run order','File','Rule'], INSTALL_ORDER.map(([v,file,rule], i)=>[`<strong>${i+1}. ${esc(v)}</strong>`, `<code>${esc(file)}</code>`, esc(rule)]));
  }
  function renderBundles(sqlPayload){
    const fnSet = new Set(((sqlPayload && sqlPayload.functions) || []).filter((r)=>r && r.exists).map((r)=>String(r.name)));
    $('bundleCount').textContent = String(BUNDLES.length);
    $('bundleBox').innerHTML = table(['Version','Runtime bundle','Goal','Proof RPC','Status'], BUNDLES.map(([v,name,goal,fn])=>[
      `<strong>${esc(v)}</strong>`, esc(name), esc(goal), `<code>${esc(fn)}</code>`, pill(fnSet.has(fn) || fnSet.has(fn.replace('v664','v663')), fnSet.has(fn) || fnSet.has(fn.replace('v664','v663')) ? 'RPC present' : 'needs proof')
    ]));
  }
  function renderSql(data){
    const items = [];
    for (const group of ['tables','functions','views']) {
      (data && data[group] || []).forEach((row)=>items.push([group.slice(0,-1), row.name || row.object_name, !!row.exists, row.detail || '']));
    }
    const present = items.filter((r)=>r[2]).length;
    $('sqlScore').textContent = `${present}/${items.length}`;
    $('sqlBox').innerHTML = items.length ? table(['Type','Object','Status','Detail'], items.map(([type,name,ok,detail])=>[esc(type), `<code>${esc(name)}</code>`, pill(ok, ok?'present':'missing'), esc(detail)])) : '<div class="mono">No SQL diagnostics returned.</div>';
    return { present, total: items.length };
  }
  async function publicSmoke(){
    const tests = [
      ['homepage bundle','get_homepage_runtime_bundle_v670',{site_scope_input:'friends'}],
      ['profiles bundle','get_profiles_runtime_bundle_v670',{site_scope_input:'friends'}],
      ['scope bundle','get_scope_hardening_bundle_v672',{site_scope_input:'friends'}],
      ['klaverjas bundle','get_klaverjas_runtime_bundle_v673',{site_scope_input:'friends'}]
    ];
    const out = [];
    for (const [label, name, payload] of tests) {
      try { await rpc(name, payload, 5000); out.push([label, name, 'ok', 'reachable']); }
      catch (err) { out.push([label, name, 'bad', err && err.message || 'failed']); }
    }
    return out;
  }
  async function run(){
    const button = $('runBtn');
    if (button) button.disabled = true;
    try {
      setStatus('Checks lopen…');
      renderInstallOrder();
      let sqlPayload = {};
      try { sqlPayload = await rpc('get_final_runtime_verification_v674', { admin_session_token_input: adminToken() }, 9000); }
      catch (err) { sqlPayload = { error: err.message || String(err), tables:[], functions:[], views:[] }; }
      renderBundles(sqlPayload);
      const sqlScore = renderSql(sqlPayload);
      const browser = browserChecks();
      const smoke = await publicSmoke();
      const browserOk = browser.filter((r)=>r[2]).length;
      $('browserScore').textContent = `${browserOk}/${browser.length}`;
      $('browserBox').innerHTML = browser.map(([label,value,ok])=>`<article class="check-card"><strong>${esc(label)} ${pill(ok, ok?'ok':'check')}</strong><small>${esc(value)}</small></article>`).join('') + smoke.map(([label,fn,state,msg])=>`<article class="check-card"><strong>${esc(label)} ${pill(state==='ok', state==='ok'?'reachable':'failed')}</strong><small><code>${esc(fn)}</code><br>${esc(msg)}</small></article>`).join('');
      const smokeBad = smoke.filter((r)=>r[2] !== 'ok').length;
      const hardMissing = (sqlScore.total ? sqlScore.total - sqlScore.present : 1) + smokeBad;
      $('finalState').textContent = hardMissing ? 'CHECK' : 'READY';
      $('finalCopy').textContent = hardMissing ? `${hardMissing} harde check(s) vragen nog aandacht.` : 'Statische SQL/RPC/browser checks zijn groen. Doe nu handmatige device-flow smoke tests.';
      $('rawBox').textContent = JSON.stringify({ sqlPayload, browser, smoke, installOrder: INSTALL_ORDER, bundles: BUNDLES }, null, 2);
      setStatus(hardMissing ? 'Final checks afgerond met aandachtspunten.' : 'Final checks afgerond zonder harde missers.', hardMissing ? 'bad' : 'ok');
    } finally { if (button) button.disabled = false; }
  }
  document.addEventListener('DOMContentLoaded', ()=>{ renderInstallOrder(); renderBundles({functions:[]}); $('browserBox').innerHTML = browserChecks().map(([label,value,ok])=>`<article class="check-card"><strong>${esc(label)} ${pill(ok, ok?'ok':'check')}</strong><small>${esc(value)}</small></article>`).join(''); $('runBtn') && $('runBtn').addEventListener('click', run); });
})();
