const {execFileSync}=require('child_process');
const crypto=require('crypto');
const fs=require('fs');
const root='deployment_forensics_v761';
for (const f of ['VERSION','index.html','boerenbridge_vault.html','toepen.html','gejast-config.js','admin-session-sync.js','admin-gate-v105.js']) {
  const buf=execFileSync('git',['show',`HEAD:${f}`]);
  const sha=crypto.createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(`${root}/git_HEAD_${f.replace(/[\\/]/g,'_')}.body`, buf);
  console.log(`${f} gitHEAD bytes=${buf.length} sha256=${sha}`);
}
