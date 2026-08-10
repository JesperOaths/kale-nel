#!/usr/bin/env node
import fs from 'node:fs';
const data=JSON.parse(fs.readFileSync('V785_DIAGNOSTIC_RESULTS.json','utf8'));
const lines=[];
for(const [key,page] of Object.entries(data.pages||{})){
  lines.push(`PAGE ${key} doc=${page.docWidth}/${page.viewportWidth}`);
  for(const violation of page.violations||[]){
    lines.push(`  VIOLATION ${violation.id} ${violation.impact} nodes=${violation.nodes.length}`);
    for(const node of violation.nodes){
      const c=node.computed||{};
      lines.push(`    target=${JSON.stringify(node.target)} tag=${c.tag||''} id=${c.id||''} class=${c.className||''} text=${JSON.stringify(c.text||'')} color=${c.color||''} bg=${c.backgroundColor||''} font=${c.fontSize||''}/${c.fontWeight||''}`);
      lines.push(`      html=${JSON.stringify(String(node.html||'').replace(/\s+/g,' ').slice(0,260))}`);
      lines.push(`      failure=${JSON.stringify(String(node.failureSummary||'').replace(/\s+/g,' ').slice(0,300))}`);
    }
  }
  if(key==='rad' || (page.docWidth||0)>(page.viewportWidth||0)+2){
    lines.push(`  OVERFLOW count=${(page.overflow||[]).length}`);
    for(const x of page.overflow||[]) lines.push(`    tag=${x.tag} id=${x.id||''} class=${x.className||''} left=${Math.round(x.left)} right=${Math.round(x.right)} width=${Math.round(x.width)} display=${x.display} position=${x.position} minWidth=${x.minWidth} maxWidth=${x.maxWidth} whiteSpace=${x.whiteSpace} parent=${JSON.stringify(x.parent)} text=${JSON.stringify(x.text||'')}`);
  }
}
lines.push(`BLOCKED_WRITES ${data.blockedWrites}`);
fs.writeFileSync('V785_DIAGNOSTIC_SUMMARY.txt',lines.join('\n')+'\n');
console.log('V785 diagnostic summary written.');
