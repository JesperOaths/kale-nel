/* Standalone Klaverjassen: Amsterdam legality and clockwise seat geometry.
 * Only used by /klaverjassen/, never alters the original authenticated game.
 */
(function(global){
  'use strict';
  const K=global.GEJAST_KLAVERJAS_ONLINE;
  if(!K)throw Error('Klaverjassen spelregels ontbreken');
  const SUIT_NAME={hearts:'Harten',spades:'Schoppen',diamonds:'Ruiten',clubs:'Klaver',sans:'Sans'};
  const POSITIONS=['bottom','left','top','right'];
  function nextSeat(seat){return (Number(seat)+1)%4;}
  function tablePosition(seat,viewer){
    const perspective=Number.isInteger(viewer)&&viewer>=0&&viewer<=3?viewer:0;
    return POSITIONS[(Number(seat)-perspective+4)%4];
  }
  function evaluate(hand,trick,playerIndex,trumpSuit){
    const cards=Array.isArray(hand)?hand:[];
    const played=Array.isArray(trick)?trick:[];
    const trump=trumpSuit==='sans'?null:trumpSuit||null;
    const all=()=>({cards,rule:'free',message:'Je komt uit: kies zelf een kaart.',leadSuit:null,trumpSuit:trump});
    if(!played.length)return all();
    const led=played[0]?.card?.suit;
    const follow=cards.filter(c=>c.suit===led);
    const win=K.currentWinner(played,trump);
    const teamWinning=win&&K.TEAM_OF[win.player]===K.TEAM_OF[playerIndex];
    const t=cards.filter(c=>c.suit===trump);
    const other=cards.filter(c=>c.suit!==trump);
    const bestTrump=win?.card?.suit===trump?win.card:null;
    const over=bestTrump?t.filter(c=>K.compareCards(c,bestTrump,trump,trump)>0):[];
    const result=(allowed,rule,message)=>({
      cards:allowed,rule,message,leadSuit:led,trumpSuit:trump,
      winningSeat:win?.player??null
    });
    if(follow.length){
      if(led===trump&&over.length)
        return result(over,'overtrump','Troef gevraagd: je moet zo mogelijk overtroeven.');
      return result(follow,'follow','Kleur bekennen: speel '+SUIT_NAME[led]+
        (led===trump?' (troef).':' (de uitgekomen kleur).'));
    }
    if(!trump||!t.length)
      return result(cards,'discard','Je hebt geen '+SUIT_NAME[led]+
        (trump?' en geen troef.':'')+': je mag een andere kleur afgooien.');
    // Amsterdams: a partner currently winning a non-trump trick need not be trumped.
    if(teamWinning){
      if(bestTrump&&other.length){
        if(over.length)
          return result(other.concat(over),'partner','Je maat wint: afgooien mag. Troef kan alleen als je overtroeft.');
        return result(other,'no-undertrump','Je maat wint: je hoeft niet te troeven. Ondertroeven is niet toegestaan als je kunt afgooien.');
      }
      return result(cards,'partner','Je maat wint: je hoeft niet in te troeven.');
    }
    if(!bestTrump)
      return result(t,'trump','Je kunt niet bekennen en de tegenpartij wint: troeven is verplicht ('+SUIT_NAME[trump]+').');
    if(over.length)
      return result(over,'overtrump','De tegenpartij heeft getroefd: je moet overtroeven.');
    if(other.length)
      return result(other,'no-undertrump','Je kunt niet overtroeven: gooi een andere kleur af; ondertroeven mag niet.');
    return result(t,'forced-undertrump','Je hebt alleen lagere troeven: ondertroeven is nu toegestaan.');
  }
  function legalCards(hand,trick,seat,trump){
    return evaluate(hand,trick,seat,trump).cards;
  }
  K.guestClockwiseNext=nextSeat;
  K.guestSeatPosition=tablePosition;
  K.guestAnalyzeHand=evaluate;
  K.guestLegalCards=legalCards;
})(window);
