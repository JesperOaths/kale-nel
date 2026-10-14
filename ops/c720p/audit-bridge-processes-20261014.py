#!/usr/bin/env python3
"""Fast bounded /tmp and user cache disk inventory without touching media."""
from pathlib import Path
import os,subprocess
def call(a,timeout=12):
 try:
  p=subprocess.run(a,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout)
  print('CMD',a[:3],'RC',p.returncode,'STDOUT',p.stdout[:7000],'STDERR',p.stderr[-250:])
 except Exception as e:print('CMD_ERROR',a[:3],type(e).__name__)
def top(root,limit=25):
 r=[]
 try:
  for p in Path(root).iterdir():
   if p.is_symlink():continue
   try:
    st=p.stat()
    if p.is_file():r.append((st.st_size,p.name,'file'))
    elif p.is_dir():
     # Top-level dirs are sized separately by bounded du below.
     r.append((0,p.name,'directory'))
   except OSError:pass
 except OSError:pass
 print('TOP_DIRECT',root,sorted(r,reverse=True)[:limit])
print('START')
call(['df','-h','/'])
top('/tmp',60)
top('/home/jespern/.cache',30)
call(['du','-x','-m','--max-depth=1','/tmp'],12)
call(['du','-x','-m','--max-depth=1','/home/jespern/.cache'],12)
call(['du','-x','-m','--max-depth=1','/home/jespern/c720p-home-hub/build'],12)
print('END')
