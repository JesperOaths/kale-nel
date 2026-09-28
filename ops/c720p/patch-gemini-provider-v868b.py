#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, subprocess
p=Path('/opt/inbox-triage-agent/triage_agent.py')
s=p.read_text(encoding='utf-8')
lines=s.splitlines()
changed=False
for i,line in enumerate(lines):
    if line.startswith('DEFAULT_GEMINI_MODEL = '):
        new='DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"'
        if line!=new: lines[i]=new; changed=True
    elif line.startswith('FALLBACK_GEMINI_MODELS = '):
        new='FALLBACK_GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.1-flash-lite"]'
        if line!=new: lines[i]=new; changed=True
s='\n'.join(lines)+'\n'
if changed:
    stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    shutil.copy2(p,p.with_name(p.name+f'.before-v868b-gemini-provider-{stamp}'))
    p.write_text(s,encoding='utf-8')
subprocess.run(['/opt/inbox-triage-agent/.venv/bin/python','-m','py_compile',str(p)],check=True)
for line in p.read_text(encoding='utf-8').splitlines():
    if line.startswith(('DEFAULT_GEMINI_MODEL = ','FALLBACK_GEMINI_MODELS = ')):
        print(line)
print('PROGRESS_CACHE_PRESENT='+str('C720P_V868_GEMINI_PROGRESS_CACHE' in p.read_text(encoding='utf-8')).lower())
print('RESULT=GEMINI_PROVIDER_V868B_PATCHED')
