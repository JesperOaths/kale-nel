#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const workflowDir = '.github/workflows';
const changed = [];
for (const name of fs.readdirSync(workflowDir)) {
  if (!/\.ya?ml$/i.test(name)) continue;
  const file = path.join(workflowDir, name);
  const before = fs.readFileSync(file, 'utf8');
  const after = before
    .replace(/actions\/checkout@v[1-4]\b/g, 'actions/checkout@v5')
    .replace(/actions\/setup-node@v[1-4]\b/g, 'actions/setup-node@v5');
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    changed.push(file.replaceAll('\\', '/'));
  }
}

const regressionLines = [
  '#!/usr/bin/env node',
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  '',
  "const dir='.github/workflows';",
  'const failures=[];',
  'let files=0;',
  'for(const name of fs.readdirSync(dir)){',
  '  if(!/\\.ya?ml$/i.test(name)) continue;',
  '  files+=1;',
  '  const file=path.join(dir,name);',
  "  const text=fs.readFileSync(file,'utf8');",
  '  for(const match of text.matchAll(/actions\\\/(checkout|setup-node)@v([1-4])\\b/g)){',
  "    failures.push(file+': '+match[0]);",
  '  }',
  '}',
  'if(failures.length){',
  "  console.error('Deprecated GitHub action runtime pins found:');",
  "  failures.forEach((item)=>console.error('- '+item));",
  '  process.exit(1);',
  '}',
  "console.log('GitHub action Node24-runtime pin regression PASS. Workflows checked='+files+'.');",
  '',
];
fs.writeFileSync('check-github-actions-node24-runtime.mjs', regressionLines.join('\n'), 'utf8');

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const check = 'node check-github-actions-node24-runtime.mjs';
if (!String(pkg.scripts?.['verify:static'] || '').includes(check)) {
  pkg.scripts['verify:static'] = `${pkg.scripts['verify:static']} && ${check}`;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

console.log(`Migrated old checkout/setup-node major pins in ${changed.length} workflow file(s).`);
changed.forEach((file)=>console.log(`- ${file}`));
