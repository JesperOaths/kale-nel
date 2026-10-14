#!/usr/bin/env python3
"""Bounded, non-media, non-backup C720P disk reclaim for a nearly full hub."""
import json,os,subprocess,shutil,stat,time
from pathlib import Path
HOME=Path('/home/jespern')
TARGETS=[
 HOME/'.cache/pip',
 HOME/'.cache/uv',
 HOME/'.cache/chromium-headless/Default/Cache',
 HOME/'.cache/chromium-headless/Default/Code Cache',
 HOME/'.cache/chromium-headless/Default/GPUCache',
]
def usage():return shutil.disk_usage('/').free
def running_program(term):
 try:
  for p in Path('/proc').iterdir():
   if not p.name.isdigit():continue
   try:c=(p/'cmdline').read_bytes()[:4096].lower()
   except OSError:continue
   if term in c:return True
 except OSError:return True
 return False
def bounded_size(path,limit=850*1024**2):
 total=0
 for root,dirs,files in os.walk(path,followlinks=False):
  dirs[:]=[d for d in dirs if not (Path(root)/d).is_symlink()]
  for name in files:
   f=Path(root)/name
   if f.is_symlink():continue
   try:total+=f.stat().st_size
   except OSError:pass
   if total>limit: return None
 return total
def safe_dir(p,root):
 if not p.exists():return False
 if p.is_symlink() or not p.is_dir() or root.is_symlink():return False
 return p.resolve().is_relative_to(root.resolve())
def run(cmd,seconds):
 try:
  p=subprocess.run(cmd,capture_output=True,text=True,timeout=seconds)
  return {'returncode':p.returncode,'stderr':p.stderr[-140:]}
 except Exception as e:return {'error':type(e).__name__}
def main():
 before=usage()
 report={'version':'c720p_nonmedia_relief_v1',
         'free_before_mb':round(before/1048576,1),'changes':[],
         'video_deleted':False,'backups_deleted':False,
         'models_deleted':False,'services_stopped':False}
 for p in TARGETS:
  if usage()>900*1024**2:break
  if '/chromium-headless/' in str(p) and running_program(b'chromium-headless'):
   report['changes'].append({'path':str(p),'status':'browser_active_skipped'});continue
  if p.name in ('pip','uv') and running_program(b' pip '):
   report['changes'].append({'path':str(p),'status':'package_tool_active_skipped'});continue
  root=HOME/'.cache'
  if not safe_dir(p,root):continue
  size=bounded_size(p)
  if size is None:
   report['changes'].append({'path':str(p),'status':'unexpectedly_large_skipped'});continue
  try:
   shutil.rmtree(p)
   if not p.exists():report['changes'].append({'path':str(p),'freed_estimate_mb':round(size/1048576,1),'status':'removed_regenerable_cache'})
  except OSError as e:report['changes'].append({'path':str(p),'status':type(e).__name__})
 if usage()<900*1024**2:
  report['journal']=run(['sudo','-n','journalctl','--vacuum-size=35M'],20)
  report['apt']=run(['sudo','-n','apt-get','clean'],20)
 # Cap runaway ADB daemon's diagnostic log in-place, retaining the tail and
 # current inode so an already-open logger can keep writing.
 log=Path('/tmp/adb.1000.log')
 try:
  st=log.lstat()
  if (stat.S_ISREG(st.st_mode) and not log.is_symlink() and st.st_uid==os.getuid()
      and 24*1024**2<st.st_size<120*1024**2):
   with open(log,'r+b',buffering=0) as f:
    f.seek(-2*1024**2,os.SEEK_END)
    tail=f.read(2*1024**2)
    f.seek(0);f.write(tail);f.truncate(len(tail))
   report['changes'].append({'path':'/tmp/adb.1000.log','status':'log_tail_preserved','freed_estimate_mb':round((st.st_size-len(tail))/1048576,1)})
 except OSError as e:
  report['changes'].append({'path':'/tmp/adb.1000.log','status':'skipped_'+type(e).__name__})
 report['free_after_mb']=round(usage()/1048576,1)
 report['reclaimed_mb']=round((usage()-before)/1048576,1)
 # Read only bounded status metadata, never camera payloads or personal files.
 for pid in (2171173,3382983,1749396,1749205):
  p=Path('/proc')/str(pid)
  try:
   command=(p/'cmdline').read_bytes()[:500].replace(b'\0',b' ').decode(errors='replace')
   report.setdefault('largest_processes',[]).append({'pid':pid,'command':command[:220]})
  except OSError:pass
 print('C720P_SAFE_DISK_RELIEF '+json.dumps(report,sort_keys=True),flush=True)
if __name__=='__main__':main()
