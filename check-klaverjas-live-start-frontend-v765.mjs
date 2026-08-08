#!/usr/bin/env node
import fs from 'node:fs';

const runtime = fs.readFileSync('gejast-klaverjas-runtime.js','utf8');
const scorer = fs.readFileSync('klaverjas_scorer_v596_repo_ready.html','utf8');

function requireText(text, needle, label){
  if(!text.includes(needle)){
    console.error('FAIL:', label);
    process.exit(1);
  }
}

requireText(runtime, 'function normalizeMatchInput(input, options)', 'runtime supports validation options');
requireText(runtime, 'const allowTie = Boolean(options && options.allowTie);', 'runtime has explicit live tie allowance');
requireText(runtime, "if (!allowTie && payload.team_a_score === payload.team_b_score)", 'finished saves still reject ties');
requireText(runtime, "{ allowTie: true }", 'live start opts into 0-0/tied start');
requireText(scorer, 'id="liveBtn"', 'scorer exposes Live starten button');
requireText(scorer, 'const result=await rt.startLive(liveInput);', 'scorer calls live-start runtime');
requireText(scorer, 'window.location.assign(rt.liveHref(clientId));', 'scorer opens the created live match');
requireText(scorer, "$('liveBtn').addEventListener('click', startLiveMatch);", 'live button is wired');
console.log('Klaverjas v765 live-start frontend regression PASS');
