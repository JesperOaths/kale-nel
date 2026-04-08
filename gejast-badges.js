(function (global) {
  const ASSET_BASE = './assets/badges';

  function assetPath(pack, key) {
    return `${ASSET_BASE}/${pack}/badge-${key}.png`;
  }

  function miniPath(size, key) {
    return `${ASSET_BASE}/mini-${size}/badge-${key}.png`;
  }

  const BADGE_REGISTRY = [
    {
      key: 'starter',
      legacyLabels: ['Starter'],
      title: 'Starter',
      plaqueTitle: 'Starter',
      nickname: '',
      rarityRank: 1,
      rarityLabel: 'Common',
      pack: 'core',
      description: 'Voor de eerste echte stap op de site.',
      requirementsText: '1 geverifieerde site-actie: een potje, drankje of speedpoging.',
      imageFull: assetPath('core', 'starter'),
      imageMini48: miniPath('48', 'starter'),
      imageMini64: miniPath('64', 'starter')
    },
    {
      key: 'groeier',
      legacyLabels: ['Groeier'],
      title: 'Groeier',
      plaqueTitle: 'Groeier',
      nickname: '',
      rarityRank: 2,
      rarityLabel: 'Common',
      pack: 'core',
      description: 'Voor spelers die duidelijk op gang komen.',
      requirementsText: '5 geverifieerde potjes of 10 geverifieerde drankacties.',
      imageFull: assetPath('core', 'groeier'),
      imageMini48: miniPath('48', 'groeier'),
      imageMini64: miniPath('64', 'groeier')
    },
    {
      key: 'actief',
      legacyLabels: ['Actief'],
      title: 'Actief',
      plaqueTitle: 'Actief',
      nickname: 'De Huisvriend',
      rarityRank: 3,
      rarityLabel: 'Uncommon',
      pack: 'core',
      description: 'Voor spelers die echt onderdeel van het ritme worden.',
      requirementsText: '15 potjes totaal of 25 geverifieerde drankacties.',
      imageFull: assetPath('core', 'actief'),
      imageMini48: miniPath('48', 'actief'),
      imageMini64: miniPath('64', 'actief')
    },
    {
      key: 'gold',
      legacyLabels: ['Gold', 'Gouden Hand'],
      title: 'Gouden Hand',
      plaqueTitle: 'Gouden Hand',
      nickname: 'De Gouden',
      rarityRank: 4,
      rarityLabel: 'Rare',
      pack: 'core',
      description: 'Voor sterke prestaties over een langere periode.',
      requirementsText: 'Minstens 30 potjes totaal en minstens 55% winrate over je beste spel.',
      imageFull: assetPath('core', 'gold'),
      imageMini48: miniPath('48', 'gold'),
      imageMini64: miniPath('64', 'gold')
    },
    {
      key: 'legend',
      legacyLabels: ['Legend', 'Legende'],
      title: 'Legende',
      plaqueTitle: 'Legende',
      nickname: 'De Legende',
      rarityRank: 5,
      rarityLabel: 'Epic',
      pack: 'core',
      description: 'Voor de spelers die structureel boven de rest uitsteken.',
      requirementsText: 'Minstens 60 potjes totaal en minstens 60% winrate over je beste spel.',
      imageFull: assetPath('core', 'legend'),
      imageMini48: miniPath('48', 'legend'),
      imageMini64: miniPath('64', 'legend')
    },
    {
      key: 'klaverkoning',
      legacyLabels: [],
      title: 'Klaverkoning',
      plaqueTitle: 'Klaverkoning',
      nickname: 'De Kaartvorst',
      rarityRank: 6,
      rarityLabel: 'Rare',
      pack: 'core',
      description: 'Voor de echte heerser aan de klaverjastafel.',
      requirementsText: '20 klaverjaszeges.',
      imageFull: assetPath('core', 'klaverkoning'),
      imageMini48: miniPath('48', 'klaverkoning'),
      imageMini64: miniPath('64', 'klaverkoning')
    },
    {
      key: 'bruggenbouwer',
      legacyLabels: [],
      title: 'Bruggenbouwer',
      plaqueTitle: 'Bruggenbouwer',
      nickname: 'De Brugwachter',
      rarityRank: 7,
      rarityLabel: 'Rare',
      pack: 'core',
      description: 'Voor vaste krachten in Boerenbridge.',
      requirementsText: '20 boerenbridge-potjes of 10 boerenbridgezeges.',
      imageFull: assetPath('core', 'bruggenbouwer'),
      imageMini48: miniPath('48', 'bruggenbouwer'),
      imageMini64: miniPath('64', 'bruggenbouwer')
    },
    {
      key: 'snelheidsduivel',
      legacyLabels: [],
      title: 'Snelheidsduivel',
      plaqueTitle: 'Snelheidsduivel',
      nickname: 'De Bliksem',
      rarityRank: 8,
      rarityLabel: 'Rare',
      pack: 'core',
      description: 'Voor spelers die snelheid niet alleen proberen, maar waarmaken.',
      requirementsText: '3 geverifieerde snelheidsrecords onder de drempel van hun drankje.',
      imageFull: assetPath('core', 'snelheidsduivel'),
      imageMini48: miniPath('48', 'snelheidsduivel'),
      imageMini64: miniPath('64', 'snelheidsduivel')
    },
    {
      key: 'ijskoud',
      legacyLabels: [],
      title: 'IJskoud',
      plaqueTitle: 'IJskoud',
      nickname: 'De Vriezer',
      rarityRank: 9,
      rarityLabel: 'Rare',
      pack: 'core',
      description: 'Voor uitzonderlijke kou en snelheid tegelijk.',
      requirementsText: 'Een geverifieerde Ice-tijd onder 25 seconden.',
      imageFull: assetPath('core', 'ijskoud'),
      imageMini48: miniPath('48', 'ijskoud'),
      imageMini64: miniPath('64', 'ijskoud')
    },
    {
      key: 'kurkentrekker',
      legacyLabels: [],
      title: 'Kurkentrekker',
      plaqueTitle: 'Kurkentrekker',
      nickname: 'De Flessentrekker',
      rarityRank: 10,
      rarityLabel: 'Rare',
      pack: 'core',
      description: 'Voor de speler die de wijnkant van de site beheerst.',
      requirementsText: '5 geverifieerde fles-wijn of wijnfles-events.',
      imageFull: assetPath('core', 'kurkentrekker'),
      imageMini48: miniPath('48', 'kurkentrekker'),
      imageMini64: miniPath('64', 'kurkentrekker')
    },
    {
      key: 'verifieermeester',
      legacyLabels: [],
      title: 'Verifieermeester',
      plaqueTitle: 'Verifieermeester',
      nickname: 'De Getuige',
      rarityRank: 11,
      rarityLabel: 'Epic',
      pack: 'core',
      description: 'Voor de betrouwbare controleur die het systeem draaiend houdt.',
      requirementsText: '50 geaccepteerde verificatiestemmen op andermans requests.',
      imageFull: assetPath('core', 'verifieermeester'),
      imageMini48: miniPath('48', 'verifieermeester'),
      imageMini64: miniPath('64', 'verifieermeester')
    },
    {
      key: 'pussycup_prins',
      legacyLabels: [],
      title: 'Pussycup-prins',
      plaqueTitle: 'Pussycup-prins',
      nickname: 'Fluwelen Pols',
      rarityRank: 12,
      rarityLabel: 'Epic',
      pack: 'core',
      description: 'Voor de beerponger met opvallend hoge pussycup-frequentie.',
      requirementsText: 'Minstens 12 beerpongpotjes en pussycup-percentage van minstens 75%.',
      imageFull: assetPath('core', 'pussycup_prins'),
      imageMini48: miniPath('48', 'pussycup_prins'),
      imageMini64: miniPath('64', 'pussycup_prins')
    },
    {
      key: 'onbreekbaar',
      legacyLabels: [],
      title: 'Onbreekbaar',
      plaqueTitle: 'Onbreekbaar',
      nickname: 'De Onbreekbare',
      rarityRank: 13,
      rarityLabel: 'Epic',
      pack: 'core',
      description: 'Voor wie een reeks neerzet die maar niet wil stoppen.',
      requirementsText: '10 geverifieerde overwinningen op rij over alle spellen samen.',
      imageFull: assetPath('core', 'onbreekbaar'),
      imageMini48: miniPath('48', 'onbreekbaar'),
      imageMini64: miniPath('64', 'onbreekbaar')
    },
    {
      key: 'spinozageest',
      legacyLabels: [],
      title: 'Spinoza-geest',
      plaqueTitle: 'Spinoza-geest',
      nickname: 'De Spinozist',
      rarityRank: 14,
      rarityLabel: 'Legendary',
      pack: 'core',
      description: 'Voor allround zwaargewichten die overal opduiken.',
      requirementsText: 'Breed actief: 25 potjes, 20 geverifieerde drankacties, 10 geaccepteerde verificaties en activiteit in minstens 2 spelcategorieen.',
      imageFull: assetPath('core', 'spinozageest'),
      imageMini48: miniPath('48', 'spinozageest'),
      imageMini64: miniPath('64', 'spinozageest')
    },
    {
      key: 'alleskunner',
      legacyLabels: [],
      title: 'Alleskunner',
      plaqueTitle: 'Alleskunner',
      nickname: 'De Veelvraat',
      rarityRank: 15,
      rarityLabel: 'Epic',
      pack: 'expansion',
      description: 'Voor spelers die niet in één speltype te vangen zijn.',
      requirementsText: 'Minstens 10 geregistreerde potjes in klaverjas, boerenbridge en beerpong.',
      imageFull: assetPath('expansion', 'alleskunner'),
      imageMini48: miniPath('48', 'alleskunner'),
      imageMini64: miniPath('64', 'alleskunner')
    },
    {
      key: 'nachtburgemeester',
      legacyLabels: [],
      title: 'Nachtburgemeester',
      plaqueTitle: 'Nachtburgemeester',
      nickname: 'De Nachtwacht',
      rarityRank: 16,
      rarityLabel: 'Epic',
      pack: 'expansion',
      description: 'Voor spelers die juist laat op hun gevaarlijkst zijn.',
      requirementsText: '12 geverifieerde drank- of snelheidsacties tussen 01:00 en 05:00.',
      imageFull: assetPath('expansion', 'nachtburgemeester'),
      imageMini48: miniPath('48', 'nachtburgemeester'),
      imageMini64: miniPath('64', 'nachtburgemeester')
    },
    {
      key: 'dorstmachine',
      legacyLabels: [],
      title: 'Dorstmachine',
      plaqueTitle: 'Dorstmachine',
      nickname: 'De Dorstmotor',
      rarityRank: 17,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor volume, uithoudingsvermogen en pure dorst.',
      requirementsText: '40 geverifieerde drinkunits totaal.',
      imageFull: assetPath('expansion', 'dorstmachine'),
      imageMini48: miniPath('48', 'dorstmachine'),
      imageMini64: miniPath('64', 'dorstmachine')
    },
    {
      key: 'literlegende',
      legacyLabels: [],
      title: 'Literlegende',
      plaqueTitle: 'Literlegende',
      nickname: 'De Tapkraan',
      rarityRank: 18,
      rarityLabel: 'Legendary',
      pack: 'expansion',
      description: 'Voor spelers die op liter-bierniveau absurd snel zijn.',
      requirementsText: '3 geverifieerde liter bier-pogingen onder 90 seconden.',
      imageFull: assetPath('expansion', 'literlegende'),
      imageMini48: miniPath('48', 'literlegende'),
      imageMini64: miniPath('64', 'literlegende')
    },
    {
      key: 'bekerbeul',
      legacyLabels: [],
      title: 'Bekerbeul',
      plaqueTitle: 'Bekerbeul',
      nickname: 'De Pingbeul',
      rarityRank: 19,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor de beerponger die bekers laat verdwijnen.',
      requirementsText: '20 beerpongzeges.',
      imageFull: assetPath('expansion', 'bekerbeul'),
      imageMini48: miniPath('48', 'bekerbeul'),
      imageMini64: miniPath('64', 'bekerbeul')
    },
    {
      key: 'trouwewachter',
      legacyLabels: [],
      title: 'Trouwe Wachter',
      plaqueTitle: 'Trouwe Wachter',
      nickname: 'De Portier',
      rarityRank: 20,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor de waakzame verificator die altijd op tijd is.',
      requirementsText: '20 geaccepteerde verificatiestemmen op requests van anderen.',
      imageFull: assetPath('expansion', 'trouwewachter'),
      imageMini48: miniPath('48', 'trouwewachter'),
      imageMini64: miniPath('64', 'trouwewachter')
    },
    {
      key: 'salonleeuw',
      legacyLabels: [],
      title: 'Salonleeuw',
      plaqueTitle: 'Salonleeuw',
      nickname: 'De Fluwelen Gast',
      rarityRank: 21,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor wie de ballroom niet alleen betreedt, maar beheerst.',
      requirementsText: '10 goedgekeurde ballroom-entrees of 5 keer als koning in de ballroom.',
      imageFull: assetPath('expansion', 'salonleeuw'),
      imageMini48: miniPath('48', 'salonleeuw'),
      imageMini64: miniPath('64', 'salonleeuw')
    },
    {
      key: 'ijzerenmaag',
      legacyLabels: [],
      title: 'IJzeren Maag',
      plaqueTitle: 'IJzeren Maag',
      nickname: 'De Betonmaag',
      rarityRank: 22,
      rarityLabel: 'Epic',
      pack: 'expansion',
      description: 'Voor de speler die zware avonden blijft overleven.',
      requirementsText: '5 geverifieerde avonden met minstens 10 drinkunits.',
      imageFull: assetPath('expansion', 'ijzerenmaag'),
      imageMini48: miniPath('48', 'ijzerenmaag'),
      imageMini64: miniPath('64', 'ijzerenmaag')
    },
    {
      key: 'laatsteronde',
      legacyLabels: [],
      title: 'Laatste Ronde',
      plaqueTitle: 'Laatste Ronde',
      nickname: 'De Nachtdienst',
      rarityRank: 23,
      rarityLabel: 'Legendary',
      pack: 'expansion',
      description: 'Voor de echte nachtspelers die doorgaan waar anderen afhaken.',
      requirementsText: '5 geverifieerde acties na 04:00 in de nacht.',
      imageFull: assetPath('expansion', 'laatsteronde'),
      imageMini48: miniPath('48', 'laatsteronde'),
      imageMini64: miniPath('64', 'laatsteronde')
    },
    {
      key: 'fluwelenvorst',
      legacyLabels: [],
      title: 'Fluwelen Vorst',
      plaqueTitle: 'Fluwelen Vorst',
      nickname: 'De Rode Baron',
      rarityRank: 24,
      rarityLabel: 'Legendary',
      pack: 'prestige',
      description: 'Voor langdurige heerschappij over de ballroom.',
      requirementsText: '10 keer ballroom-koning of 25 goedgekeurde ballroom-entrees.',
      imageFull: assetPath('prestige', 'fluwelenvorst'),
      imageMini48: miniPath('48', 'fluwelenvorst'),
      imageMini64: miniPath('64', 'fluwelenvorst')
    },
    {
      key: 'rozenkoning',
      legacyLabels: [],
      title: 'Rozenkoning',
      plaqueTitle: 'Rozenkoning',
      nickname: 'De Charmeur',
      rarityRank: 25,
      rarityLabel: 'Legendary',
      pack: 'prestige',
      description: 'Voor de speler die speciale avonden naar zich toe trekt.',
      requirementsText: '15 verschillende geverifieerde overwinningen op speciale dagen of avonden met minstens 3 deelnemers.',
      imageFull: assetPath('prestige', 'rozenkoning'),
      imageMini48: miniPath('48', 'rozenkoning'),
      imageMini64: miniPath('64', 'rozenkoning')
    },
    {
      key: 'vuurproef',
      legacyLabels: [],
      title: 'Vuurproef',
      plaqueTitle: 'Vuurproef',
      nickname: 'De Vlam',
      rarityRank: 26,
      rarityLabel: 'Epic',
      pack: 'prestige',
      description: 'Voor spelers die meerdere dagen achter elkaar leveren.',
      requirementsText: '7 geverifieerde snelheids- of drankrecords in 7 opeenvolgende actieve dagen.',
      imageFull: assetPath('prestige', 'vuurproef'),
      imageMini48: miniPath('48', 'vuurproef'),
      imageMini64: miniPath('64', 'vuurproef')
    },
    {
      key: 'sleuteldrager',
      legacyLabels: [],
      title: 'Sleuteldrager',
      plaqueTitle: 'Sleuteldrager',
      nickname: 'De Binnenste Kring',
      rarityRank: 27,
      rarityLabel: 'Epic',
      pack: 'prestige',
      description: 'Voor de speler die overal sporen achterlaat.',
      requirementsText: 'Minstens 100 potjes totaal en activiteit in minstens 4 grote siteonderdelen.',
      imageFull: assetPath('prestige', 'sleuteldrager'),
      imageMini48: miniPath('48', 'sleuteldrager'),
      imageMini64: miniPath('64', 'sleuteldrager')
    },
    {
      key: 'dobbelofniets',
      legacyLabels: [],
      title: 'Dobbel of Niets',
      plaqueTitle: 'Dobbel of Niets',
      nickname: 'De Waaghals',
      rarityRank: 28,
      rarityLabel: 'Rare',
      pack: 'prestige',
      description: 'Voor de speler die terugkomt uit kansarme posities.',
      requirementsText: '12 onverwachte comebacks of 12 geverifieerde overwinningen na achterstand.',
      imageFull: assetPath('prestige', 'dobbelofniets'),
      imageMini48: miniPath('48', 'dobbelofniets'),
      imageMini64: miniPath('64', 'dobbelofniets')
    },
    {
      key: 'kaartopera',
      legacyLabels: [],
      title: 'Kaartopera',
      plaqueTitle: 'Kaartopera',
      nickname: 'De Dirigent',
      rarityRank: 29,
      rarityLabel: 'Epic',
      pack: 'prestige',
      description: 'Voor een speler die kaarten en live-spel elegant samenbrengt.',
      requirementsText: '20 klaverjas- en 20 boerenbridgezeges, plus minstens 5 live spectator-wedstrijden als deelnemer.',
      imageFull: assetPath('prestige', 'kaartopera'),
      imageMini48: miniPath('48', 'kaartopera'),
      imageMini64: miniPath('64', 'kaartopera')
    },
    {
      key: 'avondster',
      legacyLabels: [],
      title: 'Avondster',
      plaqueTitle: 'Avondster',
      nickname: 'De Laatste Gloed',
      rarityRank: 30,
      rarityLabel: 'Mythic',
      pack: 'prestige',
      description: 'Voor de absolute allesdrager van de site.',
      requirementsText: 'Uiterst zeldzaam: 50 potjes, 50 geverifieerde drankacties, 25 geaccepteerde verificaties, minstens 2 speedrecords en activiteit in ballroom en live spectator-games.',
      imageFull: assetPath('prestige', 'avondster'),
      imageMini48: miniPath('48', 'avondster'),
      imageMini64: miniPath('64', 'avondster')
    }
  ];

  const BADGE_REGISTRY_BY_KEY = Object.fromEntries(BADGE_REGISTRY.map((badge) => [badge.key, badge]));
  const BADGE_LEGACY_LABEL_MAP = new Map();

  BADGE_REGISTRY.forEach((badge) => {
    [badge.key, badge.title, badge.plaqueTitle, ...(badge.legacyLabels || [])]
      .filter(Boolean)
      .forEach((label) => BADGE_LEGACY_LABEL_MAP.set(String(label).trim().toLowerCase(), badge.key));
  });

  function normalizeBadgeKey(input) {
    const raw = String(input || '').trim().toLowerCase();
    return BADGE_LEGACY_LABEL_MAP.get(raw) || raw || null;
  }

  function getBadgeByKey(input) {
    const key = normalizeBadgeKey(input);
    return key ? (BADGE_REGISTRY_BY_KEY[key] || null) : null;
  }

  function getBadgeByLegacyLabel(input) {
    return getBadgeByKey(input);
  }

  function sortBadgesByAttainability(badges, direction) {
    const dir = String(direction || 'asc').toLowerCase() === 'desc' ? -1 : 1;
    return (Array.isArray(badges) ? badges : [])
      .slice()
      .sort((a, b) => {
        const rankA = Number(a?.rarityRank || 0);
        const rankB = Number(b?.rarityRank || 0);
        if (rankA !== rankB) return (rankA - rankB) * dir;
        return String(a?.title || '').localeCompare(String(b?.title || ''), 'nl');
      });
  }

  function pickPrimaryBadge(attainedBadges) {
    return sortBadgesByAttainability(attainedBadges, 'desc').find((badge) => String(badge?.nickname || '').trim()) || null;
  }

  function pickPrimaryNickname(attainedBadges) {
    const primary = pickPrimaryBadge(attainedBadges);
    return primary ? primary.nickname : '';
  }

  function resolveAttainedBadges(values) {
    return (Array.isArray(values) ? values : [])
      .map((value) => (typeof value === 'string' ? getBadgeByKey(value) : getBadgeByKey(value?.key || value?.title || value?.legacyLabel)))
      .filter(Boolean);
  }

  function getMiniBadgeRow(attainedBadges, size) {
    const pixelSize = String(size || '64') === '48' ? '48' : '64';
    return resolveAttainedBadges(attainedBadges).map((badge) => ({
      key: badge.key,
      title: badge.title,
      nickname: badge.nickname,
      src: pixelSize === '48' ? badge.imageMini48 : badge.imageMini64
    }));
  }



  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m] || m));
  }

  function toNumber() {
    for (const value of arguments) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function firstNonEmpty() {
    for (const value of arguments) {
      if (value == null) continue;
      const raw = String(value).trim();
      if (raw) return raw;
    }
    return '';
  }

  function normalizePlayerSnapshot(input) {
    const root = input || {};
    const unified = root.unified || {};
    const overview = unified.overview || root.overview || {};
    const games = unified.games || root.games || {};
    const drinks = root.drinksData || root.drinks || {};
    const drinkSummary = drinks.summary || {};
    const badgeFacts = root.badgeFacts || {};
    const profile = root.profile || {};
    const gameInsights = root.gameInsights || {};
    const sharedStats = root.sharedStats || {};
    const recent = toArray(drinks.recent);
    const speedRecords = toArray(drinks.speed_records);
    const favorites = toArray(drinks.top_types);
    const klaverjasSummary = games.klaverjas && games.klaverjas.summary || {};
    const boerenbridgeSummary = games.boerenbridge && games.boerenbridge.summary || {};
    const beerpongSummary = games.beerpong && games.beerpong.summary || {};
    const totalMatches = toNumber(
      root.total_matches,
      overview.total_matches,
      root.games_played,
      profile.total_matches
    );
    const totalWins = toNumber(root.total_wins, overview.total_wins, profile.total_wins);
    const drinkEvents = toNumber(root.drink_events, drinkSummary.events, drinks.events);
    const drinkUnits = toNumber(root.drink_units, drinkSummary.units, drinks.units);
    const verificationVotes = toNumber(
      root.verification_votes_accepted,
      root.verifier_accept_count,
      drinkSummary.verification_votes_accepted,
      drinkSummary.accepted_votes,
      drinks.verification_votes_accepted,
      profile.verification_votes_accepted
    );
    const speedCount = toNumber(
      root.speed_record_count,
      drinks.speed_record_count,
      speedRecords.length
    );
    const iceBestSeconds = toNumber(
      root.ice_best_seconds,
      drinks.ice_best_seconds,
      drinks.speed_best_seconds,
      drinkSummary.ice_best_seconds
    );
    const wineEvents = toNumber(
      root.wine_event_count,
      drinks.wine_event_count,
      favorites.find((row) => /wijn/i.test(String(row?.key || row?.label || '')))?.events,
      favorites.find((row) => /wine/i.test(String(row?.key || row?.label || '')))?.events
    );
    const literSub90Count = toNumber(root.liter_sub90_count, drinks.liter_sub90_count);
    const nightActions = toNumber(root.night_actions_1_5, drinks.night_actions_1_5);
    const afterFourActions = toNumber(root.actions_after_4, drinks.actions_after_4);
    const tenUnitNights = toNumber(root.ten_unit_nights, drinks.ten_unit_nights);
    const activeDayStreak = toNumber(root.active_day_streak, drinks.active_day_streak, sharedStats.active_day_streak);
    const ballroomEntries = toNumber(root.ballroom_entries_approved, profile.ballroom_entries_approved, sharedStats.ballroom_entries_approved);
    const ballroomKingCount = toNumber(root.ballroom_king_count, profile.ballroom_king_count, sharedStats.ballroom_king_count);
    const specialWins = toNumber(root.special_event_wins, profile.special_event_wins, sharedStats.special_event_wins);
    const liveParticipationsTotal = toNumber(root.live_participations_total, badgeFacts.live_participations_total);
    const liveParticipationsKlaverjas = toNumber(root.live_participations_klaverjas, badgeFacts.live_participations_klaverjas);
    const liveParticipationsBoerenbridge = toNumber(root.live_participations_boerenbridge, badgeFacts.live_participations_boerenbridge);
    const totalComebackWins = toNumber(root.total_comeback_wins, badgeFacts.total_comeback_wins);
    const klaverjasComebackWins = toNumber(root.klaverjas_comeback_wins, badgeFacts.klaverjas_comeback_wins);
    const boerenbridgeComebackWins = toNumber(root.boerenbridge_comeback_wins, badgeFacts.boerenbridge_comeback_wins);
    const bestBadge = firstNonEmpty(root.best_badge, overview.best_badge, profile.best_badge);
    const allMatches = {
      klaverjas: toNumber(root.klaverjas_matches, overview.klaverjas_matches, klaverjasSummary.games_played, klaverjasSummary.matches_played),
      boerenbridge: toNumber(root.boerenbridge_matches, overview.boerenbridge_matches, boerenbridgeSummary.games_played, boerenbridgeSummary.matches_played),
      beerpong: toNumber(root.beerpong_matches, overview.beerpong_matches, beerpongSummary.games_played, beerpongSummary.matches_played)
    };
    const allWins = {
      klaverjas: toNumber(root.klaverjas_wins, klaverjasSummary.wins),
      boerenbridge: toNumber(root.boerenbridge_wins, boerenbridgeSummary.wins),
      beerpong: toNumber(root.beerpong_wins, beerpongSummary.wins)
    };
    const winRateByGame = {
      klaverjas: toNumber(root.klaverjas_win_pct, klaverjasSummary.win_pct),
      boerenbridge: toNumber(root.boerenbridge_win_pct, boerenbridgeSummary.win_pct),
      beerpong: toNumber(root.beerpong_win_pct, beerpongSummary.win_pct)
    };
    const bestWinRate = Math.max(winRateByGame.klaverjas || 0, winRateByGame.boerenbridge || 0, winRateByGame.beerpong || 0, toNumber(root.best_win_pct, overview.best_win_pct));
    const activeGameCount = Object.values(allMatches).filter((n) => Number(n) > 0).length;
    const activeSitePartCount = [
      totalMatches > 0,
      drinkEvents > 0,
      verificationVotes > 0,
      ballroomEntries > 0 || ballroomKingCount > 0,
      liveParticipationsTotal > 0
    ].filter(Boolean).length;
    return {
      shownName: firstNonEmpty(root.shownName, unified.player_name, profile.public_display_name, profile.chosen_username, root.player_name),
      originalName: firstNonEmpty(root.originalName, root.player_name, overview.original_player_name, profile.player_name),
      bestBadge,
      totalMatches,
      totalWins,
      bestRating: toNumber(root.best_rating, overview.best_rating, profile.best_rating, profile.elo_rating, 1000),
      bestWinRate,
      klaverjasMatches: allMatches.klaverjas,
      boerenbridgeMatches: allMatches.boerenbridge,
      beerpongMatches: allMatches.beerpong,
      klaverjasWins: allWins.klaverjas,
      boerenbridgeWins: allWins.boerenbridge,
      beerpongWins: allWins.beerpong,
      pussycupPct: toNumber(root.pussycup_pct, beerpongSummary.pussycup_pct, sharedStats.pussycup_pct),
      drinkEvents,
      drinkUnits,
      speedCount,
      iceBestSeconds,
      wineEvents,
      literSub90Count,
      verificationVotes,
      winStreak: toNumber(root.win_streak, sharedStats.win_streak, profile.win_streak),
      nightActions,
      afterFourActions,
      tenUnitNights,
      ballroomEntries,
      ballroomKingCount,
      specialWins,
      activeDayStreak,
      liveParticipationsTotal,
      liveParticipationsKlaverjas,
      liveParticipationsBoerenbridge,
      totalComebackWins,
      klaverjasComebackWins,
      boerenbridgeComebackWins,
      activeGameCount,
      activeSitePartCount
    };
  }

  const BADGE_RULES = {
    starter: (s) => (s.totalMatches + s.drinkEvents + s.speedCount) >= 1,
    groeier: (s) => s.totalMatches >= 5 || s.drinkEvents >= 10,
    actief: (s) => s.totalMatches >= 15 || s.drinkEvents >= 25,
    gold: (s) => s.totalMatches >= 30 && s.bestWinRate >= 55,
    legend: (s) => s.totalMatches >= 60 && s.bestWinRate >= 60,
    klaverkoning: (s) => s.klaverjasWins >= 20,
    bruggenbouwer: (s) => s.boerenbridgeMatches >= 20 || s.boerenbridgeWins >= 10,
    snelheidsduivel: (s) => s.speedCount >= 3,
    ijskoud: (s) => s.iceBestSeconds > 0 && s.iceBestSeconds < 25,
    kurkentrekker: (s) => s.wineEvents >= 5,
    verifieermeester: (s) => s.verificationVotes >= 50,
    pussycup_prins: (s) => s.beerpongMatches >= 12 && s.pussycupPct >= 75,
    onbreekbaar: (s) => s.winStreak >= 10,
    spinozageest: (s) => s.totalMatches >= 25 && s.drinkEvents >= 20 && s.verificationVotes >= 10 && s.activeGameCount >= 2,
    alleskunner: (s) => s.klaverjasMatches >= 10 && s.boerenbridgeMatches >= 10 && s.beerpongMatches >= 10,
    nachtburgemeester: (s) => s.nightActions >= 12,
    dorstmachine: (s) => s.drinkUnits >= 40,
    literlegende: (s) => s.literSub90Count >= 3,
    bekerbeul: (s) => s.beerpongWins >= 20,
    trouwewachter: (s) => s.verificationVotes >= 20,
    salonleeuw: (s) => s.ballroomEntries >= 10 || s.ballroomKingCount >= 5,
    ijzerenmaag: (s) => s.tenUnitNights >= 5,
    laatsteronde: (s) => s.afterFourActions >= 5,
    fluwelenvorst: (s) => s.ballroomKingCount >= 10 || s.ballroomEntries >= 25,
    rozenkoning: (s) => s.specialWins >= 15,
    vuurproef: (s) => s.activeDayStreak >= 7 && (s.speedCount + s.drinkEvents) >= 7,
    sleuteldrager: (s) => s.totalMatches >= 100 && s.activeSitePartCount >= 4,
    dobbelofniets: (s) => s.totalComebackWins >= 12,
    kaartopera: (s) => s.klaverjasWins >= 20 && s.boerenbridgeWins >= 20 && s.liveParticipationsTotal >= 5,
    avondster: (s) => s.totalMatches >= 50 && s.drinkEvents >= 50 && s.verificationVotes >= 25 && s.speedCount >= 2 && s.ballroomEntries > 0 && s.liveParticipationsTotal > 0
  };

  function evaluateBadgeKeys(snapshotInput) {
    const snapshot = normalizePlayerSnapshot(snapshotInput);
    const attained = new Set(resolveAttainedBadges([snapshot.bestBadge]).map((badge) => badge.key));
    BADGE_REGISTRY.forEach((badge) => {
      const fn = BADGE_RULES[badge.key];
      if (!fn) return;
      try {
        if (fn(snapshot)) attained.add(badge.key);
      } catch (_) {}
    });
    return Array.from(attained);
  }

  function evaluateAttainedBadges(snapshotInput) {
    return resolveAttainedBadges(evaluateBadgeKeys(snapshotInput));
  }

  function renderMiniBadgeRow(attainedBadges, options) {
    const opts = options || {};
    const size = String(opts.size || '64') === '48' ? '48' : '64';
    const limit = Number(opts.limit || 0) > 0 ? Number(opts.limit) : 999;
    const badges = sortBadgesByAttainability(resolveAttainedBadges(attainedBadges), 'desc').slice(0, limit);
    if (!badges.length) return '<div class="badge-mini-row badge-mini-row-empty"><span class="badge-mini-fallback">Nog geen badges behaald</span></div>';
    return `<div class="badge-mini-row">${badges.map((badge) => `
      <span class="badge-mini" title="${esc(badge.title)}${badge.nickname ? ' · ' + esc(badge.nickname) : ''}">
        <img src="${esc(size === '48' ? badge.imageMini48 : badge.imageMini64)}" alt="${esc(badge.title)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'badge-mini-broken',textContent:'★'}))">
      </span>`).join('')}</div>`;
  }

  function renderBadgeGallery(attainedBadges) {
    const attained = new Set(resolveAttainedBadges(attainedBadges).map((badge) => badge.key));
    return `<div class="badge-gallery">${BADGE_REGISTRY.map((badge) => {
      const earned = attained.has(badge.key);
      return `<article class="badge-card ${earned ? 'badge-earned' : 'badge-locked'}">
        <div class="badge-card-image-wrap"><img class="badge-card-image" src="${esc(badge.imageFull)}" alt="${esc(badge.title)}" loading="lazy" onerror="this.style.display='none';this.parentNode.insertAdjacentHTML('beforeend','<div class='badge-card-fallback'>${esc(badge.title)}</div>')"></div>
        <div class="badge-card-copy">
          <div class="badge-card-top"><strong>${esc(badge.title)}</strong><span class="rarity-chip">${esc(badge.rarityLabel)}</span></div>
          ${badge.nickname ? `<div class="nickname-line">${esc(badge.nickname)}</div>` : ''}
          <p>${esc(badge.description)}</p>
          <div class="badge-requirement"><strong>Voorwaarde</strong><span>${esc(badge.requirementsText)}</span></div>
          <div class="badge-state">${earned ? 'Behaald' : 'Nog niet behaald'}</div>
        </div>
      </article>`;
    }).join('')}</div>`;
  }



  function getAttained(snapshotInput) {
    return evaluateAttainedBadges(snapshotInput);
  }

  function getRarest(attainedBadges) {
    return sortBadgesByAttainability(resolveAttainedBadges(attainedBadges), 'desc')[0] || null;
  }

  function renderMiniBadges(attainedBadges) {
    return renderMiniBadgeRow(attainedBadges, { size: '48', limit: 8 }).replace(/^<div class="badge-mini-row">|<\/div>$/g, '');
  }

  function renderGallery(attainedBadges) {
    return renderBadgeGallery(attainedBadges);
  }

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('gejast-badge-styles')) return;
    const style = document.createElement('style');
    style.id = 'gejast-badge-styles';
    style.textContent = `
      .original-name{margin-top:8px;color:#6b6257;font-size:14px;font-weight:700}
      .nickname-line{margin-top:6px;color:#8a7a55;font-size:14px;font-weight:800}
      .badge-mini-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .badge-mini{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:14px;background:#fff7e4;border:1px solid rgba(17,17,17,.08);padding:4px;box-shadow:0 8px 18px rgba(0,0,0,.06)}
      .badge-mini img{width:100%;height:100%;object-fit:contain}
      .badge-mini-broken,.badge-mini-fallback{display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:40px;padding:0 10px;border-radius:14px;background:#fff7e4;border:1px solid rgba(17,17,17,.08);font-size:13px;font-weight:800;color:#8a6d1f}
      .badge-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
      .badge-card{display:grid;gap:12px;padding:16px;border-radius:22px;background:#fff;border:1px solid rgba(17,17,17,.08)}
      .badge-earned{background:linear-gradient(180deg,#fffaf0,#f6edd1);border-color:rgba(154,130,65,.35)}
      .badge-locked{opacity:.82}
      .badge-card-image-wrap{display:flex;align-items:center;justify-content:center;min-height:130px;border-radius:18px;background:#fbfaf6;border:1px solid rgba(17,17,17,.06);padding:10px}
      .badge-card-image{max-width:100%;max-height:120px;object-fit:contain}
      .badge-card-fallback{font-weight:800;color:#8a7a55;text-align:center}
      .badge-card-copy{display:grid;gap:8px}
      .badge-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .badge-card-top strong{font-size:16px}
      .rarity-chip{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;background:rgba(212,175,55,.18);font-size:11px;font-weight:800;color:#5d4820;text-transform:uppercase;letter-spacing:.05em}
      .badge-card-copy p{margin:0;color:#5f574e;font-size:13px;line-height:1.45}
      .badge-requirement{display:grid;gap:3px;font-size:12px;color:#6b6257}
      .badge-requirement strong,.badge-state{font-size:12px;font-weight:800;color:#3d3429}
      .profile-badge-summary{display:grid;gap:8px}
      .profile-badge-count{font-size:12px;color:#6b6257}
      .public-profile-link{display:inline-flex;padding:10px 14px;border-radius:999px;background:#fff;border:1px solid rgba(17,17,17,.08);text-decoration:none;color:#201b16;font-weight:800}
    `;
    document.head.appendChild(style);
  }

  const api = {
    BADGE_REGISTRY,
    BADGE_REGISTRY_BY_KEY,
    BADGE_LEGACY_LABEL_MAP,
    normalizeBadgeKey,
    getBadgeByKey,
    getBadgeByLegacyLabel,
    sortBadgesByAttainability,
    resolveAttainedBadges,
    pickPrimaryBadge,
    pickPrimaryNickname,
    getMiniBadgeRow,
    esc,
    normalizePlayerSnapshot,
    evaluateBadgeKeys,
    evaluateAttainedBadges,
    renderMiniBadgeRow,
    renderBadgeGallery,
    injectStyles,
    getAttained,
    getRarest,
    renderMiniBadges,
    renderGallery
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  global.GEJAST_BADGES = api;
})(typeof window !== 'undefined' ? window : globalThis);
