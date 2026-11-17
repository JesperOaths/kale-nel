/* Standalone Klaverjassen guest room bridge.
 * A per-room 256-bit capability identifies each participant.
 * Never expose another player's key, cards or GEJAST account session.
 */
(function(global){
  'use strict';
  const K=global.GEJAST_KLAVERJAS_ONLINE;
  if(!K) throw Error('Klaverjas game core ontbreekt');
  const ENDPOINT='https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/klaverjassen_guest_v1';
  const EXTRA_ENDPOINT='https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/klaverjassen_guest_extra_v1';
  const PROFILE_KEY='kalenel_kj_guest_profile_secret_v1';
  const PUBLISHABLE_KEY='sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA';
  const PREFIX='kalenel_klaverjassen_guest_cap_v1_';
  const NICK_KEY='kalenel_klaverjassen_guest_nickname_v1';
  const ROOM_KEY='kalenel_klaverjassen_guest_room_v1';
  const revisions=Object.create(null);
  const validCode=c=>/^[A-Z0-9]{4,12}$/.test(String(c||'').toUpperCase());
  const store=global.localStorage;
  function activeCode(){
    const query=new URLSearchParams(global.location.search);
    return String(query.get('room')||store.getItem(ROOM_KEY)||'').toUpperCase();
  }
  function stored(code){
    if(!validCode(code)) return null;
    try{
      const value=JSON.parse(store.getItem(PREFIX+code)||'null');
      return value&&/^[0-9a-f]{64}$/.test(value.token)&&typeof value.name==='string'?value:null;
    }catch(_){return null;}
  }
  function remember(code,token,name){
    if(!validCode(code)) throw Error('Ongeldige roomcode');
    store.setItem(PREFIX+code,JSON.stringify({token,name,updatedAt:Date.now()}));
    store.setItem(NICK_KEY,name);
    store.setItem(ROOM_KEY,code);
  }
  function knownCodes(){
    const out=[];
    try{
      for(let i=0;i<store.length&&out.length<30;i++){
        const key=store.key(i);
        if(!key?.startsWith(PREFIX))continue;
        const code=key.slice(PREFIX.length);
        if(validCode(code)&&stored(code))out.push(code);
      }
    }catch(_){}
    return out.slice(0,15);
  }
  async function listAccessible(){
    const publicRooms=await request('list',null,stored(activeCode())?.token||null,null,{});
    const myCodes=knownCodes();
    const owned=await Promise.all(myCodes.map(async code=>{
      try{
        const credential=stored(code),room=await request('state',code,credential.token,null,{});
        const g=room.game||{},members=g.state?.players||[];
        if(!['lobby','playing'].includes(g.status))return null;
        return {
          id:g.id,lobby_code:g.lobby_code,room_title:g.room_title,
          status:g.status,created_by_player_name:g.created_by_player_name,
          resume_until:g.resume_until,player_count:members.length,
          human_count:members.filter(p=>!p.is_bot).length,
          bot_count:members.filter(p=>p.is_bot).length,
          has_me:true,is_host:!!room.viewer?.is_host
        };
      }catch(_){return null;}
    }));
    const byCode=new Map();
    for(const row of publicRooms||[])byCode.set(row.lobby_code,row);
    for(const row of owned)if(row)byCode.set(row.lobby_code,row);
    return [...byCode.values()].sort((a,b)=>
      Number(Boolean(b.has_me))-Number(Boolean(a.has_me)) ||
      Number(b.status==='playing')-Number(a.status==='playing'));
  }
  function randomToken(){
    const a=new Uint8Array(32);
    global.crypto.getRandomValues(a);
    return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');
  }
  function nickname(prefer){
    const field=document.getElementById('guestName');
    let name=String(prefer||field?.value||store.getItem(NICK_KEY)||'').trim().replace(/\s+/g,' ').slice(0,30);
    if(!name){
      const answer=global.prompt('Met welke naam wil je klaverjassen?');
      name=String(answer||'').trim().replace(/\s+/g,' ').slice(0,30);
    }
    if(!name) throw Error('Vul eerst je spelersnaam in.');
    if(field) field.value=name;
    store.setItem(NICK_KEY,name);
    return name;
  }
  async function request(action,room,token,name,payload){
    let response;
    try{
      response=await fetch(ENDPOINT,{
        method:'POST',mode:'cors',cache:'no-store',
        headers:{'Content-Type':'application/json',apikey:PUBLISHABLE_KEY},
        body:JSON.stringify({action_input:action,room_input:room||null,token_input:token||null,
          name_input:name||null,payload_input:payload||{}})
      });
    }catch(_){throw Error('Verbinding met de spelserver mislukt. Controleer wifi of mobiel internet.');}
    const raw=await response.text();
    let data;
    try{data=JSON.parse(raw);}catch(_){throw Error('Ongeldig antwoord van de spelserver');}
    if(!response.ok) throw Error(data.message||data.error||'Spelserver: HTTP '+response.status);
    if(data?.game?.lobby_code) revisions[data.game.lobby_code]=Number(data.game.revision);
    return data;
  }

  function profileKey(){
    let key=store.getItem(PROFILE_KEY);
    if(!/^[0-9a-f]{64}$/.test(key||'')){key=randomToken();store.setItem(PROFILE_KEY,key);}
    return key;
  }
  async function extra(action,code,payload={},token=null){
    const credential=token||stored(code)?.token;
    if(!validCode(code)||!/^[0-9a-f]{64}$/.test(credential||''))throw Error('Open eerst je eigen tafel.');
    let response;
    try{response=await fetch(EXTRA_ENDPOINT,{
      method:'POST',mode:'cors',cache:'no-store',
      headers:{'Content-Type':'application/json',apikey:PUBLISHABLE_KEY},
      body:JSON.stringify({action_input:action,room_input:code,
        token_input:credential,payload_input:payload})
    });}catch(_){throw Error('Geen verbinding met de spelserver.');}
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw Error(data?.message||data?.error||'Extra functie niet beschikbaar: HTTP '+response.status);
    if(data?.game?.lobby_code)revisions[data.game.lobby_code]=Number(data.game.revision);
    return data;
  }
  async function transferStart(code=activeCode()){
    const res=await extra('transfer_start',code);
    const url=global.location.origin+'/klaverjassen/?room='+encodeURIComponent(code)+
      '#recover='+res.claim+'&profile='+profileKey();
    return {url,expiresAt:res.expires_at,code:res.claim};
  }
  async function transferClaim(code,claim,profile=null){
    if(!/^[0-9A-F]{32}$/.test(claim||''))throw Error('De overdrachtscode is ongeldig');
    // Never reuse a seat token. The backend atomically revokes the old one.
    const fresh=randomToken();
    const response=await extra('transfer_claim',code,{claim},fresh);
    if(!response?.viewer||!response?.game)throw Error('Onvolledige overdrachtsbevestiging');
    if(/^[0-9a-f]{64}$/.test(profile||''))store.setItem(PROFILE_KEY,profile);
    remember(code,fresh,response.viewer.name);
    try{await extra('profile_link',code,{profile_key:profileKey()},fresh);}catch(_){}
    return response;
  }
  async function getPlayerStats(code=activeCode()){
    const identity=profileKey();
    const rooms=knownCodes();
    if(!rooms.includes(code)&&validCode(code))rooms.unshift(code);
    await Promise.all(rooms.map(async room=>{
      try{await extra('profile_link',room,{profile_key:identity});}catch(_){}
    }));
    return extra('profile_stats',code,{profile_key:identity});
  }
  async function consentPush(code,subscription){
    return extra('push_subscribe',code,{subscription});
  }
  async function removePush(code,endpoint){
    return extra('push_unsubscribe',code,{endpoint});
  }

  K.sessionToken=()=>stored(activeCode())?.token||'';
  K.currentScope=()=> 'friends';
  K.rpc=async function(name,params={}){
    const code=String(params.lobby_code_input||activeCode()||'').toUpperCase();
    switch(name){
      case 'klaverjas_online_create': {
        const token=randomToken(),person=nickname();
        const response=await request('create',null,token,person,{settings:params.settings_input||{}});
        remember(response.game.lobby_code,token,person);
        return response;
      }
      case 'klaverjas_online_join': {
        if(!validCode(code)) throw Error('Vul een roomcode in (4 tot 12 letters of cijfers)');
        const old=stored(code),token=old?.token||randomToken();
        const person=old?.name||nickname();
        const response=await request('join',code,token,person);
        remember(code,token,response.viewer?.name||person);
        return response;
      }
      case 'klaverjas_online_list_open': {
        return listAccessible();
      }
      case 'klaverjas_online_get_state': {
        const credential=stored(code);
        if(!credential) throw Error('Join deze tafel eerst met je spelersnaam. Je persoonlijke link wordt daarna onthouden.');
        return request('state',code,credential.token,null,{});
      }
      case 'klaverjas_online_save_state': {
        const credential=stored(code);
        if(!credential) throw Error('Je sessie voor deze tafel ontbreekt. Join opnieuw.');
        const revision=revisions[code];
        if(!Number.isInteger(revision)) throw Error('Laad eerst de actuele tafel.');
        return request('save',code,credential.token,null,
          {revision,state:params.state_input});
      }
      case 'klaverjas_online_delete_room': {
        const room=String(params.lobby_code_input||code).toUpperCase();
        const credential=stored(room);
        if(!credential) throw Error('Alleen de host kan deze tafel sluiten.');
        return request('close',room,credential.token,null,{});
      }
      default: throw Error('Onbekende klaverjasactie: '+String(name));
    }
  };
  global.KALENEL_KJ_GUEST={
    hasToken:code=>!!stored(String(code||'').toUpperCase()),
    roomLink:code=>global.location.origin+'/klaverjassen/?room='+encodeURIComponent(code),
    nickname,
    activeCode,knownCodes,profileKey,
    transferStart,transferClaim,
    handover:(code,targetSeat)=>extra('host_handover',code,{seat:targetSeat}),
    getPlayerStats,consentPush,removePush,
    cancelTransfer:(code)=>extra('transfer_cancel',code)
  };
  function setup(){
    const field=document.getElementById('guestName');
    if(field&&!field.value) field.value=store.getItem(NICK_KEY)||'';
    const roomField=document.getElementById('codeInput');
    const invitation=new URLSearchParams(global.location.search).get('room');
    if(roomField&&validCode(invitation)) roomField.value=invitation.toUpperCase();

    if(roomField&&validCode(invitation)){
      const hash=new URLSearchParams(global.location.hash.replace(/^#/,''));
      const claim=hash.get('recover'),profile=hash.get('profile');
      if(/^[0-9A-F]{32}$/.test(claim||'')){
        const container=roomField.closest('.home-panel')||roomField.parentElement;
        const panel=document.createElement('section');
        panel.className='transfer-recovery';
        panel.style.cssText='padding:14px;margin:12px 0;border:2px solid #bc923e;border-radius:14px;background:#fff7e0;color:#262018;';
        const title=document.createElement('strong');
        title.textContent='Neem je bestaande spelersstoel veilig over';
        const message=document.createElement('p');
        message.textContent='Room '+invitation.toUpperCase()+
          ' · Met deze eenmalige link wordt je vorige apparaat afgemeld. De code verloopt na 10 minuten.';
        const button=document.createElement('button');
        button.type='button';button.className='btn gold';button.textContent='Neem mijn stoel over';
        const feedback=document.createElement('div');feedback.setAttribute('role','status');
        feedback.style.marginTop='8px';
        button.addEventListener('click',async()=>{
          button.disabled=true;feedback.textContent='Bezig met veilige overdracht...';
          try{
            await transferClaim(invitation.toUpperCase(),claim,profile);
            global.history.replaceState(null,'',global.location.pathname+'?room='+encodeURIComponent(invitation.toUpperCase()));
            global.location.replace('room.html?room='+encodeURIComponent(invitation.toUpperCase()));
          }catch(error){feedback.textContent=error?.message||'Overdracht mislukt.';button.disabled=false;}
        });
        panel.append(title,message,button,feedback);
        container.prepend(panel);
      }
    }

    const actions=document.querySelector('.top-actions');
    if(actions&&global.location.pathname.endsWith('/room.html')){
      const share=document.createElement('button');
      share.className='btn gold';share.type='button';share.id='shareGuestRoom';share.textContent='Deel uitnodiging';
      actions.prepend(share);
      share.addEventListener('click',async()=>{
        const code=activeCode();if(!validCode(code))return;
        const url=global.KALENEL_KJ_GUEST.roomLink(code);
        try{await navigator.clipboard.writeText(url);share.textContent='Link gekopieerd ✓';
          setTimeout(()=>share.textContent='Deel uitnodiging',2400);
        }catch(_){global.prompt('Kopieer deze uitnodiging:',url);}
      });
    }
    if(roomField){
      roomField.setAttribute('autocomplete','off');
      roomField.setAttribute('spellcheck','false');
      roomField.setAttribute('inputmode','text');
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',setup,{once:true});
  else setup();
})(window);
