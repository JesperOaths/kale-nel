(function(w){
const K=w.GEJAST_KLAVERJAS_ONLINE;if(!K||K.__v749Rpc)return;K.__v749Rpc=1;
let last=null,timer=null;const sleep=m=>new Promise(r=>setTimeout(r,m));
function clone(x){try{return structuredClone(x)}catch(_){return JSON.parse(JSON.stringify(x))}}
function norm(st,prev){if(!st)return st;st.app_version='v749';st.progress_tick=Number(st.progress_tick||0)+1;st.last_saved_at=new Date().toISOString();st.roem_by_team=Array.isArray(st.roem_by_team)?st.roem_by_team:[0,0];let t=st.accepted_bid&&st.accepted_bid.suit;if(st.accepted_bid&&K.effectiveBidTarget)st.target_card_points=K.effectiveBidTarget(st.accepted_bid);if(Array.isArray(st.hands)&&K.sortHand)st.hands=st.hands.map(h=>K.sortHand(h,t));prev=prev||last||{};
  if(st.phase==='bidding'&&!st.current_bid&&!st.accepted_bid&&Number(st.passes_since_bid||0)===0&&Number(prev.passes_since_bid||0)>=3&&!prev.current_bid&&K.createDeck&&K.shuffle&&K.deal){st.hands=K.deal(K.shuffle(K.createDeck()),Number(st.dealer||0));st.bidder_turn=(Number(st.dealer||0)+1)%4;st.action_needed_seat=st.bidder_turn;st.trick=[];st.pending_trick=null;st.taken=[];st.roem_by_team=[0,0];st.plays=[];st.redeal_count=Number(st.redeal_count||0)+1;st.last_redeal_reason='four_passes';st.redeal_at=new Date().toISOString()}
  if(st.pending_trick&&st.pending_trick.cards)st.last_trick=st.pending_trick;else if(st.taken&&st.taken.length)st.last_trick=st.taken[st.taken.length-1];
  if(st.phase==='roundOver'&&prev&&prev.dealer!=null&&st.dealer===(Number(prev.dealer||0)+1)%4&&K.nextDealer)st.dealer=K.nextDealer(prev.dealer);
  if(st.rounds&&st.rounds.length){let r=st.rounds[st.rounds.length-1];if(r&&!r.saved_at)r.saved_at=new Date().toISOString();if(r&&r.result)r.nat=!!r.result.nat}
  try{localStorage.setItem('klaverjas_online_progress_v749',JSON.stringify({at:new Date().toISOString(),state:st}))}catch(_){}w.GEJAST_KLAVERJAS_V749_STATE=st;return st}
function observe(out){if(out&&out.game&&out.game.state){out.game.state=norm(out.game.state,last);last=clone(out.game.state);w.GEJAST_KLAVERJAS_V749_STATE=out.game.state;schedule()}return out}
const old=K.rpc&&K.rpc.bind(K);K.rpc=async function(name,payload){payload=payload||{};if(name==='klaverjas_online_save_state'&&payload.state_input){payload.state_input=norm(payload.state_input,last);await sleep(650)}let out=await old(name,payload);return observe(out)};
function schedule(){clearTimeout(timer);timer=setTimeout(()=>{try{w.GEJAST_KLAVERJAS_V749_UI&&w.GEJAST_KLAVERJAS_V749_UI.render&&w.GEJAST_KLAVERJAS_V749_UI.render()}catch(_){ }},60)}
w.GEJAST_KLAVERJAS_V749_RPC={norm,observe};
})(window);
