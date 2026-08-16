#!/usr/bin/env node
import fs from 'node:fs';
const html=fs.readFileSync('index.html','utf8');
const score=fs.readFileSync('score.html','utf8');
function need(text,needle,label){if(!text.includes(needle)){console.error('FAIL:',label);process.exit(1);}}
function reject(text,needle,label){if(text.includes(needle)){console.error('FAIL:',label);process.exit(1);}}
need(html,'id="homeKlaverjasEntry"','canonical Klaverjas score-form entry remains');
need(html,'href="./scorer.html"','canonical score-form route remains');
need(html,'<div class="page-link-label">Klaverjas online</div>','canonical Klaverjas online entry remains');
need(html,'href="./klaverjas_online.html"','canonical Klaverjas online route remains');
reject(html,'id="homeKlaverjasLiveEntry"','legacy duplicate Klaverjas live homepage entry is retired');
need(score,"new URL('./klaverjas_scorer_v596_repo_ready.html',location.href)",'score compatibility alias still redirects to the scorer');
console.log('Homepage Klaverjas v793 product-surface regression PASS: one score form + one online game; legacy score alias retained off-homepage.');
