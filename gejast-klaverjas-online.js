(function (global) {
  const SUITS = ['clubs', 'spades', 'hearts', 'diamonds'];
  const DISPLAY_SUITS = ['hearts', 'spades', 'diamonds', 'clubs'];
  const SUIT_LABELS = { clubs: 'Klaver', spades: 'Schoppen', hearts: 'Harten', diamonds: 'Ruiten', sans: 'Sans' };
  const SUIT_SYMBOLS = { clubs: '♣', spades: '♠', hearts: '♥', diamonds: '♦', sans: 'SA' };
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
    return sortHandForBid(hand, null);
  }
  function sortHandForBid(hand, trumpSuit) {
    const suitIndex = Object.fromEntries(DISPLAY_SUITS.map((suit, index) => [suit, index]));
    const normalIndex = Object.fromEntries(NORMAL_ORDER.map((rank, index) => [rank, index]));
    const trumpIndex = Object.fromEntries(TRUMP_ORDER.map((rank, index) => [rank, index]));
    return (hand || []).slice().sort((a, b) => {
      const aTrump = trumpSuit && trumpSuit !== 'sans' && a.suit === trumpSuit;
      const bTrump = trumpSuit && trumpSuit !== 'sans' && b.suit === trumpSuit;
      if (aTrump !== bTrump) return aTrump ? -1 : 1;
      if (a.suit !== b.suit) return (suitIndex[a.suit] ?? 99) - (suitIndex[b.suit] ?? 99);
      const order = aTrump ? trumpIndex : normalIndex;
      return (order[a.rank] ?? 99) - (order[b.rank] ?? 99);
    });
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
  function nextDealer(dealer) {
    return (Number(dealer || 0) + 1) % 4;
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
    return bidTarget(bid) + (bid.mode === 'sans' ? 0.1 : 0);
  }
  function isAllPointsBid(bid) {
    return !!bid && (['pit', 'mars', 'doormars'].includes(bid.kind) || (bid.mode === 'sans' && Number(bid.points) === 132));
  }
  function closesBidding(bid) {
    return isAllPointsBid(bid);
  }
  function bidTarget(bid) {
    if (!bid || bid.action === 'pass') return 0;
    if (isAllPointsBid(bid)) return 162;
    if (bid.mode === 'suit') return Math.max(82, Number(bid.points || 0));
    return Number(bid.points || 0);
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
    const displayOrder = ['hearts', 'spades', 'diamonds', 'clubs'];
    for (let points = 80; points <= 160; points += 10) {
      displayOrder.forEach((suit) => {
        const bid = { action: 'bid', mode: 'suit', suit, points };
        if (isValidBid(bid, currentBid)) out.push({ ...bid, label: `${points} ${SUIT_LABELS[suit]}${points === 80 ? ' (halen 82)' : ''}` });
      });
    }
    return out;
  }
  function bidLabel(bid) {
    if (!bid) return 'Geen bod';
    if (bid.action === 'pass') return 'Pas';
    if (isAllPointsBid(bid)) return `${bid.points || 132} ${bid.mode === 'sans' ? 'sans' : (SUIT_LABELS[bid.suit] || '')} ${bid.kind || 'pit'}`.trim();
    return bid.mode === 'sans' ? `${bid.points} sans` : `${bid.points} ${SUIT_LABELS[bid.suit]}${Number(bid.points) === 80 ? ' (82)' : ''}`;
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
    if (lose <= win / 2) return 'naakt_kruipen';
    if (win >= total * (2 / 3)) return 'kruipen';
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
  function seenCards(state) {
    const out = [];
    (state?.taken || []).forEach((trick) => (trick.cards || []).forEach((play) => out.push(play.card)));
    (state?.pending_trick?.cards || []).forEach((play) => out.push(play.card));
    (state?.trick || []).forEach((play) => out.push(play.card));
    return out;
  }
  function remainingCards(state, myHand) {
    const seen = new Set([...seenCards(state), ...(myHand || [])].map((card) => card.id));
    return createDeck().filter((card) => !seen.has(card.id));
  }
  function roemThreat(card, hand, trumpSuit) {
    if (!card) return 0;
    const sameSuit = (hand || []).filter((c) => c.suit === card.suit).map((c) => c.rank);
    const positions = sameSuit.map((r) => ROEM_ORDER.indexOf(r)).filter((n) => n >= 0);
    const pos = ROEM_ORDER.indexOf(card.rank);
    let threat = 0;
    if (pos >= 0) {
      const without = positions.filter((n) => n !== pos);
      for (let start = Math.max(0, pos - 2); start <= pos; start++) {
        if ([start, start + 1, start + 2].every((n) => n >= 0 && n < ROEM_ORDER.length && without.includes(n))) threat += 16;
        if ([start, start + 1, start + 2, start + 3].every((n) => n >= 0 && n < ROEM_ORDER.length && without.includes(n))) threat += 24;
      }
    }
    const hasK = sameSuit.includes('K');
    const hasQ = sameSuit.includes('Q');
    if (card.suit === trumpSuit && ((card.rank === 'K' && hasQ) || (card.rank === 'Q' && hasK))) threat += 18;
    return threat;
  }
  function willWin(card, trick, playerIndex, trumpSuit) {
    const next = [...(trick || []), { player: playerIndex, card }];
    if (!next.length) return false;
    return currentWinner(next, trumpSuit)?.player === playerIndex;
  }
  function aiCardScore(card, hand, trick, playerIndex, trumpSuit, state) {
    const legal = legalCards(hand || [], trick || [], playerIndex, trumpSuit);
    const team = TEAM_OF[playerIndex];
    const value = cardPoints(card, trumpSuit);
    let score = 0;
    const nextTrick = [...(trick || []), { player: playerIndex, card }];
    const currentWin = currentWinner(nextTrick, trumpSuit);
    const isWinning = currentWin && currentWin.player === playerIndex;
    const tablePoints = nextTrick.reduce((sum, play) => sum + cardPoints(play.card, trumpSuit), 0);
    const partnerWinning = currentWin && TEAM_OF[currentWin.player] === team;
    const rem = remainingCards(state, hand);
    const higherRemainingSameSuit = rem.filter((other) => other.suit === card.suit && compareCards(other, card, card.suit, trumpSuit) > 0).length;
    const canBeCaught = higherRemainingSameSuit > 0;

    if (!trick || !trick.length) {
      score += value * 0.8;
      score -= roemThreat(card, hand, trumpSuit) * 1.7;
      if (card.suit === trumpSuit) score -= 10;
      if (!canBeCaught) score += 7;
    } else if (nextTrick.length === 4) {
      score += isWinning ? tablePoints + 18 : -value;
      score -= roemThreat(card, hand, trumpSuit) * 1.4;
    } else {
      if (isWinning) score += tablePoints + 8;
      if (partnerWinning && !isWinning) score -= value * 0.65;
      if (!partnerWinning && !isWinning) score -= value * 0.25;
      score -= roemThreat(card, hand, trumpSuit) * 1.5;
    }
    if (card.suit === trumpSuit && ['J', '9'].includes(card.rank) && !isWinning) score -= 24;
    return score;
  }
  function aiChoice(hand, trick, playerIndex, trumpSuit, state) {
    const legal = legalCards(hand || [], trick || [], playerIndex, trumpSuit);
    if (!legal.length) return null;
    return legal.slice().sort((a, b) => aiCardScore(b, hand, trick, playerIndex, trumpSuit, state) - aiCardScore(a, hand, trick, playerIndex, trumpSuit, state))[0];
  }
  function cardDelta(played, aiCard, trumpSuit) {
    if (!played || !aiCard) return 0;
    return cardPoints(played, trumpSuit) - cardPoints(aiCard, trumpSuit);
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
  function estimateSuitStrength(hand, suit) {
    return (hand || []).filter((card) => card.suit === suit).reduce((sum, card) => {
      const trumpBonus = card.rank === 'J' ? 14 : (card.rank === '9' ? 10 : 0);
      return sum + NORMAL_POINTS[card.rank] + trumpBonus;
    }, 0);
  }
  function estimateHandRoem(hand, trumpSuit) {
    const det = detectRoem(hand || [], trumpSuit);
    return Number(det.points || 0);
  }
  function botBid(state, seat) {
    if (state.current_bid) return { action: 'pass', label: 'Pas' };
    const hand = state.hands?.[seat] || [];
    const suitScores = Object.fromEntries(SUITS.map((suit) => [suit, estimateSuitStrength(hand, suit) + estimateHandRoem(hand, suit) * 0.25]));
    const bestSuit = ['hearts', 'spades', 'diamonds', 'clubs'].slice().sort((a, b) => suitScores[b] - suitScores[a])[0] || 'clubs';
    const best = suitScores[bestSuit] || 0;
    if (best >= 34) return { action: 'bid', mode: 'suit', suit: bestSuit, points: 90, label: `90 ${SUIT_LABELS[bestSuit]}` };
    if (best >= 24) return { action: 'bid', mode: 'suit', suit: bestSuit, points: 80, label: `80 ${SUIT_LABELS[bestSuit]} (halen 82)` };
    return { action: 'pass', label: 'Pas' };
  }
  function buildCoachRecap(round) {
    return (round.plays || []).filter((play) => play.ai_card && play.card?.id !== play.ai_card?.id).slice(0, 12).map((play) => {
      const delta = cardDelta(play.card, play.ai_card, round.bid?.suit);
      return {
        player: play.player,
        player_name: play.player_name,
        trick_no: play.trick_no,
        played: play.card,
        ai_card: play.ai_card,
        delta,
        verdict: delta >= 0 ? 'Jij speelde minstens even waardevol als de AI-keuze.' : 'De AI had waardevoller of veiliger gespeeld.'
      };
    });
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
    const bidderIndex = bidderTeam - 1;
    const defenderIndex = bidderIndex ? 0 : 1;
    const target = bidTarget(bid);
    const allTricks = trickCounts[bidderIndex] === 8;
    const made = isAllPointsBid(bid) ? allTricks : cardScores[bidderIndex] >= target;
    const allRoem = Number(roemByTeam?.[0] || 0) + Number(roemByTeam?.[1] || 0);
    if (!made) {
      const scores = [0, 0];
      scores[defenderIndex] = 162 + allRoem;
      return { cardScores, raw: [cardScores[0] + Number(roemByTeam?.[0] || 0), cardScores[1] + Number(roemByTeam?.[1] || 0)], trickCounts, nat: true, scores, target, made: false };
    }
    const scores = [cardScores[0] + Number(roemByTeam?.[0] || 0), cardScores[1] + Number(roemByTeam?.[1] || 0)];
    if (allTricks) scores[bidderIndex] += 100;
    return { cardScores, raw: scores.slice(), trickCounts, nat: false, scores, target, made: true };
  }
  function newClientState(players, dealerIndex, previous, settings) {
    const hands = deal(shuffle(createDeck()), dealerIndex);
    return {
      app_version: global.GEJAST_PAGE_VERSION || cfg().VERSION || 'v749',
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
      last_trick: previous?.last_trick || null,
      taken: [],
      roem_by_team: [0, 0],
      totals: (previous?.totals || [0, 0]).slice(),
      rounds: (previous?.rounds || []).slice(),
      action_deadline_at: actionDeadline(),
      action_needed_seat: (dealerIndex + 1) % 4,
      plays: [],
      progress_tick: Number(previous?.progress_tick || 0),
      redeal_count: Number(previous?.redeal_count || 0),
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
    sortHandForBid,
    compareCards,
    currentWinner,
    legalCards,
    cardPoints,
    cardDelta,
    availableBids,
    isValidBid,
    isAllPointsBid,
    closesBidding,
    bidLabel,
    bidTarget,
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
    nextDealer,
    newClientState,
    publicSummary,
    finalJasPayload,
    viewerSeat
  };
})(window);
