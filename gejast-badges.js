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
      description: 'Voor wie zichtbaar ervaring opbouwt in Pikken.',
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
      description: 'Voor wie een Paardenrace met minimaal verschil over de lijn trekt.',
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
      description: 'Voor wie vaak onderaan eindigt, maar toch steeds weer opstapt.',
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

  function countTopFiveSpeedRecords(records) {
    const seen = new Set();
    let count = 0;
    for (const row of toArray(records)) {
      const rank = Number(
        row?.rank ??
        row?.position ??
        row?.place ??
        row?.spot ??
        row?.leaderboard_rank ??
        row?.leaderboardRank
      );
      if (!Number.isFinite(rank) || rank <= 0 || rank > 5) continue;
      const type = firstNonEmpty(
        row?.canonical_type_key,
        row?.canonicalTypeKey,
        row?.event_type_key,
        row?.eventTypeKey,
        row?.key,
        row?.label
      );
      const key = String(type || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      count += 1;
    }
    return count;
  }

  function countDistinctSpeedTypes(records) {
    const seen = new Set();
    for (const row of toArray(records)) {
      const seconds = Number(
        row?.seconds ??
        row?.best_seconds ??
        row?.time_seconds ??
        row?.timeSeconds ??
        row?.bestSeconds
      );
      if (!Number.isFinite(seconds) || seconds <= 0) continue;
      const type = firstNonEmpty(
        row?.canonical_type_key,
        row?.canonicalTypeKey,
        row?.event_type_key,
        row?.eventTypeKey,
        row?.key,
        row?.label
      );
      const key = String(type || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
    }
    return seen.size;
  }

  function countDistinctDrinkTypes(rows) {
    const seen = new Set();
    for (const row of toArray(rows)) {
      const events = toNumber(
        row?.events,
        row?.event_count,
        row?.eventCount,
        row?.count,
        row?.total,
        row?.total_events
      );
      if (events <= 0) continue;
      const type = firstNonEmpty(
        row?.canonical_type_key,
        row?.canonicalTypeKey,
        row?.event_type_key,
        row?.eventTypeKey,
        row?.key,
        row?.label,
        row?.name
      );
      const key = String(type || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
    }
    return seen.size;
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
    const paardenraceSummary = games.paardenrace && games.paardenrace.summary || {};
    const pikkenSummary = games.pikken && games.pikken.summary || {};
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
    const hasExplicitTop5SpeedCount =
      Number.isFinite(Number(root.speed_record_top5_count)) ||
      Number.isFinite(Number(root.speed_top5_count)) ||
      Number.isFinite(Number(drinks.speed_record_top5_count)) ||
      Number.isFinite(Number(drinks.speed_top5_count));
    const explicitTop5SpeedCount = toNumber(
      root.speed_record_top5_count,
      root.speed_top5_count,
      drinks.speed_record_top5_count,
      drinks.speed_top5_count
    );
    const speedTop5FromRows = countTopFiveSpeedRecords(speedRecords);
    const speedCount = hasExplicitTop5SpeedCount
      ? explicitTop5SpeedCount
      : (speedTop5FromRows > 0
        ? speedTop5FromRows
        : toNumber(
          root.speed_record_count,
          drinks.speed_record_count,
          speedRecords.length
        ));
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
    const specialWins = Math.max(
      toNumber(root.evening_weekend_win_dates, badgeFacts.evening_weekend_win_dates),
      toNumber(root.special_event_wins, profile.special_event_wins, sharedStats.special_event_wins, badgeFacts.special_event_wins)
    );
    const liveParticipationsTotal = toNumber(root.live_participations_total, badgeFacts.live_participations_total);
    const liveParticipationsKlaverjas = toNumber(root.live_participations_klaverjas, badgeFacts.live_participations_klaverjas);
    const liveParticipationsBoerenbridge = toNumber(root.live_participations_boerenbridge, badgeFacts.live_participations_boerenbridge);
    const totalComebackWins = toNumber(root.total_comeback_wins, badgeFacts.total_comeback_wins);
    const klaverjasComebackWins = toNumber(root.klaverjas_comeback_wins, badgeFacts.klaverjas_comeback_wins);
    const boerenbridgeComebackWins = toNumber(root.boerenbridge_comeback_wins, badgeFacts.boerenbridge_comeback_wins);
    const speedTypeCount = countDistinctSpeedTypes(speedRecords);
    const drinkTypeCount = countDistinctDrinkTypes(favorites);
    const radSpins = toNumber(
      root.rad_spin_count,
      root.rad_spins,
      badgeFacts.rad_spin_count,
      badgeFacts.rad_spins,
      sharedStats.rad_spin_count,
      sharedStats.rad_spins
    );
    const radDrinkUnits = toNumber(
      root.rad_drink_units,
      root.rad_units,
      badgeFacts.rad_drink_units,
      badgeFacts.rad_units,
      sharedStats.rad_drink_units,
      sharedStats.rad_units
    );
    const despimarktBets = toNumber(
      root.despimarkt_bets,
      root.despimarkt_bet_count,
      root.despimarkt_trade_count,
      badgeFacts.despimarkt_bets,
      badgeFacts.despimarkt_trade_count,
      sharedStats.despimarkt_bets,
      sharedStats.despimarkt_trade_count
    );
    const despimarktMarketsCreated = toNumber(
      root.despimarkt_markets_created,
      badgeFacts.despimarkt_markets_created,
      sharedStats.despimarkt_markets_created
    );
    const despimarktPnlCautes = toNumber(
      root.despimarkt_pnl_cautes,
      root.despimarkt_profit_cautes,
      badgeFacts.despimarkt_pnl_cautes,
      badgeFacts.despimarkt_profit_cautes,
      sharedStats.despimarkt_pnl_cautes,
      sharedStats.despimarkt_profit_cautes
    );
    const bestBadge = firstNonEmpty(root.best_badge, overview.best_badge, profile.best_badge);
    const allMatches = {
      klaverjas: toNumber(root.klaverjas_matches, overview.klaverjas_matches, klaverjasSummary.games_played, klaverjasSummary.matches_played),
      boerenbridge: toNumber(root.boerenbridge_matches, overview.boerenbridge_matches, boerenbridgeSummary.games_played, boerenbridgeSummary.matches_played),
      beerpong: toNumber(root.beerpong_matches, overview.beerpong_matches, beerpongSummary.games_played, beerpongSummary.matches_played),
      paardenrace: toNumber(root.paardenrace_matches, overview.paardenrace_matches, paardenraceSummary.games_played, paardenraceSummary.matches_played),
      pikken: toNumber(root.pikken_matches, overview.pikken_matches, pikkenSummary.games_played, pikkenSummary.matches_played)
    };
    const allWins = {
      klaverjas: toNumber(root.klaverjas_wins, klaverjasSummary.wins),
      boerenbridge: toNumber(root.boerenbridge_wins, boerenbridgeSummary.wins),
      beerpong: toNumber(root.beerpong_wins, beerpongSummary.wins),
      paardenrace: toNumber(root.paardenrace_wins, paardenraceSummary.wins),
      pikken: toNumber(root.pikken_wins, pikkenSummary.wins)
    };
    const winRateByGame = {
      klaverjas: toNumber(root.klaverjas_win_pct, klaverjasSummary.win_pct),
      boerenbridge: toNumber(root.boerenbridge_win_pct, boerenbridgeSummary.win_pct),
      beerpong: toNumber(root.beerpong_win_pct, beerpongSummary.win_pct),
      paardenrace: toNumber(root.paardenrace_win_pct, paardenraceSummary.win_pct),
      pikken: toNumber(root.pikken_win_pct, pikkenSummary.win_pct)
    };
    const pikkenWinStreak = toNumber(root.pikken_win_streak, gameInsights.pikken_win_streak, sharedStats.pikken_win_streak);
    const paardenraceWinStreak = toNumber(root.paardenrace_win_streak, gameInsights.paardenrace_win_streak, sharedStats.paardenrace_win_streak);
    const paardenracePhotoFinishWins = toNumber(
      root.paardenrace_fotofinish_wins,
      root.paardenrace_photo_finish_wins,
      paardenraceSummary.fotofinish_wins,
      paardenraceSummary.photo_finish_wins,
      gameInsights.paardenrace_fotofinish_wins,
      sharedStats.paardenrace_fotofinish_wins
    );
    const bestWinRate = Math.max(
      winRateByGame.klaverjas || 0,
      winRateByGame.boerenbridge || 0,
      winRateByGame.beerpong || 0,
      winRateByGame.paardenrace || 0,
      winRateByGame.pikken || 0,
      toNumber(root.best_win_pct, overview.best_win_pct)
    );
    const activeGameCount = Object.values(allMatches).filter((n) => Number(n) > 0).length;
    const activeSitePartCount = [
      totalMatches > 0,
      drinkEvents > 0,
      verificationVotes > 0,
      ballroomEntries > 0 || ballroomKingCount > 0,
      liveParticipationsTotal > 0,
      radSpins > 0,
      (despimarktBets + despimarktMarketsCreated) > 0
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
      paardenraceMatches: allMatches.paardenrace,
      pikkenMatches: allMatches.pikken,
      klaverjasWins: allWins.klaverjas,
      boerenbridgeWins: allWins.boerenbridge,
      beerpongWins: allWins.beerpong,
      paardenraceWins: allWins.paardenrace,
      pikkenWins: allWins.pikken,
      paardenraceWinPct: winRateByGame.paardenrace,
      pikkenWinPct: winRateByGame.pikken,
      paardenraceWinStreak,
      pikkenWinStreak,
      paardenracePhotoFinishWins,
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
      speedTypeCount,
      drinkTypeCount,
      radSpins,
      radDrinkUnits,
      despimarktBets,
      despimarktMarketsCreated,
      despimarktPnlCautes,
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
    verifieermeester: (s) => s.verificationVotes >= 20,
    pussycup_prins: (s) => s.beerpongMatches >= 10 && s.pussycupPct >= 25,
    onbreekbaar: (s) => s.winStreak >= 10,
    spinozageest: (s) => s.totalMatches >= 25 && s.drinkEvents >= 20 && s.verificationVotes >= 10 && s.activeGameCount >= 2,
    alleskunner: (s) => [
      s.klaverjasMatches,
      s.boerenbridgeMatches,
      s.beerpongMatches,
      s.paardenraceMatches,
      s.pikkenMatches
    ].filter((n) => Number(n) >= 10).length >= 3,
    nachtburgemeester: (s) => s.nightActions >= 12,
    dorstmachine: (s) => s.drinkUnits >= 40,
    literlegende: (s) => s.literSub90Count >= 3,
    pikken: (s) => s.pikkenMatches >= 10 || s.pikkenWins >= 5,
    paardenrace: (s) => s.paardenraceMatches >= 10 || s.paardenraceWins >= 5,
    pikken_eersteprik: (s) => s.pikkenMatches >= 1,
    paardenrace_startschot: (s) => s.paardenraceMatches >= 1,
    pikken_zesjesregen: (s) => s.pikkenMatches >= 6,
    paardenrace_hoefijzerheld: (s) => s.paardenraceWins >= 1,
    pikken_dubbelzes: (s) => s.pikkenMatches >= 10 && s.pikkenWinPct >= 25,
    paardenrace_fotofinish: (s) => s.paardenracePhotoFinishWins >= 2,
    pikken_waaghalspas: (s) => s.pikkenMatches >= 25,
    paardenrace_snelheidspaard: (s) => s.paardenraceWinStreak >= 2,
    pikken_prikoprij: (s) => s.pikkenWinStreak >= 3,
    paardenrace_jockeyjubileum: (s) => s.paardenraceMatches >= 25,
    pikken_dobbelbaron: (s) => (s.pikkenMatches - s.pikkenWins) >= 10,
    paardenrace_baanbaas: (s) => (s.paardenraceMatches - s.paardenraceWins) >= 10,
    paardenrace_stalfluisteraar: (s) => s.paardenraceMatches >= 10 && s.paardenraceWinPct >= 30,
    rad: (s) => s.radSpins >= 1,
    rad_draaikoorts: (s) => s.radSpins >= 10,
    rad_katerkompas: (s) => s.radSpins >= 8 && s.radDrinkUnits >= 12,
    despimarkt: (s) => (s.despimarktBets + s.despimarktMarketsCreated) >= 1,
    despimarkt_marktmeester: (s) => s.despimarktMarketsCreated >= 3,
    despimarkt_orakel: (s) => s.despimarktBets >= 10 && s.despimarktPnlCautes >= 250,
    tribuneheld: (s) => s.liveParticipationsTotal >= 1,
    terugvechter: (s) => s.totalComebackWins >= 3,
    sprintverzamelaar: (s) => s.speedCount >= 3,
    tafeltoerist: (s) => s.klaverjasMatches > 0 && s.boerenbridgeMatches > 0 && s.beerpongMatches > 0 && s.paardenraceMatches > 0 && s.pikkenMatches > 0,
    sporenzoeker: (s) =>
      s.totalMatches > 0 &&
      s.drinkEvents > 0 &&
      (s.ballroomEntries > 0 || s.ballroomKingCount > 0) &&
      s.liveParticipationsTotal > 0 &&
      s.radSpins > 0 &&
      (s.despimarktBets + s.despimarktMarketsCreated) > 0,
    elosmid: (s) => s.bestRating >= 1350,
    bekerbeul: (s) => s.beerpongWins >= 20,
    trouwewachter: (s) => s.verificationVotes >= 10,
    salonleeuw: (s) => s.ballroomEntries >= 10 || s.ballroomKingCount >= 5,
    ijzerenmaag: (s) => s.tenUnitNights >= 5,
    laatsteronde: (s) => s.nightActions >= 5,
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
