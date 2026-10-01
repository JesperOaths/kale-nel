#!/usr/bin/env node
import fs from 'node:fs';

const repo=String(process.env.GITHUB_REPOSITORY||'').trim();
const expectedSha=String(process.env.GITHUB_SHA||'').trim();
const token=String(process.env.GH_TOKEN||process.env.GITHUB_TOKEN||'').trim();
const versionFile=String(process.env.GEJAST_EXPECTED_VERSION_FILE||'VERSION');
const liveVersionUrl=String(process.env.GEJAST_LIVE_VERSION_URL||'https://kalenel.nl/VERSION');
const attempts=Math.max(1,Number(process.env.GEJAST_DEPLOYMENT_ATTEMPTS||60));
const delayMs=Math.max(0,Number(process.env.GEJAST_DEPLOYMENT_DELAY_MS||10000));
const scanLimit=Math.max(3,Math.min(20,Number(process.env.GEJAST_DEPLOYMENT_SCAN_LIMIT||10)));
const requireCurrentMain=String(process.env.GEJAST_REQUIRE_CURRENT_MAIN||'1')!=='0';

if(!repo||!expectedSha||!token) throw new Error('EXACT_PAGES_DEPLOYMENT_FAIL missing GITHUB_REPOSITORY, GITHUB_SHA or GH_TOKEN');
const expectedVersion=fs.readFileSync(versionFile,'utf8').trim();
if(!/^v\d+$/i.test(expectedVersion)) throw new Error('EXACT_PAGES_DEPLOYMENT_FAIL invalid expected VERSION');

const headers={
  Authorization:`Bearer ${token}`,
  Accept:'application/vnd.github+json',
  'X-GitHub-Api-Version':'2022-11-28',
  'User-Agent':'Kalenel-Exact-Pages-Certification/1.0',
};

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const nonSurfacePrefixes=['.github/','cloudflare/','scripts/','docs/','sql/','repo/','mnt/','deployment_forensics_v761/','RELEASES/','supabase/','ops/'];

function isPublishedSurfacePath(value){
  const rel=String(value||'').replaceAll('\\','/').replace(/^\.\//,'');
  if(rel==='VERSION') return true;
  if(nonSurfacePrefixes.some(prefix=>rel.startsWith(prefix))) return false;
  return /\.(?:html|js|css)$/i.test(rel);
}

async function githubJson(pathname){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const res=await fetch(`https://api.github.com${pathname}`,{headers,signal:controller.signal,cache:'no-store'});
    if(!res.ok) throw new Error(`GitHub API ${res.status} for ${pathname}`);
    return await res.json();
  }finally{clearTimeout(timer);}
}

async function deploymentState(deployment){
  const path=new URL(deployment.statuses_url).pathname+'?per_page=20';
  const rows=await githubJson(path);
  return String(Array.isArray(rows)&&rows[0]?.state||'').toLowerCase();
}

async function surfaceComparison(baseSha,headSha){
  if(!baseSha||!headSha) return {compatible:false,status:'missing',changed:[]};
  if(baseSha===headSha) return {compatible:true,status:'identical',changed:[]};
  const result=await githubJson(`/repos/${repo}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`);
  const status=String(result?.status||'');
  const changed=(Array.isArray(result?.files)?result.files:[])
    .map(file=>String(file?.filename||''))
    .filter(isPublishedSurfacePath);
  const lineageOk=status==='ahead'||status==='behind'||status==='identical';
  return {compatible:lineageOk&&changed.length===0,status,changed};
}

async function liveVersion(attempt){
  const u=new URL(liveVersionUrl);
  u.searchParams.set('exact_pages_run',String(process.env.GITHUB_RUN_ID||'local'));
  u.searchParams.set('attempt',String(attempt));
  u.searchParams.set('sha',expectedSha);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const res=await fetch(u,{cache:'no-store',signal:controller.signal,headers:{'cache-control':'no-cache','pragma':'no-cache'}});
    return res.ok?(await res.text()).trim():'';
  }catch{return '';}
  finally{clearTimeout(timer);}
}

function appendGithubEnv(values){
  const target=String(process.env.GITHUB_ENV||'').trim();
  if(!target) return;
  fs.appendFileSync(target,Object.entries(values).map(([k,v])=>`${k}=${String(v??'')}`).join('\n')+'\n');
}

for(let attempt=1;attempt<=attempts;attempt++){
  let mainSha=expectedSha;
  if(requireCurrentMain){
    const ref=await githubJson(`/repos/${repo}/git/ref/heads/main`);
    mainSha=String(ref?.object?.sha||'');
    if(mainSha&&mainSha!==expectedSha){
      const mainSurface=await surfaceComparison(expectedSha,mainSha);
      if(!mainSurface.compatible){
        throw new Error(`EXACT_PAGES_DEPLOYMENT_FAIL tested revision was superseded by main with published-surface changes: ${mainSurface.changed.slice(0,12).join(',')||mainSurface.status}`);
      }
      console.log(`PAGES_SURFACE_EQUIVALENT_MAIN expected_sha=${expectedSha} main_sha=${mainSha} compare=${mainSurface.status}`);
    }
  }

  const deployments=await githubJson(`/repos/${repo}/deployments?environment=github-pages&per_page=${scanLimit}`);
  const rows=Array.isArray(deployments)?deployments:[];
  const enriched=await Promise.all(rows.map(async deployment=>({
    deployment,
    state:await deploymentState(deployment).catch(()=> ''),
  })));

  const active=enriched.find(row=>row.state==='success')||null;
  const expected=enriched.find(row=>String(row.deployment?.sha||'')===expectedSha)||null;

  if(expected && ['failure','error','inactive'].includes(expected.state)){
    throw new Error(`EXACT_PAGES_DEPLOYMENT_FAIL tested SHA reached terminal deployment state ${expected.state}`);
  }

  const activeSha=String(active?.deployment?.sha||'');
  let surfaceEquivalent=false;
  if(activeSha){
    const activeSurface=await surfaceComparison(expectedSha,activeSha);
    surfaceEquivalent=activeSurface.compatible;
    if(!surfaceEquivalent && activeSurface.status==='ahead'){
      throw new Error(`EXACT_PAGES_DEPLOYMENT_FAIL active Pages SHA ${activeSha} contains newer published-surface changes: ${activeSurface.changed.slice(0,12).join(',')||'unknown'}`);
    }
  }

  if(active && surfaceEquivalent){
    const actualVersion=await liveVersion(attempt);
    if(actualVersion===expectedVersion){
      const exact=activeSha===expectedSha;
      appendGithubEnv({
        GEJAST_SOURCE_VERSION:expectedVersion,
        GEJAST_LIVE_VERSION:actualVersion,
        GEJAST_LIVE_VERSION_MATCH:'1',
        GEJAST_LIVE_SHA_MATCH:exact?'1':'0',
        GEJAST_LIVE_SURFACE_MATCH:'1',
        GEJAST_ACTIVE_PAGES_SHA:activeSha,
        GEJAST_ACTIVE_PAGES_DEPLOYMENT_ID:String(active.deployment?.id||''),
      });
      console.log(`RESULT=ACTIVE_PAGES_SURFACE_PASS tested_sha=${expectedSha} active_sha=${activeSha} exact_sha=${exact?1:0} deployment=${active.deployment?.id||'unknown'} version=${actualVersion} attempt=${attempt}`);
      process.exit(0);
    }
    console.log(`PAGES_SURFACE_WAIT tested_sha=${expectedSha} active_sha=${activeSha} version=${actualVersion||'unavailable'} expected_version=${expectedVersion} attempt=${attempt}`);
  } else {
    console.log(`PAGES_SURFACE_WAIT tested_sha=${expectedSha} active_sha=${activeSha||'none'} expected_state=${expected?.state||'absent'} attempt=${attempt}`);
  }

  if(attempt<attempts) await sleep(delayMs);
}

throw new Error(`EXACT_PAGES_DEPLOYMENT_FAIL timed out waiting for an active GitHub Pages deployment with the same published surface as ${expectedSha} and VERSION ${expectedVersion}`);
