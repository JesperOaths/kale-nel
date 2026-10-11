#!/usr/bin/env python3
"""Show the C720P local pre-roll checker result in Today and Evidence.
No ChatGPT automation, no camera calls, and no archive modifications.
"""
import datetime,json,os,pathlib
ROOT=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new")
PAGE=ROOT/"security-review-v8.html"
STATUS=ROOT/"preroll-validation.json"
BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups/security-preroll-verified-ui")
MARKER="s9v8-preroll-local-verification"
STYLE=r"""<style id="s9v8-preroll-local-verification">
#s9v8-preroll-status{border:1px solid #3b5b62;background:#16313b;padding:10px 13px;border-radius:9px;font-size:12px;color:#bdd9e2;margin-top:8px}
#s9v8-preroll-status strong{color:#dff9f0}
</style>"""
SCRIPT=r"""<script id="s9v8-local-preroll-status-script">
(()=>{
const target=document.getElementById('s9v8-preroll-status');
if(!target)return;
async function refresh(){
 try{
  const response=await fetch('/local/frontyard-security-new/preroll-validation.json',{cache:'no-store',credentials:'same-origin'});
  if(!response.ok)throw new Error('status_unavailable');
  const d=await response.json();
  target.replaceChildren();
  const strong=document.createElement('strong');
  strong.textContent='Pre-motion verification: ';
  target.append(strong);
  const detail=document.createTextNode(
   d.verified
   ? ('4K + '+Number(d.buffer?.duration_s||0).toFixed(1)+' s pre-roll verified on S9+ · '+String(d.clip||''))
   : d.status==='awaiting_new_person_event'
    ? 'Waiting for the next genuine person-triggered recording. RAM buffer remains independent.'
    : d.status==='new_event_waiting_for_preroll'
     ? 'A new recording exists; pre-roll file has not yet been verified.'
     : 'Local checker: '+String(d.status||'unknown')
  );
  target.append(detail);
  target.title='Checked '+String(d.checked_at||'unknown time')+' · read-only C720P systemd timer every five minutes';
 }catch(_){
  target.textContent='Pre-motion verification: local status temporarily unavailable';
 }
}
refresh();
setInterval(()=>{if(!document.hidden)refresh()},300000);
})();
</script>"""
def main():
 if not PAGE.is_file() or PAGE.is_symlink():raise RuntimeError("security_page_unavailable")
 if not STATUS.is_file():raise RuntimeError("local_verification_status_missing")
 status=json.loads(STATUS.read_text())
 if "test_recording_triggered" not in status:raise RuntimeError("not_local_watcher_status")
 old=PAGE.read_text()
 if MARKER in old:
  print("S9_PREROLL_LOCAL_UI_ALREADY_INSTALLED");return
 if old.count('id="sync"')!=1 or old.count("</head>")!=1 or old.count("</body>")!=1:
  raise RuntimeError("page_source_unrecognized")
 new=old.replace("</head>",STYLE+"</head>",1)
 new=new.replace('<div id="sync" role="status">','<div id="s9v8-preroll-status" role="status">Loading local pre-motion verification…</div><div id="sync" role="status">',1)
 new=new.replace("</body>",SCRIPT+"</body>",1)
 BACK.mkdir(parents=True,exist_ok=True)
 name=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".html"
 backup=BACK/name;backup.write_text(old)
 temp=PAGE.with_name(PAGE.name+".local-preroll-stage")
 try:
  temp.write_text(new);temp.chmod(PAGE.stat().st_mode&0o777)
  os.replace(temp,PAGE)
  live=PAGE.read_text()
  if MARKER not in live or "preroll-validation.json" not in live:
   raise RuntimeError("invalid_live_postinstall")
  print("S9_C720P_LOCAL_PREROLL_STATUS_VISIBLE",json.dumps({
   "status":status.get("status"),"verification_timer":"systemd 5 minutes",
   "page":str(PAGE),"originals_changed":False,"backup":str(backup)},sort_keys=True))
 except Exception:
  PAGE.write_text(old)
  raise
 finally:temp.unlink(missing_ok=True)
if __name__=="__main__":main()
