(function (global) {
  const ASSET_BASE = './assets/badges';
  const BADGE_ASSET_VERSION = (global.GEJAST_CONFIG && global.GEJAST_CONFIG.VERSION) ? `?${global.GEJAST_CONFIG.VERSION}` : '';

  function assetPath(pack, key) {
    return `${ASSET_BASE}/${pack}/badge-${key}.png${BADGE_ASSET_VERSION}`;
  }

  function miniPath(size, key) {
    return `${ASSET_BASE}/mini-${size}/badge-${key}.png${BADGE_ASSET_VERSION}`;
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
      requirementsText: '3 geverifieerde snelheidsrecords: een tijd die je in de top 5 van dat dranktype zet (bij gelijke tijd blijft de eerdere plek).',
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
      rarityLabel: 'Rare',
      pack: 'core',
      description: 'Voor de betrouwbare controleur die het systeem draaiend houdt.',
      requirementsText: '20 geaccepteerde verificatiestemmen op andermans requests.',
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
      rarityLabel: 'Rare',
      pack: 'core',
      description: 'Voor de beerponger met opvallend hoge pussycup-frequentie.',
      requirementsText: 'Minstens 10 beerpongpotjes en pussycup-percentage van minstens 25%.',
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
      requirementsText: 'Minstens 10 geregistreerde potjes in 3 verschillende spellen (klaverjas, boerenbridge, beerpong, paardenrace, pikken).',
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
      key: 'pikken',
      legacyLabels: [],
      title: 'Pikmeester',
      plaqueTitle: 'Pikmeester',
      nickname: 'De Dobbelbaas',
      rarityRank: 19,
      rarityLabel: 'Uncommon',
      pack: 'expansion',
      description: 'Voor wie de dobbelstenen van Pikken naar z\'n hand zet.',
      requirementsText: '10 pikkenpotjes of 5 pikkenzeges.',
      imageFull: assetPath('expansion', 'pikken'),
      imageMini48: miniPath('48', 'pikken'),
      imageMini64: miniPath('64', 'pikken')
    },
    {
      key: 'paardenrace',
      legacyLabels: [],
      title: 'Derbykoning',
      plaqueTitle: 'Derbykoning',
      nickname: 'De Stalmeester',
      rarityRank: 20,
      rarityLabel: 'Uncommon',
      pack: 'expansion',
      description: 'Voor wie Paardenrace niet speelt, maar domineert.',
      requirementsText: '10 paardenracepotjes of 5 paardenracezeges.',
      imageFull: assetPath('expansion', 'paardenrace'),
      imageMini48: miniPath('48', 'paardenrace'),
      imageMini64: miniPath('64', 'paardenrace')
    },
    {
      key: 'bekerbeul',
      legacyLabels: [],
      title: 'Bekerbeul',
      plaqueTitle: 'Bekerbeul',
      nickname: 'De Pingbeul',
      rarityRank: 21,
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
      rarityRank: 22,
      rarityLabel: 'Uncommon',
      pack: 'expansion',
      description: 'Voor de waakzame verificator die altijd op tijd is.',
      requirementsText: '10 geaccepteerde verificatiestemmen op requests van anderen.',
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
      rarityRank: 23,
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
      rarityRank: 24,
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
      rarityRank: 25,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor de echte nachtspelers die doorgaan waar anderen afhaken.',
      requirementsText: '5 geverifieerde drank- of snelheidsacties tussen 01:00 en 05:00.',
      imageFull: assetPath('expansion', 'laatsteronde'),
      imageMini48: miniPath('48', 'laatsteronde'),
      imageMini64: miniPath('64', 'laatsteronde')
    },
    {
      key: 'pikken_eersteprik',
      legacyLabels: [],
      title: 'Eerste Prik',
      plaqueTitle: 'Eerste Prik',
      nickname: 'De Opener',
      rarityRank: 26,
      rarityLabel: 'Common',
      pack: 'expansion',
      description: 'Voor wie Pikken voor het eerst echt aanraakt.',
      requirementsText: '1 pikkenpotje.',
      imageFull: assetPath('expansion', 'pikken_eersteprik'),
      imageMini48: miniPath('48', 'pikken_eersteprik'),
      imageMini64: miniPath('64', 'pikken_eersteprik')
    },
    {
      key: 'paardenrace_startschot',
      legacyLabels: [],
      title: 'Startschot',
      plaqueTitle: 'Startschot',
      nickname: 'De Starter',
      rarityRank: 27,
      rarityLabel: 'Common',
      pack: 'expansion',
      description: 'Voor de eerste stap op de baan.',
      requirementsText: '1 paardenracepotje.',
      imageFull: assetPath('expansion', 'paardenrace_startschot'),
      imageMini48: miniPath('48', 'paardenrace_startschot'),
      imageMini64: miniPath('64', 'paardenrace_startschot')
    },
    {
      key: 'pikken_zesjesregen',
      legacyLabels: [],
      title: 'Zesjesregen',
      plaqueTitle: 'Zesjesregen',
      nickname: 'De Geluksvogel',
      rarityRank: 28,
      rarityLabel: 'Common',
      pack: 'expansion',
      description: 'Voor wie de zessen blijven vallen.',
      requirementsText: '6 pikkenpotjes.',
      imageFull: assetPath('expansion', 'pikken_zesjesregen'),
      imageMini48: miniPath('48', 'pikken_zesjesregen'),
      imageMini64: miniPath('64', 'pikken_zesjesregen')
    },
    {
      key: 'paardenrace_hoefijzerheld',
      legacyLabels: [],
      title: 'Hoefijzerheld',
      plaqueTitle: 'Hoefijzerheld',
      nickname: 'De Hoefheld',
      rarityRank: 29,
      rarityLabel: 'Uncommon',
      pack: 'expansion',
      description: 'Voor wie met geluk en lef over de baan dendert.',
      requirementsText: '1 paardenracezege.',
      imageFull: assetPath('expansion', 'paardenrace_hoefijzerheld'),
      imageMini48: miniPath('48', 'paardenrace_hoefijzerheld'),
      imageMini64: miniPath('64', 'paardenrace_hoefijzerheld')
    },
    {
      key: 'pikken_dubbelzes',
      legacyLabels: [],
      title: 'Dubbel Zes',
      plaqueTitle: 'Dubbel Zes',
      nickname: 'De Kansmachine',
      rarityRank: 30,
      rarityLabel: 'Uncommon',
      pack: 'expansion',
      description: 'Voor wie kans in klasse verandert.',
      requirementsText: 'Minstens 10 pikkenpotjes en minstens 25% winrate in Pikken.',
      imageFull: assetPath('expansion', 'pikken_dubbelzes'),
      imageMini48: miniPath('48', 'pikken_dubbelzes'),
      imageMini64: miniPath('64', 'pikken_dubbelzes')
    },
    {
      key: 'paardenrace_fotofinish',
      legacyLabels: [],
      title: 'Fotofinish',
      plaqueTitle: 'Fotofinish',
      nickname: 'De Nek-aan-nek',
      rarityRank: 31,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor wie wint op een neuslengte.',
      requirementsText: '2 fotofinish-zeges in Paardenrace.',
      imageFull: assetPath('expansion', 'paardenrace_fotofinish'),
      imageMini48: miniPath('48', 'paardenrace_fotofinish'),
      imageMini64: miniPath('64', 'paardenrace_fotofinish')
    },
    {
      key: 'pikken_waaghalspas',
      legacyLabels: [],
      title: 'Waaghalspas',
      plaqueTitle: 'Waaghalspas',
      nickname: 'De All-in',
      rarityRank: 32,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor spelers die blijven durven, ook als het schuurt.',
      requirementsText: '25 pikkenpotjes.',
      imageFull: assetPath('expansion', 'pikken_waaghalspas'),
      imageMini48: miniPath('48', 'pikken_waaghalspas'),
      imageMini64: miniPath('64', 'pikken_waaghalspas')
    },
    {
      key: 'paardenrace_snelheidspaard',
      legacyLabels: [],
      title: 'Snelheidspaard',
      plaqueTitle: 'Snelheidspaard',
      nickname: 'De Sprinter',
      rarityRank: 33,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor wie twee keer achter elkaar de finish pakt.',
      requirementsText: '2 paardenracezeges op rij.',
      imageFull: assetPath('expansion', 'paardenrace_snelheidspaard'),
      imageMini48: miniPath('48', 'paardenrace_snelheidspaard'),
      imageMini64: miniPath('64', 'paardenrace_snelheidspaard')
    },
    {
      key: 'pikken_prikoprij',
      legacyLabels: [],
      title: 'Prik op Rij',
      plaqueTitle: 'Prik op Rij',
      nickname: 'De Reeks',
      rarityRank: 34,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor wie de reeks bewaakt en niet knippert.',
      requirementsText: '3 pikkenzeges op rij.',
      imageFull: assetPath('expansion', 'pikken_prikoprij'),
      imageMini48: miniPath('48', 'pikken_prikoprij'),
      imageMini64: miniPath('64', 'pikken_prikoprij')
    },
    {
      key: 'paardenrace_jockeyjubileum',
      legacyLabels: [],
      title: 'Jockeyjubileum',
      plaqueTitle: 'Jockeyjubileum',
      nickname: 'De Ruiter',
      rarityRank: 35,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor trouw aan het zadel en de baan.',
      requirementsText: '25 paardenracepotjes.',
      imageFull: assetPath('expansion', 'paardenrace_jockeyjubileum'),
      imageMini48: miniPath('48', 'paardenrace_jockeyjubileum'),
      imageMini64: miniPath('64', 'paardenrace_jockeyjubileum')
    },
    {
      key: 'pikken_dobbelbaron',
      legacyLabels: [],
      title: 'Pechbaron',
      plaqueTitle: 'Pechbaron',
      nickname: 'De Dobbelvloek',
      rarityRank: 36,
      rarityLabel: 'Uncommon',
      pack: 'expansion',
      description: 'Voor wie blijft gooien terwijl de dobbelsteen hem telkens verraadt.',
      requirementsText: '10 pikkenverliezen.',
      imageFull: assetPath('expansion', 'pikken_dobbelbaron'),
      imageMini48: miniPath('48', 'pikken_dobbelbaron'),
      imageMini64: miniPath('64', 'pikken_dobbelbaron')
    },
    {
      key: 'paardenrace_baanbaas',
      legacyLabels: [],
      title: 'Modderhapper',
      plaqueTitle: 'Modderhapper',
      nickname: 'De Moddervreter',
      rarityRank: 37,
      rarityLabel: 'Uncommon',
      pack: 'expansion',
      description: 'Voor wie achteraan eindigt, maar altijd weer de baan op stapt.',
      requirementsText: '10 paardenraceverliezen.',
      imageFull: assetPath('expansion', 'paardenrace_baanbaas'),
      imageMini48: miniPath('48', 'paardenrace_baanbaas'),
      imageMini64: miniPath('64', 'paardenrace_baanbaas')
    },
    {
      key: 'paardenrace_stalfluisteraar',
      legacyLabels: [],
      title: 'Stalfluisteraar',
      plaqueTitle: 'Stalfluisteraar',
      nickname: 'De Fluisteraar',
      rarityRank: 38,
      rarityLabel: 'Epic',
      pack: 'expansion',
      description: 'Voor wie de paarden leest alsof ze praten.',
      requirementsText: 'Minstens 10 paardenracepotjes en minstens 30% winrate in Paardenrace.',
      imageFull: assetPath('expansion', 'paardenrace_stalfluisteraar'),
      imageMini48: miniPath('48', 'paardenrace_stalfluisteraar'),
      imageMini64: miniPath('64', 'paardenrace_stalfluisteraar')
    },
    {
      key: 'rad',
      legacyLabels: [],
      title: 'Rad-draaier',
      plaqueTitle: 'Rad-draaier',
      nickname: 'De Spinner',
      rarityRank: 39,
      rarityLabel: 'Common',
      pack: 'expansion',
      description: 'Voor wie het Rad niet vreest, maar draait.',
      requirementsText: '1 draai aan het Rad.',
      imageFull: assetPath('expansion', 'rad'),
      imageMini48: miniPath('48', 'rad'),
      imageMini64: miniPath('64', 'rad')
    },
    {
      key: 'rad_draaikoorts',
      legacyLabels: [],
      title: 'Draaikoorts',
      plaqueTitle: 'Draaikoorts',
      nickname: 'De Tollende',
      rarityRank: 40,
      rarityLabel: 'Uncommon',
      pack: 'expansion',
      description: 'Voor wie elke uitkomst nog een keer wil zien.',
      requirementsText: '10 draaien aan het Rad.',
      imageFull: assetPath('expansion', 'rad_draaikoorts'),
      imageMini48: miniPath('48', 'rad_draaikoorts'),
      imageMini64: miniPath('64', 'rad_draaikoorts')
    },
    {
      key: 'rad_katerkompas',
      legacyLabels: [],
      title: 'Katerkompas',
      plaqueTitle: 'Katerkompas',
      nickname: 'De Wankele',
      rarityRank: 41,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor wie het Rad consequent de verkeerde kant op wijst.',
      requirementsText: 'Minstens 8 draaien en minstens 12 Rad-drinkunits.',
      imageFull: assetPath('expansion', 'rad_katerkompas'),
      imageMini48: miniPath('48', 'rad_katerkompas'),
      imageMini64: miniPath('64', 'rad_katerkompas')
    },
    {
      key: 'despimarkt',
      legacyLabels: [],
      title: 'Caute-koopman',
      plaqueTitle: 'Caute-koopman',
      nickname: 'De Handelaar',
      rarityRank: 42,
      rarityLabel: 'Uncommon',
      pack: 'expansion',
      description: 'Voor wie de Beurs d\'Espinoza binnenstapt.',
      requirementsText: '1 Despimarkt-bet of 1 aangemaakte markt.',
      imageFull: assetPath('expansion', 'despimarkt'),
      imageMini48: miniPath('48', 'despimarkt'),
      imageMini64: miniPath('64', 'despimarkt')
    },
    {
      key: 'despimarkt_marktmeester',
      legacyLabels: [],
      title: 'Marktmeester',
      plaqueTitle: 'Marktmeester',
      nickname: 'De Koerszetter',
      rarityRank: 43,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor wie de beurs niet alleen bespeelt, maar ook zelf opent.',
      requirementsText: '3 markten aangemaakt in Beurs d\'Espinoza.',
      imageFull: assetPath('expansion', 'despimarkt_marktmeester'),
      imageMini48: miniPath('48', 'despimarkt_marktmeester'),
      imageMini64: miniPath('64', 'despimarkt_marktmeester')
    },
    {
      key: 'despimarkt_orakel',
      legacyLabels: [],
      title: 'Beursorakel',
      plaqueTitle: 'Beursorakel',
      nickname: 'De Kristalkijker',
      rarityRank: 44,
      rarityLabel: 'Epic',
      pack: 'expansion',
      description: 'Voor wie de markt leest alsof de uitslag al in de bol staat.',
      requirementsText: 'Minstens 10 bets en minstens +250 cautes netto winst.',
      imageFull: assetPath('expansion', 'despimarkt_orakel'),
      imageMini48: miniPath('48', 'despimarkt_orakel'),
      imageMini64: miniPath('64', 'despimarkt_orakel')
    },
    {
      key: 'tribuneheld',
      legacyLabels: [],
      title: 'Tribuneheld',
      plaqueTitle: 'Tribuneheld',
      nickname: 'De Supporter',
      rarityRank: 45,
      rarityLabel: 'Common',
      pack: 'expansion',
      description: 'Voor wie live speelt en publiek heeft.',
      requirementsText: '1 live spectator-wedstrijd als deelnemer.',
      imageFull: assetPath('expansion', 'tribuneheld'),
      imageMini48: miniPath('48', 'tribuneheld'),
      imageMini64: miniPath('64', 'tribuneheld')
    },
    {
      key: 'terugvechter',
      legacyLabels: [],
      title: 'Terugvechter',
      plaqueTitle: 'Terugvechter',
      nickname: 'De Stugge',
      rarityRank: 46,
      rarityLabel: 'Uncommon',
      pack: 'expansion',
      description: 'Voor wie pas begint als het misgaat.',
      requirementsText: '3 comebackzeges.',
      imageFull: assetPath('expansion', 'terugvechter'),
      imageMini48: miniPath('48', 'terugvechter'),
      imageMini64: miniPath('64', 'terugvechter')
    },
    {
      key: 'sprintverzamelaar',
      legacyLabels: [],
      title: 'Sprintverzamelaar',
      plaqueTitle: 'Sprintverzamelaar',
      nickname: 'De Stopwatch',
      rarityRank: 48,
      rarityLabel: 'Uncommon',
      pack: 'expansion',
      description: 'Voor wie de leaderboard als stickerboek ziet.',
      requirementsText: 'Snelheidsrecord (top 5) voor minstens 3 verschillende drankjes.',
      imageFull: assetPath('expansion', 'sprintverzamelaar'),
      imageMini48: miniPath('48', 'sprintverzamelaar'),
      imageMini64: miniPath('64', 'sprintverzamelaar')
    },
    {
      key: 'tafeltoerist',
      legacyLabels: [],
      title: 'Tafeltoerist',
      plaqueTitle: 'Tafeltoerist',
      nickname: 'De Proever',
      rarityRank: 50,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor wie elke tafel even bezoekt.',
      requirementsText: 'Speel minstens 1 potje in elk spel: klaverjas, boerenbridge, beerpong, paardenrace en pikken.',
      imageFull: assetPath('expansion', 'tafeltoerist'),
      imageMini48: miniPath('48', 'tafeltoerist'),
      imageMini64: miniPath('64', 'tafeltoerist')
    },
    {
      key: 'sporenzoeker',
      legacyLabels: [],
      title: 'Sporenzoeker',
      plaqueTitle: 'Sporenzoeker',
      nickname: 'De Rondleider',
      rarityRank: 51,
      rarityLabel: 'Rare',
      pack: 'expansion',
      description: 'Voor wie overal net genoeg sporen achterlaat om verdacht te zijn.',
      requirementsText: 'Minstens 1 actie in alle 6 onderdelen: potjes, drankjes, ballroom, live, Rad en Despimarkt.',
      imageFull: assetPath('expansion', 'sporenzoeker'),
      imageMini48: miniPath('48', 'sporenzoeker'),
      imageMini64: miniPath('64', 'sporenzoeker')
    },
    {
      key: 'elosmid',
      legacyLabels: [],
      title: 'ELO-smid',
      plaqueTitle: 'ELO-smid',
      nickname: 'De Ratingbouwer',
      rarityRank: 52,
      rarityLabel: 'Epic',
      pack: 'expansion',
      description: 'Voor wie z\'n rating als metaal smeedt.',
      requirementsText: 'Haal 1350+ ELO in één spel.',
      imageFull: assetPath('expansion', 'elosmid'),
      imageMini48: miniPath('48', 'elosmid'),
      imageMini64: miniPath('64', 'elosmid')
    },
    {
      key: 'fluwelenvorst',
      legacyLabels: [],
      title: 'Fluwelen Vorst',
      plaqueTitle: 'Fluwelen Vorst',
      nickname: 'De Rode Baron',
      rarityRank: 53,
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
      rarityRank: 54,
      rarityLabel: 'Legendary',
      pack: 'prestige',
      description: 'Voor de speler die speciale avonden naar zich toe trekt.',
      requirementsText: '15 verschillende win-dagen (elke kalenderdag max. 1x) in matches met minstens 3 deelnemers. Speciale dagen = weekend (vr/za/zo) of na 18:00.',
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
      rarityRank: 55,
      rarityLabel: 'Epic',
      pack: 'prestige',
      description: 'Voor spelers die meerdere dagen achter elkaar leveren.',
      requirementsText: '7 geverifieerde snelheids- of drankrecords in 7 opeenvolgende actieve dagen. (Snelheidsrecord = top 5 tijd per dranktype; bij gelijke tijd blijft de eerdere plek.)',
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
      rarityRank: 56,
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
      rarityRank: 57,
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
      rarityRank: 58,
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
      rarityRank: 59,
      rarityLabel: 'Mythic',
      pack: 'prestige',
      description: 'Voor de absolute allesdrager van de site.',
      requirementsText: 'Uiterst zeldzaam: 50 potjes, 50 geverifieerde drankacties, 25 geaccepteerde verificaties, minstens 2 snelheidsrecords (top 5 per dranktype) en activiteit in ballroom en live spectator-games.',
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
    getMiniBadgeRow
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  global.GEJAST_BADGE_REGISTRY = api;
  global.GEJAST_BADGES_CANONICAL = api;
})(typeof window !== 'undefined' ? window : globalThis);
