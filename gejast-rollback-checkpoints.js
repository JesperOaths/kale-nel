(function(){
  const KEY='gejast_rollback_checkpoints_v650';
  function read(){ try { return JSON.parse(localStorage.getItem(KEY)||'[]'); } catch(_) { return []; } }
  function write(rows){ try { localStorage.setItem(KEY, JSON.stringify((rows||[]).slice(-25))); } catch(_) {} }
  function add(label, meta){ const rows=read(); rows.push({ label:String(label||'checkpoint'), meta:meta||{}, at:new Date().toISOString(), version:window.GEJAST_PAGE_VERSION||'' }); write(rows); return rows; }
  function clear(){ try { localStorage.removeItem(KEY); } catch(_) {} }
  window.GEJAST_ROLLBACK_CHECKPOINTS = { read, add, clear };
})();
