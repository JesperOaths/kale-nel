#!/usr/bin/env python3
from pathlib import Path
import shutil, time

p=Path("/opt/inbox-triage-agent/triage_agent.py")
s=p.read_text(encoding="utf-8")
old1='DEFAULT_OPENAI_MODEL = "gpt-5-mini"'
new1='DEFAULT_OPENAI_MODEL = "gpt-5.6-luna"'
old2='FALLBACK_OPENAI_MODELS = ["gpt-5-mini", "gpt-4.1-mini"]'
new2='FALLBACK_OPENAI_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]'
if new1 not in s:
    if old1 not in s:
        raise SystemExit("default_model_anchor_missing")
    s=s.replace(old1,new1,1)
if new2 not in s:
    if old2 not in s:
        raise SystemExit("fallback_model_anchor_missing")
    s=s.replace(old2,new2,1)
backup=p.with_name(p.name+".pre-v869-current-models")
if not backup.exists():
    shutil.copy2(p,backup)
p.write_text(s,encoding="utf-8")
print("DEFAULT_OK="+str(new1 in s).lower())
print("FALLBACK_OK="+str(new2 in s).lower())
print("RESULT=TRIAGE_GPT56_V869_APPLIED")
