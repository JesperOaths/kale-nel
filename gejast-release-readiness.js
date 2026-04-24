(function(){
const cfg=window.GEJAST_CONFIG||{};const VERSION='v649';
function q(id){return document.getElementById(id)}
function token(){try{return(window.GEJAST_ADMIN_SESSION&&window.GEJAST_ADMIN_SESSION.getToken&&window.GEJAST_ADMIN_SESSION.getToken())||localStorage.getItem('jas_admin_session_v8')||sessionStorage.getItem('jas_admin_session_v8')||''}catch(_){return''}}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function row(n,s,d){const cls=s==='ok'?'ok':s==='bad'?'bad':'warn';return `<tr><td>${esc(n)}</td><td><span class="pill ${cls}">${esc(s)}</span></td><td>${esc(d||'')}</td></tr>`}
function localChecks(){const scripts=Array.from(document.scripts||[]).map(s=>s.src||'');const old=scripts.filter(src=>/\?v(63[0-8]|64[0-8])\b/.test(src));return[
{name:'Version label',status:(window.GEJAST_PAGE_VERSION===VERSION||cfg.VERSION===VERSION)?'ok':'warn',detail:`page=${window.GEJAST_PAGE_VERSION||''}; config=${cfg.VERSION||''}`},
{name:'Old runtime refs',status:old.length?'bad':'ok',detail:old.length?old.join(', '):'Geen oude scriptrefs op deze pagina'},
{name:'Make webhook browser owner',status:cfg.MAKE_WEBHOOK_URL?'bad':'ok',detail:cfg.MAKE_WEBHOOK_URL?'Browser bevat nog directe Make URL':'Browser Make URL is leeg'},
{name:'Admin token present',status:token()?'ok':'warn',detail:token()?'Admin token gevonden':'Geen admin token; alleen lokale checks'}]}
async function run(){q('statusBox').textContent='Controle loopt...';const rows=localChecks();const ok=rows.filter(r=>r.status==='ok').length;q('phaseKpi').textContent='local';q('runtimeKpi').textContent=String(ok);q('uploadKpi').textContent='5';q('rows').innerHTML=rows.map(r=>row(r.name,r.status,r.detail)).join('');q('statusBox').textContent='Controle afgerond. Guarded RPC checks worden actief zodra SQL v649 is toegepast en een adminsessie aanwezig is.'}
document.addEventListener('DOMContentLoaded',()=>{const b=q('refreshBtn');if(b)b.addEventListener('click',run);run()})
})();