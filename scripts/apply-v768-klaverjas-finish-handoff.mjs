#!/usr/bin/env node
import fs from 'node:fs';

function readLf(path){ return fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n'); }
function mustReplace(text, from, to, label){
  if(!text.includes(from)) throw new Error(`Expected source not found: ${label}`);
  return text.replace(from,to);
}

const roundPath='scorer.html';
let round=readLf(roundPath);
round=mustReplace(
  round,
  "    .save-bar { padding:10px 14px calc(10px + env(safe-area-inset-bottom)); background:linear-gradient(180deg, rgba(247,244,238,0), rgba(247,244,238,0.96) 40%, rgba(247,244,238,0.98)); }\n    .save-btn { width:100%; border:none; border-radius:16px; padding:14px; background:#111; color:#fff; font-size:17px; font-weight:900; box-shadow:0 16px 24px rgba(0,0,0,0.16); cursor:pointer; }\n    .save-btn:disabled { opacity:.45; cursor:not-allowed; }",
  "    .save-bar { display:grid; gap:8px; padding:10px 14px calc(10px + env(safe-area-inset-bottom)); background:linear-gradient(180deg, rgba(247,244,238,0), rgba(247,244,238,0.96) 40%, rgba(247,244,238,0.98)); }\n    .save-btn { width:100%; border:none; border-radius:16px; padding:14px; background:#111; color:#fff; font-size:17px; font-weight:900; box-shadow:0 16px 24px rgba(0,0,0,0.16); cursor:pointer; }\n    .save-btn:disabled { opacity:.45; cursor:not-allowed; }\n    .save-match-btn { background:var(--gold); color:#111; }",
  'finished save button styles'
);
round=mustReplace(
  round,
  "    <div class=\"save-bar\"><button id=\"saveRoundBtn\" class=\"save-btn\" type=\"button\" onclick=\"saveRound()\">Ronde opslaan</button></div>",
  "    <div class=\"save-bar\"><button id=\"saveRoundBtn\" class=\"save-btn\" type=\"button\" onclick=\"saveRound()\">Ronde opslaan</button><button id=\"saveMatchBtn\" class=\"save-btn save-match-btn\" type=\"button\" onclick=\"handoffFinishedGame()\" hidden>Wedstrijd opslaan</button></div>",
  'finished save button markup'
);
round=mustReplace(
  round,
  "    const PLAYERS_KEY = 'vault_players_v67';",
  "    const PLAYERS_KEY = 'vault_players_v67';\n    const FINISHED_HANDOFF_KEY = 'gejast_klaverjas_finished_handoff_v1';",
  'finished handoff key'
);
round=mustReplace(
  round,
  [
    "    function finishGame() {",
    "      setMessage('16 rondes bereikt. Sla dit potje in de database-opslag op via de andere scorepagina als je dat wilt bewaren.');",
    "    }"
  ].join('\n'),
  [
    "    function finishedMatchHandoffPayload() {",
    "      if (game.rounds.length < 16) throw new Error('Rond eerst alle 16 rondes af.');",
    "      const players = (game.players || []).map((name) => String(name || '').trim());",
    "      if (players.length !== 4 || players.some((name) => !name)) throw new Error('De vier spelers ontbreken; kies de teams opnieuw.');",
    "      return {",
    "        schema_version: 1,",
    "        source: 'round-scorer',",
    "        created_at: new Date().toISOString(),",
    "        rounds: game.rounds.length,",
    "        team_a_names: [game.players[0], game.players[2]],",
    "        team_b_names: [game.players[1], game.players[3]],",
    "        team_a_score: Number(game.w || 0),",
    "        team_b_score: Number(game.z || 0),",
    "        raw_a_score: Number(game.rawW || 0),",
    "        raw_b_score: Number(game.rawZ || 0)",
    "      };",
    "    }",
    "",
    "    function handoffFinishedGame() {",
    "      try {",
    "        const handoff = finishedMatchHandoffPayload();",
    "        sessionStorage.setItem(FINISHED_HANDOFF_KEY, JSON.stringify(handoff));",
    "        const url = new URL('./score.html', window.location.href);",
    "        url.searchParams.set('handoff', '1');",
    "        const scope = window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.getScope === 'function' ? window.GEJAST_SCOPE_UTILS.getScope() : 'friends';",
    "        if (scope === 'family') url.searchParams.set('scope', 'family');",
    "        window.location.href = url.toString();",
    "      } catch (error) {",
    "        setMessage(error?.message || 'Eindstand overnemen mislukt.');",
    "      }",
    "    }",
    "",
    "    function finishGame() {",
    "      setMessage('16 rondes voltooid. Controleer de eindstand en kies Wedstrijd opslaan.');",
    "    }"
  ].join('\n'),
  'finished game handoff functions'
);
round=mustReplace(
  round,
  "      document.getElementById('saveRoundBtn').disabled = game.rounds.length >= 16; const topBtn=document.getElementById('saveRoundBtnTop'); if(topBtn) topBtn.disabled = document.getElementById('saveRoundBtn').disabled;",
  [
    "      const finished = game.rounds.length >= 16;",
    "      const saveRoundBtn = document.getElementById('saveRoundBtn');",
    "      saveRoundBtn.disabled = finished;",
    "      const topBtn = document.getElementById('saveRoundBtnTop');",
    "      if (topBtn) topBtn.disabled = finished;",
    "      const saveMatchBtn = document.getElementById('saveMatchBtn');",
    "      if (saveMatchBtn) saveMatchBtn.hidden = !finished;",
    "      if (finished) document.getElementById('roundLabel').textContent = '16 rondes voltooid';"
  ].join('\n'),
  'finished game controls'
);
fs.writeFileSync(roundPath,round,'utf8');

const savePath='klaverjas_scorer_v596_repo_ready.html';
let save=readLf(savePath);
save=mustReplace(
  save,
  [
    "    const rt = window.GEJAST_KLAVERJAS_RUNTIME;",
    "    const $ = (id)=>document.getElementById(id);",
    "    const selects = ['a1','a2','b1','b2'].map($);",
    "    function setStatus(msg='', tone=''){ const el=$('status'); el.textContent=msg; el.className='status '+tone; }",
    "    function optionHtml(names){ return '<option value=\"\">Kies speler</option>' + (names||[]).map((name)=>`<option value=\"${rt.escapeHtml(name)}\">${rt.escapeHtml(name)}</option>`).join(''); }",
    "    async function loadNames(){",
    "      try {",
    "        const names = await rt.loadNames();",
    "        const html = optionHtml(names);",
    "        selects.forEach((s)=>{ s.innerHTML = html; });",
    "        if(!names.length) setStatus('Geen actieve spelers gevonden voor deze scope.', 'bad');",
    "      } catch(err){ setStatus(err.message || 'Namen laden mislukt.', 'bad'); }",
    "    }"
  ].join('\n'),
  [
    "    const rt = window.GEJAST_KLAVERJAS_RUNTIME;",
    "    const $ = (id)=>document.getElementById(id);",
    "    const selects = ['a1','a2','b1','b2'].map($);",
    "    const FINISHED_HANDOFF_KEY = 'gejast_klaverjas_finished_handoff_v1';",
    "    function setStatus(msg='', tone=''){ const el=$('status'); el.textContent=msg; el.className='status '+tone; }",
    "    function optionHtml(names){ return '<option value=\"\">Kies speler</option>' + (names||[]).map((name)=>`<option value=\"${rt.escapeHtml(name)}\">${rt.escapeHtml(name)}</option>`).join(''); }",
    "    function readFinishedHandoff(){",
    "      const params=new URLSearchParams(window.location.search||'');",
    "      if(params.get('handoff')!=='1') return null;",
    "      try {",
    "        const data=JSON.parse(sessionStorage.getItem(FINISHED_HANDOFF_KEY)||'null');",
    "        if(!data||data.schema_version!==1||data.source!=='round-scorer') return null;",
    "        if(!Array.isArray(data.team_a_names)||data.team_a_names.length!==2||!Array.isArray(data.team_b_names)||data.team_b_names.length!==2) return null;",
    "        const team_a_score=Number(data.team_a_score); const team_b_score=Number(data.team_b_score);",
    "        if(!Number.isFinite(team_a_score)||!Number.isFinite(team_b_score)) return null;",
    "        return {...data,team_a_names:data.team_a_names.map((x)=>String(x||'').trim()),team_b_names:data.team_b_names.map((x)=>String(x||'').trim()),team_a_score,team_b_score};",
    "      } catch(_){ return null; }",
    "    }",
    "    let pendingHandoff=readFinishedHandoff();",
    "    function handoffPlayerNames(){ return pendingHandoff ? pendingHandoff.team_a_names.concat(pendingHandoff.team_b_names).filter(Boolean) : []; }",
    "    function applyFinishedHandoff(){",
    "      if(!pendingHandoff) return;",
    "      const wanted=pendingHandoff.team_a_names.concat(pendingHandoff.team_b_names);",
    "      const missing=[];",
    "      selects.forEach((select,index)=>{ const name=wanted[index]||''; const option=[...select.options].find((item)=>item.value===name); if(option) select.value=name; else if(name) missing.push(name); });",
    "      if(missing.length){ setStatus('Eindstand gevonden, maar speler(s) ontbreken in de actieve lijst: '+missing.join(', ')+'.', 'bad'); return; }",
    "      $('scoreA').value=String(pendingHandoff.team_a_score);",
    "      $('scoreB').value=String(pendingHandoff.team_b_score);",
    "      $('roemA').value='0'; $('roemB').value='0';",
    "      if(!$('notes').value) $('notes').value='Overgenomen uit Klaverjas Score Formulier (16 rondes).';",
    "      sessionStorage.removeItem(FINISHED_HANDOFF_KEY);",
    "      pendingHandoff=null;",
    "      const url=new URL(window.location.href); url.searchParams.delete('handoff'); history.replaceState(null,'',url.pathname+url.search+url.hash);",
    "      setStatus('Eindstand overgenomen. Controleer alles en druk daarna op Opslaan.', 'ok');",
    "    }",
    "    async function loadNames(){",
    "      try {",
    "        const names = await rt.loadNames();",
    "        const merged=[...new Set((names||[]).concat(handoffPlayerNames()).map((name)=>String(name||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'nl'));",
    "        const html = optionHtml(merged);",
    "        selects.forEach((s)=>{ s.innerHTML = html; });",
    "        if(!merged.length) setStatus('Geen actieve spelers gevonden voor deze scope.', 'bad');",
    "        applyFinishedHandoff();",
    "      } catch(err){ setStatus(err.message || 'Namen laden mislukt.', 'bad'); }",
    "    }"
  ].join('\n'),
  'save scorer handoff reader'
);
fs.writeFileSync(savePath,save,'utf8');

const packagePath='package.json';
const pkg=JSON.parse(fs.readFileSync(packagePath,'utf8'));
const check='node check-klaverjas-round-finish-handoff-v768.mjs';
if(!String(pkg.scripts?.['verify:static']||'').includes(check)) pkg.scripts['verify:static'] += ` && ${check}`;
fs.writeFileSync(packagePath,JSON.stringify(pkg,null,2)+'\n','utf8');
fs.writeFileSync('VERSION','v768\n','utf8');
console.log('Applied v768 Klaverjas finished-game review handoff and release bump.');
