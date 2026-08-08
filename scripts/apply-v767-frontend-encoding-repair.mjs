#!/usr/bin/env node
import fs from 'node:fs';

const scorerPath = 'scorer.html';
let scorer = fs.readFileSync(scorerPath, 'utf8');
const replacements = [
  ['â™£', '♣'],
  ['â™¥', '♥'],
  ['â™ ', '♠'],
  ['â™¦', '♦'],
  ['??n', 'één'],
];
for (const [from, to] of replacements) {
  if (!scorer.includes(from)) throw new Error(`Expected scorer corruption not found: ${from}`);
  scorer = scorer.replaceAll(from, to);
}
for (const [from] of replacements) {
  if (scorer.includes(from)) throw new Error(`Scorer corruption remains after repair: ${from}`);
}
fs.writeFileSync(scorerPath, scorer, 'utf8');

const regression = `#!/usr/bin/env node\nimport fs from 'node:fs';\nimport path from 'node:path';\n\nconst root=process.cwd();\nconst activeExt=new Set(['.html','.js','.css']);\nconst ignoredDirs=new Set(['.git','node_modules','dist','build','.next','.vercel','coverage','tmp','temp','patch_bundles','repo','mnt']);\nconst forbidden=[/�/g,/â[^\\s]/g,/Ã[^\\s]/g,/Â[^\\s]/g,/ï»¿/g,/\\?\\?n\\b/g];\nfunction walk(dir,out=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isDirectory()){if(!ignoredDirs.has(e.name))walk(path.join(dir,e.name),out);}else out.push(path.join(dir,e.name));}return out;}\nfunction archived(rel){const base=path.basename(rel);return /_(?:v\\d+|orig)\\.html$/i.test(base)||/^README_v\\d+/i.test(base)||/^PATCH_NOTES_v\\d+/i.test(base)||/^GEJAST_v\\d+/i.test(base);}\nconst failures=[];\nfor(const file of walk(root)){const rel=path.relative(root,file).replaceAll('\\\\','/');if(!activeExt.has(path.extname(file).toLowerCase())||archived(rel))continue;const text=fs.readFileSync(file,'utf8');const lines=text.split(/\\r?\\n/);lines.forEach((line,i)=>{for(const re of forbidden){re.lastIndex=0;if(re.test(line)){failures.push(\\`\${rel}:\${i+1}: \${line.trim()}\\`);break;}}});}\nif(failures.length){console.error('Active frontend encoding corruption found:');failures.forEach(x=>console.error('- '+x));process.exit(1);}\nconst scorer=fs.readFileSync('scorer.html','utf8');\nfor(const suit of ['♣','♥','♠','♦']){if(!scorer.includes(suit)){console.error('Missing repaired suit '+suit);process.exit(1);}}\nif(!scorer.includes('Elke naam mag maar één keer gebruikt worden.')){console.error('Repaired setup copy missing');process.exit(1);}\nconsole.log('Active frontend encoding regression PASS.');\n`;
fs.writeFileSync('check-active-frontend-encoding-v767.mjs', regression, 'utf8');

const packagePath='package.json';
const pkg=JSON.parse(fs.readFileSync(packagePath,'utf8'));
const check='node check-active-frontend-encoding-v767.mjs';
if(!String(pkg.scripts?.['verify:static']||'').includes(check)) pkg.scripts['verify:static'] += ` && ${check}`;
fs.writeFileSync(packagePath, JSON.stringify(pkg,null,2)+'\n','utf8');
fs.writeFileSync('VERSION','v767\n','utf8');
console.log('Applied v767 active scorer encoding repair and release bump.');
