#!/usr/bin/env node
import fs from 'node:fs';
const html=fs.readFileSync('index.html','utf8');
const score=fs.readFileSync('score.html','utf8');
function need(text,needle,label){if(!text.includes(needle)){console.error('FAIL:',label);process.exit(1);}}
need(html,'id="homeKlaverjasEntry"','existing round scorer entry remains');
need(html,'href="./scorer.html"','existing round scorer route remains');
need(html,'id="homeKlaverjasLiveEntry"','separate homepage live entry exists');
need(html,'href="./score.html"','homepage live entry routes through score alias');
need(html,'a[href="./score.html"]','family scope chrome includes live scorer alias');
need(score,"new URL('./klaverjas_scorer_v596_repo_ready.html',location.href)",'score alias still redirects to live-capable scorer');
console.log('Homepage Klaverjas live entry v766 regression PASS');
