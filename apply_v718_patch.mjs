import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const targetVersion = 'v718';
const repairScript = 'gejast-v718-repair.js';
function file(name){ return path.join(root, name); }
function read(name){ return fs.existsSync(file(name)) ? fs.readFileSync(file(name), 'utf8') : ''; }
function write(name, text){ fs.writeFileSync(file(name), text); console.log('patched', name); }

write('VERSION', `${targetVersion}\n`);

for (const name of ['gejast-config.js','pikken.html','pikken_live.html','paardenrace.html','paardenrace_live.html']) {
  let text = read(name);
  if (!text) continue;
  text = text.replace(/GEJAST_PAGE_VERSION='v\d+'/g, `GEJAST_PAGE_VERSION='${targetVersion}'`)
             .replace(/GEJAST_PAGE_VERSION="v\d+"/g, `GEJAST_PAGE_VERSION="${targetVersion}"`)
             .replace(/VERSION:'v\d+'/g, `VERSION:'${targetVersion}'`)
             .replace(/\?v\d+/g, `?${targetVersion}`)
             .replace(/v\d+\s*-\s*Made by Bruis/g, `${targetVersion} - Made by Bruis`);
  write(name, text);
}

let cfg = read('gejast-config.js');
if (cfg) {
  const loader = `\n  function loadV718RepairRuntime(){\n    try {\n      if (document.querySelector('script[data-gejast-v718-repair]')) return;\n      const s = document.createElement('script');\n      s.src = './${repairScript}?' + encodeURIComponent((window.GEJAST_CONFIG && window.GEJAST_CONFIG.VERSION) || '${targetVersion}');\n      s.defer = true;\n      s.setAttribute('data-gejast-v718-repair','');\n      (document.head || document.documentElement).appendChild(s);\n    } catch (_) {}\n  }\n  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadV718RepairRuntime, { once:true }); else loadV718RepairRuntime();\n`;
  if (!cfg.includes('data-gejast-v718-repair')) {
    const marker = /\}\)\(\);\s*$/;
    cfg = marker.test(cfg) ? cfg.replace(marker, loader + '\n})();') : (cfg + loader);
    write('gejast-config.js', cfg);
  }
}

// Hard-hide direct join controls in source too. The runtime also enforces this.
let pikken = read('pikken.html');
if (pikken) {
  pikken = pikken.replace(/<div class="field" id="pkJoinFieldWrap">/g, '<div class="field hidden" id="pkJoinFieldWrap">')
                 .replace(/<div id="pkJoinWrap"/g, '<div id="pkJoinWrap" class="hidden"')
                 .replace(/class="hidden" class=/g, 'class=');
  write('pikken.html', pikken);
}
let paarden = read('paardenrace.html');
if (paarden) {
  paarden = paarden.replace(/<div class="field">\s*<label>Roomcode<\/label>/, '<div class="field hidden">\n              <label>Roomcode</label>')
                   .replace(/<button class="btn alt" id="joinBtn" type="button">Join room<\/button>/g, '<button class="btn alt hidden" id="joinBtn" type="button">Join room</button>')
                   .replace(/Maak of join een room\./g, 'Maak een room of join via de knop op een zichtbare lobbykaart.');
  write('paardenrace.html', paarden);
}

console.log('v718 patch applied. Upload gejast-v718-repair.js too, then run the separate SQL file in Supabase.');
