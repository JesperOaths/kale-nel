#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const sourcePath='scripts/audit-v789-rules-acceptance.mjs';
const tempPath='scripts/.audit-v790-rules-runtime.mjs';
let source=fs.readFileSync(sourcePath,'utf8');
const old="    await page.locator('#drawerCloseBtn').click();";
const replacement="    await page.evaluate(()=>document.querySelector('#drawerCloseBtn')?.click());\n    await page.waitForFunction(()=>!document.querySelector('#mobileDrawer')?.classList.contains('show'),{timeout:3000});";
const count=source.split(old).length-1;
if(count!==2) throw new Error(`Expected exactly two Paardenrace drawer cleanup clicks, got ${count}`);
source=source.split(old).join(replacement);
source=source.replaceAll('AUDIT_V789_RULES','AUDIT_V790_RULES');
fs.writeFileSync(tempPath,source,'utf8');
try{
  const result=spawnSync(process.execPath,[tempPath],{stdio:'inherit',env:process.env});
  process.exitCode=result.status??1;
} finally {
  try{fs.unlinkSync(tempPath);}catch{}
}
