from pathlib import Path
p=Path('check-finalized-baseline-v786.mjs')
s=p.read_text()
old="""const gaps=Array.isArray(readiness.beta_gaps)?readiness.beta_gaps:[];
const completeCount=gaps.filter(item=>item.status==='verified_complete').length;
const permissionCount=gaps.filter(item=>item.status==='needs_permission').length;
const blockedCount=gaps.filter(item=>item.status==='blocked_external').length;
if(gaps.length!==12||completeCount!==12||permissionCount!==0||blockedCount!==0) failures.push('finalized readiness must stay 12/12 with zero permission-gated/blocked gaps');
"""
new="""const gaps=Array.isArray(readiness.beta_gaps)?readiness.beta_gaps:[];
const completeCount=gaps.filter(item=>item.status==='verified_complete').length;
const permission=gaps.filter(item=>item.status==='needs_permission');
const permissionIds=permission.map(item=>item.id).sort();
const blockedCount=gaps.filter(item=>item.status==='blocked_external').length;
if(rootN===786){
  if(gaps.length!==12||completeCount!==12||permission.length!==0||blockedCount!==0) failures.push('exact v786 freeze must preserve its historical 12/12 zero-blocker readiness');
}else if(rootN>786){
  if(gaps.length!==12||completeCount!==11||JSON.stringify(permissionIds)!==JSON.stringify(['toepen_backend_live'])||blockedCount!==0) failures.push('newer current readiness must preserve historical v786 facts while exposing exactly the live-proven Toepen v801a permission blocker');
  const toepen=gaps.find(item=>item.id==='toepen_backend_live');
  if(!/v801a/i.test(String(toepen?.next_action||''))) failures.push('current Toepen blocker must identify v801a before finalized-baseline guard accepts the open readiness state');
}
"""
if old not in s:
    raise SystemExit('v786 readiness block not found')
p.write_text(s.replace(old,new,1))
