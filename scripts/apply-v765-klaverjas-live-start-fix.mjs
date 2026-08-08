#!/usr/bin/env node
import fs from 'node:fs';

function mustReplace(text, from, to, label){
  if (!text.includes(from)) throw new Error(`Expected source not found: ${label}`);
  return text.replace(from, to);
}
function readLf(path){
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const runtimePath = 'gejast-klaverjas-runtime.js';
let runtime = readLf(runtimePath);
if (!runtime.includes('function normalizeMatchInput(input, options)')) {
  runtime = mustReplace(
    runtime,
    `  function normalizeMatchInput(input){\n    const payload = Object.assign({}, input || {});`,
    `  function normalizeMatchInput(input, options){\n    const allowTie = Boolean(options && options.allowTie);\n    const payload = Object.assign({}, input || {});`,
    'normalizeMatchInput signature'
  );
  runtime = mustReplace(
    runtime,
    `    if (payload.team_a_score === payload.team_b_score) throw new Error('Een Klaverjas-pot kan niet gelijk eindigen.');`,
    `    if (!allowTie && payload.team_a_score === payload.team_b_score) throw new Error('Een Klaverjas-pot kan niet gelijk eindigen.');`,
    'finished-match tie guard'
  );
  runtime = mustReplace(
    runtime,
    `    const payload = normalizeMatchInput(Object.assign({ team_a_score: 0, team_b_score: 0 }, input || {}));`,
    `    const payload = normalizeMatchInput(Object.assign({ team_a_score: 0, team_b_score: 0 }, input || {}), { allowTie: true });`,
    'live-start normalization'
  );
}
fs.writeFileSync(runtimePath, runtime, 'utf8');

const scorerPath = 'klaverjas_scorer_v596_repo_ready.html';
let scorer = readLf(scorerPath);
if (!scorer.includes('id="liveBtn"')) {
  scorer = mustReplace(
    scorer,
    `          <div class="row" style="margin-top:14px">\n            <button class="btn gold" id="saveBtn" type="button">Opslaan</button>\n            <button class="btn alt" id="clearBtn" type="button">Leegmaken</button>\n          </div>`,
    `          <div class="row" style="margin-top:14px">\n            <button class="btn" id="liveBtn" type="button">Live starten</button>\n            <button class="btn gold" id="saveBtn" type="button">Opslaan</button>\n            <button class="btn alt" id="clearBtn" type="button">Leegmaken</button>\n          </div>`,
    'scorer live button'
  );
  scorer = mustReplace(
    scorer,
    `    function clear(clearStatus=true){`,
    `    function liveClientId(result){\n      const live = result && (result.live_match || (Array.isArray(result.live_matches) ? result.live_matches[0] : null));\n      return String((live && live.client_match_id) || (result && result.client_match_id) || '');\n    }\n    async function startLiveMatch(){\n      const btn=$('liveBtn'); const old=btn.textContent; btn.disabled=true; btn.textContent='Starten…';\n      try {\n        setStatus('Live-pot starten…');\n        const liveInput=payload();\n        liveInput.team_a_score=0; liveInput.team_b_score=0; liveInput.roem_a=0; liveInput.roem_b=0;\n        const result=await rt.startLive(liveInput);\n        const clientId=liveClientId(result);\n        if(!clientId) throw new Error('Live-pot gestart, maar wedstrijd-id ontbreekt.');\n        setStatus('Live-pot gestart.', 'ok');\n        window.location.assign(rt.liveHref(clientId));\n      } catch(err){ setStatus(err.message || 'Live-pot starten mislukt.', 'bad'); }\n      finally { btn.disabled=false; btn.textContent=old; }\n    }\n    function clear(clearStatus=true){`,
    'scorer live start handler'
  );
  scorer = mustReplace(
    scorer,
    `    $('saveBtn').addEventListener('click', save);\n    $('clearBtn').addEventListener('click', ()=>clear(true));`,
    `    $('liveBtn').addEventListener('click', startLiveMatch);\n    $('saveBtn').addEventListener('click', save);\n    $('clearBtn').addEventListener('click', ()=>clear(true));`,
    'scorer live event binding'
  );
}
fs.writeFileSync(scorerPath, scorer, 'utf8');

const regression = `#!/usr/bin/env node\nimport fs from 'node:fs';\n\nconst runtime = fs.readFileSync('gejast-klaverjas-runtime.js','utf8');\nconst scorer = fs.readFileSync('klaverjas_scorer_v596_repo_ready.html','utf8');\n\nfunction requireText(text, needle, label){\n  if(!text.includes(needle)){\n    console.error('FAIL:', label);\n    process.exit(1);\n  }\n}\n\nrequireText(runtime, 'function normalizeMatchInput(input, options)', 'runtime supports validation options');\nrequireText(runtime, 'const allowTie = Boolean(options && options.allowTie);', 'runtime has explicit live tie allowance');\nrequireText(runtime, "if (!allowTie && payload.team_a_score === payload.team_b_score)", 'finished saves still reject ties');\nrequireText(runtime, "{ allowTie: true }", 'live start opts into 0-0/tied start');\nrequireText(scorer, 'id="liveBtn"', 'scorer exposes Live starten button');\nrequireText(scorer, 'const result=await rt.startLive(liveInput);', 'scorer calls live-start runtime');\nrequireText(scorer, 'window.location.assign(rt.liveHref(clientId));', 'scorer opens the created live match');\nrequireText(scorer, "$('liveBtn').addEventListener('click', startLiveMatch);", 'live button is wired');\nconsole.log('Klaverjas v765 live-start frontend regression PASS');\n`;
fs.writeFileSync('check-klaverjas-live-start-frontend-v765.mjs', regression, 'utf8');

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const check = 'node check-klaverjas-live-start-frontend-v765.mjs';
if (!String(pkg.scripts?.['verify:static'] || '').includes(check)) {
  pkg.scripts['verify:static'] = `${pkg.scripts['verify:static']} && ${check}`;
}
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

fs.writeFileSync('VERSION', 'v765\n', 'utf8');
console.log('Applied v765 Klaverjas live-start source patch and root version bump.');
