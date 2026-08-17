import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('gejast-v725-repair.js', 'utf8');
if (!source.includes('let homepageLiveCardsChecked=false')) throw new Error('v725 one-shot homepage fallback guard missing');
if (!source.includes("if(path && path!=='index.html') return")) throw new Error('v725 must not run homepage-live repair on home.html');
if (!source.includes("window.GEJAST_LIVE_SUMMARY&&typeof window.GEJAST_LIVE_SUMMARY.loadHomepageState==='function'")) throw new Error('canonical live-summary ownership guard missing');

async function exercise({ canonical }) {
  let fetchCount = 0;
  const intervals = [];
  const head = { appendChild() {} };
  const classList = { add(){}, remove(){} };
  const document = {
    readyState: 'complete', hidden: false, head,
    body: { classList, innerText: '' },
    addEventListener(){},
    getElementById(){ return null; },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    createElement(){ return { id:'', className:'', style:{}, setAttribute(){}, appendChild(){}, querySelector(){return null;} }; }
  };
  const window = {
    GEJAST_CONFIG: {
      SUPABASE_URL: 'https://example.invalid',
      SUPABASE_PUBLISHABLE_KEY: 'test',
      getPlayerSessionToken(){ return 'a'.repeat(48); }
    },
    GEJAST_SCOPE_UTILS: { getScope(){ return 'friends'; } },
    ...(canonical ? { GEJAST_LIVE_SUMMARY: { loadHomepageState(){} } } : {})
  };
  const context = {
    window, document,
    location: { pathname: '/index.html', search: '', href: 'https://kalenel.nl/index.html', replace(){} },
    history: { replaceState(){} },
    URL, URLSearchParams,
    console,
    fetch: async () => { fetchCount += 1; return { ok:true, status:200, async text(){ return '{}'; } }; },
    setInterval(fn){ intervals.push(fn); return intervals.length; }, clearInterval(){},
    setTimeout(){ return 1; }, clearTimeout(){},
    encodeURIComponent,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename:'gejast-v725-repair.js' });
  for (let i=0;i<8;i++) for (const fn of [...intervals]) fn();
  await new Promise((resolve)=>setImmediate(resolve));
  return fetchCount;
}

const canonicalCount = await exercise({ canonical:true });
if (canonicalCount !== 0) throw new Error(`canonical v803 homepage made ${canonicalCount} legacy homepage-live fetches; expected 0`);
const fallbackCount = await exercise({ canonical:false });
if (fallbackCount > 1) throw new Error(`legacy fallback made ${fallbackCount} homepage-live fetches; expected at most 1`);
console.log(`PASS v803 homepage-live cadence: canonical=${canonicalCount}, legacy_fallback=${fallbackCount}`);
