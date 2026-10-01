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

  if(active && String(active.deployment?.sha||'')===expectedSha){
    const actualVersion=await liveVersion(attempt);
    if(actualVersion===expectedVersion){
      appendGithubEnv({
        GEJAST_SOURCE_VERSION:expectedVersion,
        GEJAST_LIVE_VERSION:actualVersion,
        GEJAST_LIVE_VERSION_MATCH:'1',
        GEJAST_LIVE_SHA_MATCH:'1',
        GEJAST_ACTIVE_PAGES_DEPLOYMENT_ID:String(active.deployment?.id||''),
      });
      console.log(`RESULT=EXACT_ACTIVE_PAGES_DEPLOYMENT_PASS sha=${expectedSha} deployment=${active.deployment?.id||'unknown'} version=${actualVersion} attempt=${attempt}`);
      process.exit(0);
    }
    console.log(`EXACT_PAGES_WAIT active_sha=${expectedSha} version=${actualVersion||'unavailable'} expected_version=${expectedVersion} attempt=${attempt}`);
  } else {
    const activeSha=String(active?.deployment?.sha||'');
    const activeCreated=Date.parse(String(active?.deployment?.created_at||''))||0;
    const expectedCreated=Date.parse(String(expected?.deployment?.created_at||''))||0;
    if(activeSha && activeSha!==expectedSha && expectedCreated && activeCreated>expectedCreated){
      throw new Error(`EXACT_PAGES_DEPLOYMENT_FAIL tested SHA ${expectedSha} was superseded by active SHA ${activeSha}`);
    }
    console.log(`EXACT_PAGES_WAIT active_sha=${activeSha||'none'} expected_sha=${expectedSha} expected_state=${expected?.state||'absent'} attempt=${attempt}`);
  }

  if(attempt<attempts) await sleep(delayMs);
}

throw new Error(`EXACT_PAGES_DEPLOYMENT_FAIL timed out waiting for tested SHA ${expectedSha} to become the active successful GitHub Pages deployment with VERSION ${expectedVersion}`);
