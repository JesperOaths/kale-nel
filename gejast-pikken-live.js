(function(){
  const api = window.GEJAST_PIKKEN_CONTRACT;
  if (!api) { console.error('GEJAST_PIKKEN_CONTRACT missing'); return; }
  const params = new URLSearchParams(location.search);
  const gameId = params.get('client_match_id') || params.get('game_id') || '';
  let timer = null, busy = false, lastVersion = -1, model = null, hasRendered = false, lastRoundNo = 0, lastRevealKey = '', finishedOverlayShown = false, finishedOrLeaving = false;
  const savedCompleted = new Set();
  const savedCheckpoints = new Set();
  const $ = (id)=>document.getElementById(id);
  const esc = (v)=>String(v ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const faceOrder = (f)=>Number(f)===1?7:Number(f||0);
  const sortDice = (a)=>(Array.isArray(a)?a:[]).map(Number).filter(Boolean).sort((x,y)=>faceOrder(x)-faceOrder(y));
  const die = (n)=>`<img class="die ${Number(n)===1?'pik':''}" src="./assets/pikken/dice-${Number(n)||'hidden'}.svg" alt="die ${Number(n)||''}">`;
  function bidText(b){ const c=Number(b?.count||b?.bid_count||0), f=Number(b?.face||b?.bid_face||0); if(!c||!f)return '--'; return f===1?`${c} x pik`:`${c} x ${f}`; }
  function revealText(lr){
    if(!lr) return 'Nog geen reveal.';
    const loser = lr.loser_name || (lr.loser_id ? `speler ${lr.loser_id}` : 'onbekend');
    const after = Number.isFinite(Number(lr.loser_dice_after)) ? ` - nu ${Number(lr.loser_dice_after)} dobbel(s)` : '';
    const next = lr.next_round ? ` Volgende ronde: ${Number(lr.next_round)}.` : '';
    const hands=Array.isArray(lr.hands)?lr.hands:[];
    const handHtml=hands.length?`<div class="reveal-hands">${hands.map(renderRevealHand).join('')}</div>`:'';
    return `<div><strong>${esc(bidText(lr.bid))}</strong> - ${lr.bid_true?'gehaald':'niet gehaald'} - ${Number(lr.counted_total||0)} hit(s).</div><div class="muted">Verliezer: ${esc(loser)}${after}.${next}</div>${handHtml}`;
  }
  function dieMarked(item, idx=0, all=[], loser=false){
    const n=Number(item?.value||item||0);
    const counted=!!item?.counted;
    const lost=!!loser && idx===all.length-1;
    return `<span class="reveal-die ${n===1?'pik':''} ${counted?'counted':''} ${lost?'lost':''}">${die(n)}</span>`;
  }
  function renderRevealHand(h){
    const dice=Array.isArray(h.dice)?h.dice:[];
    const eliminated=h.loser && Number(h.dice_after ?? h.loser_dice_after ?? -1) === 0;
    return `<div class="reveal-hand ${h.loser?'loser':''}"><div><strong>${esc(h.name||'Speler')}</strong>${h.loser?`<span class="loss-pill">${eliminated?'uitgeschakeld':'-1 dobbelsteen'}</span>`:''}</div><div class="dice-row">${dice.map((d,i,a)=>dieMarked(d,i,a,!!h.loser)).join('')}</div></div>`;
  }
  function winnerFrom(payload){
    const st=payload?.game?.state||{};
    if(st.winner_name) return st.winner_name;
    const alive=(Array.isArray(payload?.players)?payload.players:[]).filter((p)=>p.alive && Number(p.dice_count||0)>0);
    return alive.length===1 ? (alive[0].name||alive[0].player_name||'Winnaar') : '';
  }
  function playerName(p){ return p?.name || p?.player_name || 'Speler'; }
  function diceLabel(n){
    const v = Number(n || 0);
    return `${v} ${v === 1 ? 'dobbelsteen' : 'dobbelstenen'} over`;
  }
  function rankingRows(payload){
    const players=Array.isArray(payload?.players)?payload.players:[];
    return players.slice().sort((a,b)=>{
      const ad=Number(a.dice_count||0), bd=Number(b.dice_count||0);
      const aa=(a.alive && ad>0)?1:0, ba=(b.alive && bd>0)?1:0;
      if(ba!==aa) return ba-aa;
      if(bd!==ad) return bd-ad;
      return Number(a.seat||a.seat_index||0)-Number(b.seat||b.seat_index||0);
    }).map((p,i)=>`<div class="finish-row ${i===0?'winner':''}"><strong>${i+1}. ${esc(playerName(p))}</strong><span>${diceLabel(p.dice_count)}</span></div>`).join('');
  }
  function victoryFestivityHtml(winner){
    return `<div class="victory-fest" aria-hidden="true">
      <span class="streamer s1"></span><span class="streamer s2"></span><span class="streamer s3"></span>
      <span class="balloon b1"></span><span class="balloon b2"></span><span class="balloon b3"></span>
      <img class="fest-logo l1" src="./logo.png" alt=""><img class="fest-logo l2" src="./logo.png" alt="">
      <span class="fest-die d1">2</span><span class="fest-die d2">6</span><span class="fest-die d3">pik</span>
      <span class="confetti c1"></span><span class="confetti c2"></span><span class="confetti c3"></span><span class="confetti c4"></span>
    </div><div class="victory-name-burst">${esc(winner || 'Winnaar')}</div>`;
  }
  function phase(p){ return String(p?.game?.state?.phase || p?.game?.status || 'lobby').toLowerCase(); }
  function setText(id, val){ const el=$(id); if(el) el.textContent=val; }
  function seatClass(i){ const map=['top','right','bottom','left','extra1','extra2','extra3','extra4']; return map[i%map.length]; }
  function legalOptions(bid,total){
    const out=[]; const add=(c,f)=>{ if(c>0&&f>0&&c<=Math.max(total,1)) out.push({c,f,label:f===1?`${c} x pik`:`${c} x ${f}`}); };
    const c=Number(bid?.count||0), f=Number(bid?.face||0);
    if(!c||!f){ for(let n=1;n<=Math.max(total,1);n++){ for(let x=2;x<=6;x++) add(n,x); add(n,1); } return out; }
    const order=[2,3,4,5,6,1];
    const idx=order.indexOf(f);
    order.slice(Math.max(idx+1,0)).forEach((x)=>add(c,x));
    for(let n=c+1;n<=total;n++) order.forEach((x)=>add(n,x));
    return out;
  }
  function clearParticipantAndReturn(){
    finishedOrLeaving = true;
    try {
      localStorage.removeItem('gejast_pikken_participant_v687');
      localStorage.removeItem('gejast_pikken_participant_v632');
    } catch (_) {}
    setTimeout(()=>{ location.href='./pikken.html'; }, 650);
  }
  function viewerActive(payload){
    const viewer = payload?.viewer || {};
    if (viewer.is_host) return true;
    const players = Array.isArray(payload?.players) ? payload.players : [];
    if (!players.length) return false;
    const viewerId = String(viewer.player_id || viewer.id || '');
    const viewerSeat = Number(viewer.seat || viewer.seat_index || 0);
    const viewerName = String(viewer.player_name || viewer.name || '').toLowerCase();
    return players.some((p)=>{
      const pid = String(p.player_id || p.id || '');
      const seat = Number(p.seat || p.seat_index || 0);
      const name = String(p.player_name || p.name || '').toLowerCase();
      return (viewerId && pid === viewerId) || (viewerSeat && seat === viewerSeat) || (viewerName && name === viewerName);
    });
  }
  function showRoundOverlay(lr, opts={}){
    const overlay=$('roundOverlay');
    if(!overlay) return;
    const title=$('roundOverlayTitle'), text=$('roundOverlayText'), row=$('roundOverlayDice'), hands=$('roundOverlayHands');
    const loser = lr?.loser_name || (lr?.loser_id ? `speler ${lr.loser_id}` : 'de verliezer');
    const eliminated=Number(lr?.loser_dice_after ?? -1) === 0;
    const card=overlay.querySelector('.round-card');
    if(card) card.classList.toggle('victory', !!opts.victory);
    if(title) title.textContent = opts.victory ? `${opts.winner || 'Winnaar'} wint Pikken` : (lr ? `${lr.bid_true ? 'Bod gehaald' : 'Bod niet gehaald'}` : 'Nieuwe ronde');
    if(text) text.textContent = opts.victory ? `${opts.winner || 'De laatste speler'} blijft over. Match afgelopen.` : (lr ? `${bidText(lr.bid)} telde ${Number(lr.counted_total||0)} keer. ${loser} verliest een dobbelsteen${eliminated?' en is uitgeschakeld':''}.` : 'Nieuwe ronde.');
    if(row) row.innerHTML = opts.victory ? victoryFestivityHtml(opts.winner || winnerFrom(model)) : (lr?.next_round ? `<span>Nieuwe ronde ${Number(lr.next_round)}</span>` : '');
    if(hands) hands.innerHTML = opts.victory ? `<div class="finish-ranking">${rankingRows(model)}</div>` : (Array.isArray(lr?.hands) ? lr.hands.map(renderRevealHand).join('') : '');
    if(!overlay.querySelector('.round-close')) overlay.querySelector('.round-card')?.insertAdjacentHTML('beforeend','<button class="btn alt round-close" type="button">Sluiten</button>');
    overlay.querySelector('.round-close')?.addEventListener('click', ()=>{
      overlay.classList.remove('show');
      overlay.classList.add('hidden');
      if (opts.victory) clearParticipantAndReturn();
    }, { once:true });
    overlay.classList.remove('hidden');
    overlay.classList.add('show');
    window.clearTimeout(showRoundOverlay._timer);
    if(!opts.sticky) showRoundOverlay._timer = window.setTimeout(()=>{ overlay.classList.remove('show'); overlay.classList.add('hidden'); }, 8200);
  }
  async function persistCompleted(payload){
    const id = payload?.game?.id || gameId;
    if(!id || !api.recordCompleted) return;
    const key = `gejast_pikken_completed_saved_${id}`;
    if(savedCompleted.has(id)) return;
    try{ if(localStorage.getItem(key)==='1') return; }catch(_){}
    savedCompleted.add(id);
    try{
      await api.recordCompleted(id);
      finishedOrLeaving = true;
      try{ localStorage.setItem(key,'1'); }catch(_){}
    }catch(err){
      savedCompleted.delete(id);
      setText('metaLine', 'Match afgelopen, maar stats opslaan mislukte: '+(err.message||err));
    }
  }
  function closeOnPageExit(){
    if (finishedOrLeaving || !model || !gameId) return;
    const ph = phase(model);
    if (!['lobby','bidding','voting','live'].includes(ph)) return;
    finishedOrLeaving = true;
    try { api.abandonAndRecordKeepalive && api.abandonAndRecordKeepalive(gameId, 'page_left'); } catch (_) {}
  }
  async function persistCheckpoint(payload){
    const id = payload?.game?.id || gameId;
    const roundNo = Number(payload?.game?.state?.round_no || 0);
    if(!id || roundNo < 10 || !api.recordCompleted) return;
    const bucket = Math.floor(roundNo / 10) * 10;
    const key = `gejast_pikken_checkpoint_saved_${id}_${bucket}`;
    if(savedCheckpoints.has(key)) return;
    try{ if(localStorage.getItem(key)==='1') return; }catch(_){}
    savedCheckpoints.add(key);
    try{
      await api.recordCompleted(id);
      try{ localStorage.setItem(key,'1'); }catch(_){}
    }catch(err){
      savedCheckpoints.delete(key);
    }
  }
  function render(payload){
    model = payload;
    const game=payload.game||{}, st=game.state||{}, players=Array.isArray(payload.players)?payload.players:[], viewer=payload.viewer||{}, ph=phase(payload);
    if(!viewerActive(payload)){
      setText('metaLine','Je zit niet meer in deze Pikken-match.');
      clearParticipantAndReturn();
      return;
    }
    setText('metaLine', `${game.lobby_code||'Pikken'} - ${ph} - bijgewerkt ${new Date().toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}`);
    const pill=$('phasePill'); if(pill){ pill.textContent=ph; pill.className=`pill ${ph==='bidding'?'ok':ph==='finished'?'bad':'wait'}`; }
    setText('currentBid', bidText(st.bid));
    setText('roundNo', String(Number(st.round_no||0)));
    setText('penaltyMode', String(game.config?.penalty_mode||'wrong_loses')==='right_loses'?'Fair':'Normal');
    const turn = ph==='voting' ? Number(st.vote_turn_seat||0) : Number(st.current_turn_seat||0);
    const turnP=players.find((p)=>Number(p.seat||p.seat_index||0)===turn);
    setText('turnName', turnP?.name || turnP?.player_name || '--');
    setText('bidBy', st.bid ? `door ${st.bid.bidder_name || '--'}` : 'Nog geen bod');
    const fallbackCurrent=players.reduce((s,p)=>s+Number(p.dice_count||0),0), fallbackStart=players.length*6;
    setText('diceFraction', `${Number(payload.dice_totals?.current_total||fallbackCurrent||0)}/${Number(payload.dice_totals?.start_total||fallbackStart||0)}`);

    const ring=$('seatRing');
    if(ring){
      ring.querySelectorAll('.seat').forEach((n)=>n.remove());
      players.forEach((p,i)=>{
        const seat=Number(p.seat||p.seat_index||0);
        const div=document.createElement('div');
        div.className=`seat ${seatClass(i)} ${seat===Number(viewer.seat||viewer.seat_index||0)?'me':''} ${seat===turn?'turn':''} ${p.alive?'':'dead'}`;
        div.innerHTML=`<div class="seat-top"><div><div class="seat-name">${esc(p.name||p.player_name||'Speler')}</div><div class="seat-meta">stoel ${seat} - ${Number(p.dice_count||0)} dobbel(s)</div></div></div>`;
        ring.appendChild(div);
      });
    }

    const dice=sortDice(payload.my_hand || viewer.my_hand || []);
    const diceHtml = dice.length
      ? `<div class="dice-row">${dice.map(die).join('')}</div><div class="muted" style="margin-top:8px">Gesorteerd 2-6, pik rechts. 1 telt als pik/joker.</div>`
      : '<div class="muted">Geen privesessie of nog geen hand zichtbaar.</div>';
    const note=$('diceStateNote'); if(note) note.innerHTML = diceHtml;
    const roundNo=Number(st.round_no||0);
    const revealKey=st.last_reveal ? `${st.last_reveal.round_no||''}:${st.last_reveal.loser_id||''}:${st.last_reveal.counted_total||''}` : '';
    const showFinishedNow = ph === 'finished' && st.last_reveal && revealKey && !finishedOverlayShown;
    const showRoundNow = hasRendered && st.last_reveal && roundNo !== lastRoundNo && revealKey && revealKey !== lastRevealKey;
    if(showFinishedNow || showRoundNow){
      const winner=ph==='finished' ? winnerFrom(payload) : '';
      showRoundOverlay(st.last_reveal, { victory: ph==='finished', winner, sticky: ph==='finished' });
      if(ph === 'finished') finishedOverlayShown = true;
      if(note){ note.classList.remove('dice-rolling'); void note.offsetWidth; note.classList.add('dice-rolling'); }
    }
    if(ph==='finished') persistCompleted(payload);
    else persistCheckpoint(payload);
    lastRoundNo=roundNo; lastRevealKey=revealKey || lastRevealKey; hasRendered=true;
    const my=$('myDiceBody'); if(my) my.innerHTML = '';

    const voteWrap=$('tableVotes');
    if(voteWrap){
      const votes=Array.isArray(payload.votes)?payload.votes:[];
      voteWrap.innerHTML = ph==='voting' ? votes.map((v)=>`<span class="table-vote">${v.status==='approved'?'OK':v.status==='rejected'?'NO':'...'} ${esc(v.name||'')}</span>`).join('') : '';
    }
    const opts=legalOptions(st.bid, Number(payload.dice_totals?.current_total||fallbackCurrent||1));
    const sel=$('bidSelect'); if(sel) sel.innerHTML=opts.map((o)=>`<option value="${o.c}:${o.f}">${esc(o.label)}</option>`).join('');
    const mySeat=Number(viewer.seat||viewer.seat_index||0), alive=!!viewer.alive;
    const myTurn=ph==='bidding'&&mySeat===Number(st.current_turn_seat||0)&&alive;
    const bidderSeat=Number(st.bid?.bidder_seat||0);
    const myVote=ph==='voting'&&mySeat!==bidderSeat&&mySeat===Number(st.vote_turn_seat||0)&&alive;
    $('bidControls')?.classList.toggle('hidden', !myTurn);
    $('voteControls')?.classList.toggle('hidden', !myVote);
    $('leaveBtn')?.classList.toggle('hidden', !api.sessionToken() || ph === 'finished');
    $('destroyBtn')?.classList.toggle('hidden', !(viewer.is_host&&api.sessionToken()) || ph === 'finished');
    const context=$('mobileContext'); if(context) context.textContent = myTurn ? 'Jij bent aan de beurt.' : myVote ? 'Jij moet stemmen.' : 'Live meekijken.';
    const reveal=$('revealBody');
    if(reveal){
      const lr=st.last_reveal;
      reveal.innerHTML = revealText(lr);
    }
  }
  async function refresh(force=false){
    if(!gameId){ setText('metaLine','Geen game_id in URL.'); return; }
    if(busy) return; busy=true;
    try{
      const payload=await api.getState(gameId);
      const v=Number(payload?.game?.state_version||-1);
      if(force||v!==lastVersion){ lastVersion=v; render(payload); }
    } catch(e){
      const msg=String(e.message||e||'');
      setText('metaLine', msg || 'Pikken laden mislukt.');
      if(/niet gevonden|not found|missing|deleted|verwijderd/i.test(msg)) clearParticipantAndReturn();
    } finally{ busy=false; }
  }
  function act(fn){ return fn().then(()=>refresh(true)).catch((e)=>alert(e.message||String(e))); }
  $('reconnectBtn')?.addEventListener('click', ()=>refresh(true));
  $('rollBtn')?.addEventListener('click', ()=>refresh(true));
  $('bidBtn')?.addEventListener('click', ()=>{ const [c,f]=String($('bidSelect')?.value||'').split(':').map(Number); if(c&&f) act(()=>api.placeBid(gameId,c,f)); });
  $('rejectBtn')?.addEventListener('click', ()=>act(()=>api.rejectBid(gameId)));
  $('approveBtn')?.addEventListener('click', ()=>act(()=>api.castVote(gameId,true)));
  $('voteRejectBtn')?.addEventListener('click', ()=>act(()=>api.castVote(gameId,false)));
  $('leaveBtn')?.addEventListener('click', ()=>{ if(confirm('Match verlaten?')) api.leaveGame(gameId).then(()=>{ clearParticipantAndReturn(); }).catch((e)=>alert(e.message)); });
  $('destroyBtn')?.addEventListener('click', ()=>{ if(confirm('Host: match verwijderen?')) api.destroyGame(gameId).then(()=>{ clearParticipantAndReturn(); }).catch((e)=>alert(e.message)); });
  window.addEventListener('pagehide', closeOnPageExit);
  window.addEventListener('beforeunload', closeOnPageExit);
  refresh(true);
  timer=setInterval(()=>{ if(!document.hidden) refresh(false); }, 800);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) refresh(true); });
})();
