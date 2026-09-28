#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, subprocess
p=Path('/opt/inbox-triage-agent/triage_agent.py')
s=p.read_text(encoding='utf-8')
old_default='DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"'
old_fallback='FALLBACK_GEMINI_MODELS = ["gemini-3.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"]'
new_default='DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite"'
new_fallback='FALLBACK_GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"]'
changed=False
if old_default in s:
    s=s.replace(old_default,new_default,1);changed=True
elif new_default not in s:
    raise SystemExit('gemini_default_anchor_missing')
if old_fallback in s:
    s=s.replace(old_fallback,new_fallback,1);changed=True
elif new_fallback not in s:
    # tolerate another old fallback list by replacing the assignment line.
    lines=s.splitlines()
    found=False
    for i,line in enumerate(lines):
        if line.startswith('FALLBACK_GEMINI_MODELS = '):
            lines[i]=new_fallback;found=True;changed=True;break
    if not found: raise SystemExit('gemini_fallback_anchor_missing')
    s='\n'.join(lines)+'\n'
if changed:
    stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    shutil.copy2(p,p.with_name(p.name+f'.before-v868-gemini-models-{stamp}'))
    p.write_text(s,encoding='utf-8')
subprocess.run(['/opt/inbox-triage-agent/.venv/bin/python','-m','py_compile',str(p)],check=True)
print('PATCHED='+str(changed).lower())
print(new_default)
print(new_fallback)
print('RESULT=GEMINI_MODELS_V868_PATCHED')
