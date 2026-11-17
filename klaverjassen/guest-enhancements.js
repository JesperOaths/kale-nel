/* Standalone Klaverjassen optional enhancements. */
(function(global){'use strict';
const K=global.KALENEL_KJ_GUEST;if(!K)return;
const PREF_KEY='kalenel_kj_guest_preferences_v1';
const PUSH_URL='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/kalenel-kj-turn-push/public-key';
const defaults={speed:1,reduced:false,colorblind:false,subscriptions:{}};
let pref;try{pref={...defaults,...JSON.parse(localStorage.getItem(PREF_KEY)||'{}')};}catch(_){pref={...defaults};}
if(![.75,1,1.25,1.5,2].includes(Number(pref.speed)))pref.speed=1;
if(!pref.subscriptions||typeof pref.subscriptions!=='object')pref.subscriptions={};
const session={room:null,share:null,lastTurn:null,stats:null,loading:false,statsError:'',status:''};
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

function reduceMotion(){return !!pref.reduced||!!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;}

function duration(ms){return reduceMotion()?Math.min(110,ms):Math.round(ms/(Number(pref.speed)||1));}

function applyPreferences(){
  document.documentElement.classList.toggle('kj-colorblind',!!pref.colorblind);
  document.documentElement.classList.toggle('kj-reduced-motion',reduceMotion());
  document.documentElement.style.setProperty('--kj-flight-duration',duration(850)+'ms');
}

function savePreferences(){localStorage.setItem(PREF_KEY,JSON.stringify(pref));applyPreferences();}

function calculate(games){
 const a={games:0,wins:0,draws:0,rounds:0,bids:0,made:0,nat:0,roem:0,teamPoints:0,opponentPoints:0};
 for(const g of games||[]){
   const team=Number(g.team),seat=Number(g.seat),scores=g.totals||[0,0];
   if(g.finished){a.games++;const own=Number(scores[team-1]||0),other=Number(scores[2-team]||0);if(own>other)a.wins++;else if(own===other)a.draws++;}
   for(const r of g.rounds||[]){
     a.rounds++;const points=r.scores||[0,0];a.teamPoints+=Number(points[team-1]||0);a.opponentPoints+=Number(points[2-team]||0);
     if(Number(r.bid_player)===seat){a.bids++;if(r.made)a.made++;if(r.nat)a.nat++;}
     for(const k of r.klops||[]){if(Number(k.seat)===seat)a.roem+=Number(k.points||0);}
   }
 }
 return a;
}

function renderStats(){
 const pane=document.getElementById('statsPanel');if(!pane)return;
 let body='';
 if(session.loading)body='<p class="muted">Statistieken laden...</p>';
 else if(session.statsError)body='<p class="muted">'+esc(session.statsError)+'</p>';
 else if(!session.stats)body='<p class="muted">Klik op Vernieuwen om je statistieken uit je gastentafels op te halen.</p>';
 else{
  const a=calculate(session.stats.games||[]);
  const pct=(n,d)=>d?Math.round(n/d*100)+'%':'–';
  const cells=[['Afgeronde potjes',a.games],['Winstpercentage',pct(a.wins,a.games)],['Gewonnen',a.wins],['Gelijkspel',a.draws],
   ['Geboden',a.bids],['Bod gehaald',pct(a.made,a.bids)],['NAT',a.nat],['Roem geklopt',a.roem],
   ['Rondes',a.rounds],['Team-punten',a.teamPoints],['Tegenpartij',a.opponentPoints]];
  body='<div class="kj-stats-grid">'+cells.map(([k,v])=>`<div class="kj-stats-cell"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')+'</div><p class="muted">Open potjes tellen niet mee voor het winstpercentage. Statistieken zijn gekoppeld aan dit privésleutelprofiel.</p>';
 }
 pane.innerHTML=`<h2>Mijn statistieken</h2>${body}<button id="kjRefreshStats" class="btn secondary" type="button" ${session.loading?'disabled':''}>Vernieuwen</button>`;
 pane.querySelector('#kjRefreshStats').onclick=refreshStats;
}

async function refreshStats(){
 if(session.loading||!session.room)return;
 session.loading=true;session.statsError='';renderStats();
 try{session.stats=await K.getPlayerStats(session.room);}catch(err){session.statsError=err?.message||'Statistieken konden niet worden geladen.';}
 finally{session.loading=false;renderStats();}
}

function currentStatus(msg){
 session.status=msg;
 const el=document.getElementById('kjExtraStatus');if(el)el.textContent=msg;
}

function renderInfo(remote){
 const panel=document.getElementById('memoryPanel');if(!panel||!remote?.game?.lobby_code)return;
 const room=remote.game.lobby_code,me=Number(remote.viewer?.seat),host=!!remote.viewer?.is_host;
 const active=['lobby','playing'].includes(remote.game.status);
 const humans=(remote.game.state?.players||[]).filter(p=>!p.is_bot&&p.seat!==me);
 const share=session.share;
 panel.insertAdjacentHTML('beforeend',`
  <section class="kj-extra-section">
   <h3>Veilig naar een ander apparaat</h3>
   <p class="muted">Deel een eenmalige link (10 minuten). Als je deze op je andere apparaat gebruikt, wordt je oude toegang onmiddellijk ingetrokken.</p>
   <button class="btn secondary" id="kjTransfer" type="button" ${active?'':'disabled'}>Maak overdrachtslink</button>
   ${share?`<div class="kj-share"><input aria-label="Persoonlijke overdrachtslink" id="kjTransferUrl" value="${esc(share.url)}" readonly/><button class="btn secondary" id="kjCopyTransfer" type="button">Kopieer</button><small>Geldig tot ${esc(new Date(share.expiresAt).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'}))}</small></div>`:''}
   ${host?`<div class="kj-handover"><h3>Host overdragen</h3><p class="muted">De nieuwe host mag de tafel beheren. Bots komen niet in aanmerking.</p>
    ${humans.length?`<select id="kjHandoverSeat" aria-label="Nieuwe host">${humans.map(p=>`<option value="${p.seat}">${esc(p.name)} · stoel ${Number(p.seat)+1}</option>`).join('')}</select><button class="btn secondary" id="kjHandover" ${active?'':'disabled'} type="button">Draag host over</button>`:'<span class="muted">Nog geen andere menselijke speler.</span>'}
   </div>`:''}
  </section>
  <section class="kj-extra-section"><h3>Beurtmeldingen</h3>
   <p class="muted">Ontvang een melding wanneer je moet bieden of spelen. Zolang achtergrondpush niet beschikbaar is, moet de game-tab open blijven (mag op de achtergrond staan).</p>
   <button class="btn secondary" id="kjNotify" type="button">${pref.subscriptions?.[room]?'Meldingen uitschakelen':'Meldingen inschakelen'}</button>
   <small>${pref.subscriptions?.[room]==='local'?'Actief: browsermeldingen zolang de tab open is.':'Notification'in window?'Toestemming: '+Notification.permission:'Browsermeldingen niet beschikbaar'}</small>
  </section>
  <section class="kj-extra-section"><h3>Animatie & toegankelijkheid</h3>
   <label for="kjAnimSpeed">Snelheid</label>
   <select id="kjAnimSpeed">${[.75,1,1.25,1.5,2].map(x=>`<option value="${x}" ${Number(pref.speed)===x?'selected':''}>${x}×</option>`).join('')}</select>
   <label class="kj-opt"><input type="checkbox" id="kjReduceMotion" ${pref.reduced?'checked':''}/> Minder beweging</label>
   <label class="kj-opt"><input type="checkbox" id="kjColorblind" ${pref.colorblind?'checked':''}/> Extra patronen en stoelmarkeringen</label>
  </section>
  <p id="kjExtraStatus" class="kj-extra-status" role="status">${esc(session.status||'')}</p>`);
 panel.querySelector('#kjTransfer').onclick=async()=>{
  currentStatus('Eenmalige link maken...');
  try{session.share=await K.transferStart(room);currentStatus('Link gemaakt. Deel hem alleen met je andere apparaat.');}
  catch(e){currentStatus(e?.message||'Overdracht mislukt');}
  rerenderInfo(remote);
 };
 panel.querySelector('#kjCopyTransfer')?.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(session.share.url);currentStatus('Link gekopieerd.');}
  catch(_){window.prompt('Kopieer de privélink:',session.share.url);}
 });
 panel.querySelector('#kjHandover')?.addEventListener('click',async()=>{
  const seat=Number(document.getElementById('kjHandoverSeat')?.value);
  const target=humans.find(p=>p.seat===seat);
  if(!target||!window.confirm('Host overdragen aan '+target.name+'? Dit trekt jouw hostrechten in.'))return;
  try{await K.handover(room,seat);window.location.reload();}
  catch(e){currentStatus(e?.message||'Hostoverdracht mislukt');}
 });
 panel.querySelector('#kjNotify').onclick=async()=>{
  currentStatus('Browsermeldingen instellen...');
  try{
   if(pref.subscriptions?.[room])await disablePush(room);else await enablePush(room);
   currentStatus(pref.subscriptions?.[room]?'Meldingen ingeschakeld.':'Meldingen uitgeschakeld.');
  }catch(e){currentStatus(e?.message||'Meldingen niet beschikbaar.');}
  rerenderInfo(remote);
 };
 panel.querySelector('#kjAnimSpeed').onchange=e=>{pref.speed=Number(e.target.value);savePreferences();currentStatus('Snelheid ingesteld.');};
 panel.querySelector('#kjReduceMotion').onchange=e=>{pref.reduced=e.target.checked;savePreferences();};
 panel.querySelector('#kjColorblind').onchange=e=>{pref.colorblind=e.target.checked;savePreferences();};
}

function rerenderInfo(remote){
 const el=document.getElementById('memoryPanel');if(!el)return;
 el.querySelectorAll('.kj-extra-section,.kj-extra-status').forEach(x=>x.remove());
 renderInfo(remote);
}

function urlBase64ToBytes(value){
 const base=value.replace(/-/g,'+').replace(/_/g,'/');
 return Uint8Array.from(atob(base+'='.repeat((4-base.length%4)%4)),c=>c.charCodeAt(0));
}

async function enablePush(room){
 if(!('Notification'in window))throw Error('Deze browser ondersteunt geen meldingen.');
 const allowed=await Notification.requestPermission();
 if(allowed!=='granted')throw Error('Je browser heeft meldingen niet toegestaan.');
 try{
  const registration=await navigator.serviceWorker.register('/klaverjassen/turn-sw.js',{scope:'/klaverjassen/'});
  const res=await fetch(PUSH_URL,{cache:'no-store',mode:'cors'});
  if(!res.ok)throw Error('Geen push-endpoint');
  const conf=await res.json();
  if(!conf.publicKey)throw Error('Geen meldingssleutel');
  let sub=await registration.pushManager.getSubscription();
  if(!sub)sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToBytes(conf.publicKey)});
  await K.consentPush(room,sub.toJSON());
  pref.subscriptions[room]=sub.endpoint;
 }catch(_){
  pref.subscriptions[room]='local';
 }
 savePreferences();
}

async function disablePush(room){
 if(!pref.subscriptions?.[room])return;
 if(pref.subscriptions[room]!=='local')await K.removePush(room,pref.subscriptions[room]);
 delete pref.subscriptions[room];savePreferences();
}

function onState(remote){
 const room=remote?.game?.lobby_code;if(!room)return;
 if(room!==session.room){session.room=room;session.share=null;session.lastTurn=null;session.stats=null;}
 const st=remote.game.state||{},seat=Number(remote.viewer?.seat);
 const actor=st.phase==='bidding'?st.bidder_turn:st.turn;
 const key=st.phase+':'+(st.taken||[]).length+':'+(st.rounds||[]).length+':'+actor;
 if(session.lastTurn!==null&&session.lastTurn!==key&&actor===seat&&
   document.hidden&&pref.subscriptions?.[room]&&('Notification'in window)&&Notification.permission==='granted'){
  try{new Notification('Klaverjassen · jouw beurt',{body:room+' · jouw zet is aan de beurt',tag:'kj-turn-'+room});}catch(_){}
 }
 session.lastTurn=key;
 renderInfo(remote);
 renderStats();
}
applyPreferences();
global.KALENEL_KJ_ENHANCEMENTS={onState,onPane:pane=>{if(pane==='statsPanel'&&!session.stats&&!session.loading)refreshStats();},duration,reduceMotion,applyPreferences,calculate,shouldPollHidden:()=>!!pref.subscriptions?.[session.room]};
})(window);
