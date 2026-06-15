(function (global) {
  const SUITS = ['clubs', 'spades', 'hearts', 'diamonds'];
  const SUIT_LABELS = { clubs: 'Klaver', spades: 'Schoppen', hearts: 'Harten', diamonds: 'Ruiten', sans: 'Sans' };
  const SUIT_SYMBOLS = { clubs: '♣', spades: '♠', hearts: '♥', diamonds: '♦' };
  const RANKS = ['A', '10', 'K', 'Q', 'J', '9', '8', '7'];
  const NORMAL_ORDER = ['A', '10', 'K', 'Q', 'J', '9', '8', '7'];
  const TRUMP_ORDER = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
  const ROEM_ORDER = ['A', 'K', 'Q', 'J', '10', '9', '8', '7'];
  const NORMAL_POINTS = { A: 11, '10': 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };
  const TRUMP_POINTS = { J: 20, 9: 14, A: 11, '10': 10, K: 4, Q: 3, 8: 0, 7: 0 };
  const TEAM_OF = [1, 2, 1, 2];
  const SESSION_KEYS = ['jas_session_token_v11', 'jas_session_token_v10'];

  function cfg() { return global.GEJAST_CONFIG || {}; }
  function sessionToken() {
    if (cfg().getPlayerSessionToken) return cfg().getPlayerSessionToken() || '';
    for (const key of SESSION_KEYS) {
      const value = global.localStorage.getItem(key) || global.sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }
  function currentScope() {
    try {
      if (global.GEJAST_SCOPE_UTILS && global.GEJAST_SCOPE_UTILS.getScope) return global.GEJAST_SCOPE_UTILS.getScope();
      return new URLSearchParams(global.location.search).get('scope') === 'family' ? 'family' : 'friends';
    } catch (_) {
      return 'friends';
    }
  }
  function headers() {
    return {
      apikey: cfg().SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${cfg().SUPABASE_PUBLISHABLE_KEY || ''}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }
  async function parseResponse(res) {
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.hint || `HTTP ${res.status}`);
    return data;
  }
  async function rpc(name, payload) {
    const res = await fetch(`${cfg().SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: headers(),
      body: JSON.stringify(payload || {})
    });
    return parseResponse(res);
  }

  function createDeck() {
    return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank, id: `${suit}-${rank}` })));
  }
  function shuffle(deck) {
    const copy = deck.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
  function sortHand(hand) {
    const suitIndex = Object.fromEntries(SUITS.map((suit, index) => [suit, index]));
    const rankIndex = Object.fromEntries(NORMAL_ORDER.map((rank, index) => [rank, index]));
    return (hand || []).slice().sort((a, b) => suitIndex[a.suit] - suitIndex[b.suit] || rankIndex[a.rank] - rankIndex[b.rank]);
  }
  function deal(deck, dealer) {
    const hands = [[], [], [], []];
    let cursor = 0;
    [3, 2, 3].forEach((batch) => {
      for (let offset = 1; offset <= 4; offset++) {
        const player = (dealer + offset) % 4;
        hands[player].push(...deck.slice(cursor, cursor + batch));
        cursor += batch;
      }
    });
    return hands.map(sortHand);
  }
  function cardPoints(card, trumpSuit) {
    return trumpSuit && trumpSuit !== 'sans' && card.suit === trumpSuit ? TRUMP_POINTS[card.rank] : NORMAL_POINTS[card.rank];
  }
  function compareCards(a, b, leadSuit, trumpSuit) {
    const aTrump = trumpSuit && trumpSuit !== 'sans' && a.suit === trumpSuit;
    const bTrump = trumpSuit && trumpSuit !== 'sans' && b.suit === trumpSuit;
    if (aTrump !== bTrump) return aTrump ? 1 : -1;
    if (a.suit !== b.suit) {
      if (a.suit === leadSuit) return 1;
      if (b.suit === leadSuit) return -1;
      return 0;
    }
    const order = aTrump ? TRUMP_ORDER : NORMAL_ORDER;
    return order.indexOf(b.rank) - order.indexOf(a.rank);
  }
  function currentWinner(trick, trumpSuit) {
    if (!trick || !trick.length) return null;
    const leadSuit = trick[0].card.suit;
    return trick.reduce((best, play) => compareCards(play.card, best.card, leadSuit, trumpSuit) > 0 ? play : best, trick[0]);
  }
  function legalCards(hand, trick, playerIndex, trumpSuit) {
    if (!trick || !trick.length) return hand || [];
    const leadSuit = trick[0].card.suit;
    const followSuit = (hand || []).filter((card) => card.suit === leadSuit);
    if (!trumpSuit || trumpSuit === 'sans') return followSuit.length ? followSuit : (hand || []);
    if (followSuit.length) {
      if (leadSuit !== trumpSuit) return followSuit;
      const high = currentWinner(trick, trumpSuit).card;
      const over = followSuit.filter((card) => compareCards(card, high, leadSuit, trumpSuit) > 0);
      return over.length ? over : followSuit;
    }
    const trumps = (hand || []).filter((card) => card.suit === trumpSuit);
    if (!trumps.length) return hand || [];
    const winner = currentWinner(trick, trumpSuit);
    if (winner && TEAM_OF[winner.player] === TEAM_OF[playerIndex]) return hand || [];
    const trumpsInTrick = trick.filter((play) => play.card.suit === trumpSuit);
    if (!trumpsInTrick.length) return trumps;
    const highTrump = currentWinner(trumpsInTrick, trumpSuit).card;
    const over = trumps.filter((card) => compareCards(card, highTrump, trumpSuit, trumpSuit) > 0);
    return over.length ? over : trumps;
  }
  function bidRank(bid) {
    if (!bid || bid.action === 'pass') return -1;
    if (isAllPointsBid(bid)) return 10000;
    return Number(bid.points || 0) + (bid.mode === 'sans' ? 0.1 : 0);
  }
  function isAllPointsBid(bid) {
    return !!bid && (['pit', 'mars', 'doormars'].includes(bid.kind) || (bid.mode === 'sans' && Number(bid.points) === 132));
  }
  function closesBidding(bid) {
    return isAllPointsBid(bid);
  }
  function isValidBid(bid, currentBid) {
    if (!bid || bid.action === 'pass') return true;
    if (isAllPointsBid(bid)) return true;
    if (bid.mode === 'sans') {
      if (Number(bid.points) < 70 || Number(bid.points) > 130) return false;
      return bidRank(bid) >= bidRank(currentBid);
    }
    if (bid.mode !== 'suit' || !SUITS.includes(bid.suit) || Number(bid.points) < 80 || Number(bid.points) > 160) return false;
    return bidRank(bid) > bidRank(currentBid);
  }
  function availableBids(currentBid) {
    const out = [{ action: 'pass', label: 'Pas' }];
    for (let points = 70; points <= 130; points += 10) {
      const bid = { action: 'bid', mode: 'sans', points };
      if (isValidBid(bid, currentBid)) out.push({ ...bid, label: `${points} sans` });
    }
    const sansPit = { action: 'bid', mode: 'sans', points: 132, kind: 'pit' };
    if (isValidBid(sansPit, currentBid)) out.push({ ...sansPit, label: '132 sans pit' });
    for (let points = 80; points <= 160; points += 10) {
      SUITS.forEach((suit) => {
        const bid = { action: 'bid', mode: 'suit', suit, points };
        if (isValidBid(bid, currentBid)) out.push({ ...bid, label: `${points} ${SUIT_LABELS[suit]}` });
      });
    }
    return out;
  }
  function bidLabel(bid) {
    if (!bid) return 'Geen bod';
    if (bid.action === 'pass') return 'Pas';
    if (isAllPointsBid(bid)) return `${bid.points || 132} ${bid.mode === 'sans' ? 'sans' : (SUIT_LABELS[bid.suit] || '')} ${bid.kind || 'pit'}`.trim();
    return bid.mode === 'sans' ? `${bid.points} sans` : `${bid.points} ${SUIT_LABELS[bid.suit]}`;
  }
  function actionDeadline() {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  function gameModeLabel(settings) {
    return settings?.finish_mode === 'first_to_162' ? 'Eerste tot 162' : '16 rondes';
  }
  function shouldFinishGame(state) {
    const settings = state.settings || {};
    if (settings.finish_mode === 'first_to_162') return Number(state.totals?.[0] || 0) >= 162 || Number(state.totals?.[1] || 0) >= 162;
    return (state.rounds || []).length >= 16;
  }
  function kruipLabel(winningScore, losingScore) {
    const win = Number(winningScore || 0);
    const lose = Number(losingScore || 0);
    const total = win + lose;
    if (total <= 0) return null;
    if (win >= total * (2 / 3)) return 'naakt_kruipen';
    if (lose <= win / 2) return 'kruipen';
    return null;
  }
  function winnerTeam(state) {
    const totals = state.totals || [0, 0];
    if (Number(totals[0] || 0) === Number(totals[1] || 0)) return 0;
    return Number(totals[0] || 0) > Number(totals[1] || 0) ? 1 : 2;
  }
  function cardValue(card, trumpSuit) {
    const points = cardPoints(card, trumpSuit);
    const order = trumpSuit && trumpSuit !== 'sans' && card.suit === trumpSuit ? TRUMP_ORDER : NORMAL_ORDER;
    return points * 10 + (20 - order.indexOf(card.rank));
  }
  function aiChoice(hand, trick, playerIndex, trumpSuit) {
    const legal = legalCards(hand || [], trick || [], playerIndex, trumpSuit);
    if (!legal.length) return null;
    if (!trick || !trick.length) return legal.slice().sort((a, b) => cardValue(b, trumpSuit) - cardValue(a, trumpSuit))[0];
    const winner = currentWinner(trick, trumpSuit);
    const leadSuit = trick[0].card.suit;
    const winning = legal.filter((card) => compareCards(card, winner.card, leadSuit, trumpSuit) > 0);
    const pool = winning.length ? winning : legal;
    return pool.slice().sort((a, b) => cardValue(a, trumpSuit) - cardValue(b, trumpSuit))[0];
  }
  function isBotPlayer(player) {
    return !!player && (player.is_bot === true || player.player_type === 'bot');
  }
  function hasBots(state) {
    return (state?.players || []).some(isBotPlayer);
  }
  function botName(seat) {
    return ['Klavertje Bot', 'Schoppen Bot', 'Harten Bot', 'Ruiten Bot'][seat] || `Bot ${seat + 1}`;
  }
  function botPlayers(count, startSeat) {
    const total = Math.max(0, Math.min(3, Number(count || 0)));
    return Array.from({ length: total }, (_, index) => {
      const seat = startSeat + index;
      return { seat, name: botName(seat), team: TEAM_OF[seat], is_bot: true, player_type: 'bot' };
    });
  }
  function botBid(state, seat) {
    if (state.current_bid) return { action: 'pass', label: 'Pas' };
    const hand = state.hands?.[seat] || [];
    const suitScores = Object.fromEntries(SUITS.map((suit) => [suit, 0]));
    hand.forEach((card) => {
      suitScores[card.suit] += NORMAL_POINTS[card.rank] + (card.rank === 'J' ? 4 : 0) + (card.rank === '9' ? 2 : 0);
    });
    const bestSuit = SUITS.slice().sort((a, b) => suitScores[b] - suitScores[a])[0] || 'clubs';
    return { action: 'bid', mode: 'suit', suit: bestSuit, points: 80, label: `80 ${SUIT_LABELS[bestSuit]}` };
  }
  function buildCoachRecap(round) {
    return (round.plays || []).filter((play) => play.ai_card && play.card?.id !== play.ai_card?.id).slice(0, 8).map((play) => ({
      player: play.player,
      player_name: play.player_name,
      trick_no: play.trick_no,
      played: play.card,
      ai_card: play.ai_card,
      verdict: cardPoints(play.card, round.bid?.suit) > cardPoints(play.ai_card, round.bid?.suit) ? 'Jij speelde waardevoller dan de simpele AI.' : 'De simpele AI had zuiniger gespeeld.'
    }));
  }
  function detectRoem(cards, trumpSuit) {
    const items = [];
    const byRank = new Map();
    const bySuit = new Map();
    (cards || []).forEach((card) => {
      byRank.set(card.rank, [...(byRank.get(card.rank) || []), card]);
      bySuit.set(card.suit, [...(bySuit.get(card.suit) || []), card]);
    });
    byRank.forEach((group, rank) => {
      if (group.length === 4) items.push({ label: rank === 'J' ? 'Vier boeren' : `Vier ${rank}`, points: rank === 'J' ? 200 : 100 });
    });
    bySuit.forEach((group, suit) => {
      const positions = group.map((card) => ROEM_ORDER.indexOf(card.rank)).filter((n) => n >= 0).sort((a, b) => a - b);
      for (let i = 0; i <= positions.length - 3; i++) {
        if (positions[i + 1] === positions[i] + 1 && positions[i + 2] === positions[i] + 2) {
          const four = positions[i + 3] === positions[i] + 3;
          items.push({ label: `${four ? 'Vierkaart' : 'Driekaart'} ${SUIT_LABELS[suit]}`, points: four ? 50 : 20 });
          break;
        }
      }
      if (suit === trumpSuit && group.some((card) => card.rank === 'K') && group.some((card) => card.rank === 'Q')) {
        items.push({ label: 'Stuk', points: 20 });
      }
    });
    return { points: items.reduce((sum, item) => sum + item.points, 0), items };
  }
  function scoreRound(taken, bidderTeam, bid, roemByTeam) {
    const cardScores = [0, 0];
    const trickCounts = [0, 0];
    (taken || []).forEach((trick) => {
      const teamIndex = TEAM_OF[trick.winner] - 1;
      trickCounts[teamIndex] += 1;
      cardScores[teamIndex] += (trick.cards || []).reduce((sum, play) => sum + cardPoints(play.card, bid?.suit), 0);
    });
    if (taken && taken.length) cardScores[TEAM_OF[taken[taken.length - 1].winner] - 1] += 10;
    const raw = [cardScores[0] + Number(roemByTeam?.[0] || 0), cardScores[1] + Number(roemByTeam?.[1] || 0)];
    const bidderIndex = bidderTeam - 1;
    const defenderIndex = bidderIndex ? 0 : 1;
    const target = isAllPointsBid(bid) ? 162 : Number(bid?.points || 0);
    const allTricks = trickCounts[bidderIndex] === 8;
    const made = isAllPointsBid(bid) ? allTricks : raw[bidderIndex] >= target;
    if (!made) {
      const allRoem = Number(roemByTeam?.[0] || 0) + Number(roemByTeam?.[1] || 0);
      const scores = [0, 0];
      scores[defenderIndex] = 162 + allRoem;
      return { raw, trickCounts, nat: true, scores };
    }
    const scores = raw.slice();
    if (allTricks) scores[bidderIndex] += 100;
    return { raw, trickCounts, nat: false, scores };
  }
  function newClientState(players, dealerIndex, previous, settings) {
    const hands = deal(shuffle(createDeck()), dealerIndex);
    return {
      app_version: global.GEJAST_PAGE_VERSION || cfg().VERSION || 'v686',
      phase: 'bidding',
      deal_nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      settings: settings || previous?.settings || { finish_mode: 'fixed_rounds' },
      dealer: dealerIndex,
      players: players.map((p, i) => ({ seat: i, name: p.name, team: TEAM_OF[i], is_bot: !!p.is_bot, player_type: p.is_bot ? 'bot' : 'human' })),
      hands,
      bidder_turn: (dealerIndex + 1) % 4,
      turn: null,
      passes_since_bid: 0,
      current_bid: null,
      accepted_bid: null,
      trick: [],
      pending_trick: null,
      taken: [],
      roem_by_team: [0, 0],
      totals: (previous?.totals || [0, 0]).slice(),
      rounds: (previous?.rounds || []).slice(),
      action_deadline_at: actionDeadline(),
      action_needed_seat: (dealerIndex + 1) % 4,
      plays: [],
      finished_at: null
    };
  }
  function publicSummary(state, game) {
    const players = state.players || [];
    const winners = state.totals?.[0] === state.totals?.[1] ? [] : (state.totals?.[0] > state.totals?.[1] ? players.filter((p) => p.team === 1) : players.filter((p) => p.team === 2));
    return {
      match_ref: game?.lobby_code || '',
      client_match_id: game?.id || '',
      participants: players.map((p) => p.name),
      winner_names: winners.map((p) => p.name),
      teams: { wij: players.filter((p) => p.team === 1).map((p) => p.name), zij: players.filter((p) => p.team === 2).map((p) => p.name) },
      totals: { wij: state.totals?.[0] || 0, zij: state.totals?.[1] || 0 },
      rounds: state.rounds || [],
      online: true,
      has_bots: hasBots(state),
      finish_mode: gameModeLabel(state.settings),
      action_needed_seat: state.action_needed_seat ?? null,
      action_deadline_at: state.action_deadline_at || null,
      kruip: state.kruip || null,
      coach_recaps: (state.rounds || []).flatMap((r) => r.coach_recap || []).slice(-16),
      live_state: { status: state.finished_at ? 'finished' : state.phase, updated_at: new Date().toISOString(), rounds_played: (state.rounds || []).length },
      finished_at: state.finished_at || null
    };
  }
  function finalJasPayload(state, game) {
    if (hasBots(state)) return null;
    const players = state.players || [];
    const teamTotals = state.totals || [0, 0];
    const winnerTeam = teamTotals[0] === teamTotals[1] ? 0 : (teamTotals[0] > teamTotals[1] ? 1 : 2);
    return {
      title: `Online klaverjas ${game?.lobby_code || ''}`.trim(),
      played_at: new Date().toISOString().slice(0, 10),
      variant: '4_player',
      scoreboard_mode: 'teams',
      source: 'klaverjas_online',
      client_match_id: game?.id || '',
      lobby_code: game?.lobby_code || '',
      participants: players.map((p) => ({
        name: p.name,
        seat_no: p.seat + 1,
        team_no: p.team,
        total_points: teamTotals[p.team - 1] || 0,
        is_winner: winnerTeam === p.team
      })),
      summary: publicSummary(state, game),
      online_stats: {
        kruip: state.kruip || null,
        round_count: (state.rounds || []).length,
        finish_mode: gameModeLabel(state.settings),
        coach_recaps: (state.rounds || []).flatMap((r) => r.coach_recap || []).slice(-16)
      },
      rounds: state.rounds || []
    };
  }
  function viewerSeat(remote) {
    const viewer = remote?.viewer || {};
    return Number.isInteger(viewer.seat) ? viewer.seat : -1;
  }

  global.GEJAST_KLAVERJAS_ONLINE = {
    SUIT_LABELS,
    SUIT_SYMBOLS,
    TEAM_OF,
    sessionToken,
    currentScope,
    rpc,
    createDeck,
    shuffle,
    deal,
    sortHand,
    compareCards,
    currentWinner,
    legalCards,
    cardPoints,
    availableBids,
    isValidBid,
    isAllPointsBid,
    closesBidding,
    bidLabel,
    actionDeadline,
    shouldFinishGame,
    kruipLabel,
    winnerTeam,
    aiChoice,
    buildCoachRecap,
    isBotPlayer,
    hasBots,
    botName,
    botPlayers,
    botBid,
    gameModeLabel,
    detectRoem,
    scoreRound,
    newClientState,
    publicSummary,
    finalJasPayload,
    viewerSeat
  };
})(window);
