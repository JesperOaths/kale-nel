#!/usr/bin/env python3
"""Checksum-verifiable migration of old C720P /tmp build evidence to S9+ microSD.
Never removes originals before complete remote verification.
"""
import hashlib,json,os,shlex,shutil,subprocess,tarfile,time,urllib.request
from pathlib import Path
PHONE='192.168.178.250:5555'
SD='/storage/9C33-6BBD/c720p-offloaded-build-evidence-20261014'
ITEMS=[
 '/tmp/s9-v31-reproducible-build-backup.tar.gz',
 '/tmp/s9-v31-benchmark-cache-backup',
 '/tmp/s9-joined-preroll-v1',
]
def adb(*args,timeout=35):
 p=subprocess.run(['adb','-s',PHONE,*args],text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError('adb_command_failed_'+str(args[0])+'_'+p.stderr[-160:])
 return p.stdout.strip()
def status():
 with urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=8) as r:return json.load(r)
def healthy():
 s=status()
 return (s.get('ok') is True and s.get('mode')=='watching'
         and s.get('garden_person_gate_ready') is True
         and float(s.get('temperature_c',100))<=36.3
         and int(s.get('sd_free_bytes') or 0)>45*1024**3
         and int(s.get('last_frame_age_ms') or 999999)<2000),s
def in_use(path):
 # Fail closed when a running process refers to a source subtree by cmdline.
 name=str(path).encode()
 try:
  for pid in Path('/proc').iterdir():
   if not pid.name.isdecimal():continue
   try:
    if name in (pid/'cmdline').read_bytes()[:16000]:return True
    if (pid/'cwd').is_symlink() and str((pid/'cwd').resolve()).startswith(str(path)):return True
   except OSError:continue
 except OSError:return True
 return False
def acceptable(source):
 p=Path(source)
 if not p.exists() or p.is_symlink() or not str(p).startswith('/tmp/s9-'):
  return False,'not_found_or_wrong_path'
 if time.time()-p.stat().st_mtime<4*3600:return False,'not_yet_stale'
 if in_use(p):return False,'referenced_by_active_process'
 if p.is_dir():
  total=0
  for root,dirs,files in os.walk(p,followlinks=False):
   if any((Path(root)/d).is_symlink() for d in dirs):return False,'symlink_found'
   for name in files:
    file=Path(root)/name
    if file.is_symlink() or not file.is_file():return False,'non_regular_file'
    total+=file.stat().st_size
    if total>500*1024**2:return False,'unexpected_volume'
  if total<35*1024**2:return False,'not_expected_archive_size'
 elif p.is_file():
  if not 20*1024**2<=p.stat().st_size<=160*1024**2:
   return False,'unexpected_archive_size'
 else:return False,'not_regular'
 return True,'ready'
class HashSink:
 def __init__(self,stream):self.stream=stream;self.hash=hashlib.sha256();self.size=0
 def write(self,b):
  if not b:return 0
  self.hash.update(b);self.size+=len(b)
  self.stream.write(b)
  return len(b)
 def flush(self):self.stream.flush()
def remote_exists(path):
 p=subprocess.run(['adb','-s',PHONE,'shell','test','-e',path],capture_output=True,timeout=12)
 return p.returncode==0
def digest_remote(path):
 value=adb('shell','sha256sum',path,timeout=70)
 return value.split()[0] if value else ''
def offload(p):
 final=SD+'/'+p.name+('.tar' if p.is_dir() else '')
 part=final+'.part'
 if p.is_file():
  digest=hashlib.sha256()
  with p.open('rb') as f:
   for buf in iter(lambda:f.read(1024*1024),b''):digest.update(buf)
  expect=digest.hexdigest()
  if remote_exists(final):
   if digest_remote(final)!=expect:raise RuntimeError('remote_archive_conflicts_with_local')
   n=p.stat().st_size;p.unlink()
   return {'name':p.name,'result':'already_verified_on_SD_source_released','bytes_reclaimed':n}
  adb('push',str(p),part,timeout=210)
  if digest_remote(part)!=expect:raise RuntimeError('archive_readback_mismatch')
  adb('shell','mv',part,final)
  if digest_remote(final)!=expect:raise RuntimeError('final_archive_readback_mismatch')
  previous=p.stat().st_size
  p.unlink()
  return {'name':p.name,'result':'verified_offload','bytes_reclaimed':previous,'sha256':expect,'sd_location':final}
 # Stream the tar directly into SD. This never creates another local 224MB file.
 if remote_exists(final):raise RuntimeError('remote_archived_tar_already_exists_no_overwrite')
 proc=subprocess.Popen(['adb','-s',PHONE,'exec-in','sh','-c',
      'cat > '+shlex.quote(part)],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 sink=HashSink(proc.stdin)
 try:
  with tarfile.open(fileobj=sink,mode='w|') as tar:
   tar.add(str(p),arcname=p.name,recursive=True)
  proc.stdin.close()
  error=proc.stderr.read()[-350:]
  code=proc.wait(timeout=240)
  if code:raise RuntimeError('adb_stream_failed_'+str(code)+'_'+error.decode(errors='replace'))
 except BaseException:
  try:proc.kill()
  except OSError:pass
  raise
 expect=sink.hash.hexdigest()
 if digest_remote(part)!=expect:raise RuntimeError('tar_sha256_did_not_match_phone')
 adb('shell','mv',part,final)
 if digest_remote(final)!=expect:raise RuntimeError('tar_final_sha256_mismatch')
 size=sink.size
 # The verified tar includes the entire source directory; only then remove it.
 shutil.rmtree(p)
 return {'name':p.name,'result':'verified_offload','bytes_reclaimed_estimate':size,
         'sha256':expect,'sd_location':final}
def main():
 report={'operation':'S9_SD_verified_offload_not_camera','results':[],
         'recordings_deleted':False,'models_deleted':False,'camera_apk_modified':False}
 report['disk_free_before']=shutil.disk_usage('/').free
 for source in ITEMS:
  can,s=healthy()
  if not can:
   report['results'].append({'source':source,'skipped':'camera_hot_or_unavailable',
    'temperature_c':s.get('temperature_c'),'mode':s.get('mode')});break
  p=Path(source)
  okay,why=acceptable(source)
  if not okay:
   report['results'].append({'source':source,'skipped':why});continue
  try:
   adb('shell','mkdir','-p',SD)
   result=offload(p)
   report['results'].append(result)
  except Exception as error:
   report['results'].append({'source':source,'failed':str(error)[:200]})
   # Do not continue transfer if an error may indicate SD corruption.
   break
 report['disk_free_after']=shutil.disk_usage('/').free
 report['bytes_freed']=report['disk_free_after']-report['disk_free_before']
 print('C720P_S9_OFFLOAD_VERIFIED '+json.dumps(report,sort_keys=True),flush=True)
if __name__=='__main__':main()
