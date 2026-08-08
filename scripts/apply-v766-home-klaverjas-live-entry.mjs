#!/usr/bin/env node
import fs from 'node:fs';

function readLf(path){ return fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n'); }
function mustReplace(text, from, to, label){
  if(!text.includes(from)) throw new Error(`Expected source not found: ${label}`);
  return text.replace(from,to);
}

const indexPath='index.html';
let html=readLf(indexPath);
if(!html.includes('id="homeKlaverjasLiveEntry"')){
  const existing=`          <a id="homeKlaverjasEntry" class="page-link-card scorer-link feature-primary" href="./scorer.html" data-default-href="./scorer.html">\n            <div id="homeKlaverjasLabel" class="page-link-label">Klaverjas Score Formulier</div>\n            <div id="homeKlaverjasCopy" class="page-link-copy plus-copy"><img class="page-link-plus" src="./plus-icon.png" alt="Plus" width="256" height="256" loading="lazy" decoding="async" /></div>\n          </a>`;
  const replacement=existing+`\n          <a id="homeKlaverjasLiveEntry" class="page-link-card scorer-link feature-primary" href="./score.html" data-default-href="./score.html">\n            <div class="page-link-label">Klaverjas live</div>\n            <div class="page-link-copy">Start een live pot en houd de tussenstand bij.</div>\n          </a>`;
  html=mustReplace(html,existing,replacement,'homepage Klaverjas scorer card');
  html=mustReplace(
    html,
    `document.querySelectorAll('a[href="./request.html"],a[href="./login.html"],a[href="./profiles.html"],a[href="./scorer.html"],a[href="./toepen.html"],a[href="./klaverjas_online.html"],a[href="./boerenbridge.html"],a[href="./admin.html"]')`,
    `document.querySelectorAll('a[href="./request.html"],a[href="./login.html"],a[href="./profiles.html"],a[href="./scorer.html"],a[href="./score.html"],a[href="./toepen.html"],a[href="./klaverjas_online.html"],a[href="./boerenbridge.html"],a[href="./admin.html"]')`,
    'family scope navigation selector'
  );
}
fs.writeFileSync(indexPath,html,'utf8');

const regression=`#!/usr/bin/env node\nimport fs from 'node:fs';\nconst html=fs.readFileSync('index.html','utf8');\nconst score=fs.readFileSync('score.html','utf8');\nfunction need(text,needle,label){if(!text.includes(needle)){console.error('FAIL:',label);process.exit(1);}}\nneed(html,'id="homeKlaverjasEntry"','existing round scorer entry remains');\nneed(html,'href="./scorer.html"','existing round scorer route remains');\nneed(html,'id="homeKlaverjasLiveEntry"','separate homepage live entry exists');\nneed(html,'href="./score.html"','homepage live entry routes through score alias');\nneed(html,'a[href="./score.html"]','family scope chrome includes live scorer alias');\nneed(score,"new URL('./klaverjas_scorer_v596_repo_ready.html',location.href)",'score alias still redirects to live-capable scorer');\nconsole.log('Homepage Klaverjas live entry v766 regression PASS');\n`;
fs.writeFileSync('check-home-klaverjas-live-entry-v766.mjs',regression,'utf8');

const pkgPath='package.json';
const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
const check='node check-home-klaverjas-live-entry-v766.mjs';
if(!String(pkg.scripts?.['verify:static']||'').includes(check)) pkg.scripts['verify:static']+=` && ${check}`;
fs.writeFileSync(pkgPath,JSON.stringify(pkg,null,2)+'\n','utf8');
fs.writeFileSync('VERSION','v766\n','utf8');
console.log('Applied v766 homepage Klaverjas live entry and version bump.');
