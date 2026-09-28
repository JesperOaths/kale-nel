#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, subprocess

P=Path('/opt/inbox-triage-agent/triage_agent.py')
s=P.read_text(encoding='utf-8')
orig=s

# Keep the currently responsive provider first and stop burning time/quota on
# known-retired or quota-exhausted fallback aliases during this run.
lines=s.splitlines()
for i,line in enumerate(lines):
    if line.startswith('DEFAULT_GEMINI_MODEL = '):
        lines[i]='DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"'
    if line.startswith('FALLBACK_GEMINI_MODELS = '):
        lines[i]='FALLBACK_GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.1-flash-lite"]'
s='\n'.join(lines)+'\n'

anchor='''    models = [requested_model] + [m for m in configured_fallbacks if m != requested_model]\n'''
insert='''    models = [requested_model] + [m for m in configured_fallbacks if m != requested_model]\n    # C720P_V868_GEMINI_PROGRESS_CACHE: successful classifications survive a\n    # later provider timeout/quota deferral, so the next retry resumes forward\n    # instead of spending quota re-triaging the same messages.\n    import hashlib as _hashlib\n    cache_dir = Path("/home/jespern/c720p-home-hub/state/inbox-triage-ai-cache")\n    cache_dir.mkdir(parents=True, exist_ok=True)\n    cache_key = _hashlib.sha256(\n        (str(email_item.account)+"\\0"+str(email_item.message_id)).encode("utf-8","replace")\n    ).hexdigest()\n    cache_file = cache_dir / (cache_key + ".json")\n    required = {\n        "category", "importance", "show", "reason", "summary", "suggested_reply",\n        "reply_needed", "calendar_needed", "risk_notes",\n    }\n    try:\n        cached = json.loads(cache_file.read_text(encoding="utf-8"))\n        if isinstance(cached, dict) and required.issubset(cached):\n            print(f"{email_item.account}: Gemini cache hit for {email_item.message_id}", flush=True)\n            return cached\n    except Exception:\n        pass\n'''
if 'C720P_V868_GEMINI_PROGRESS_CACHE' not in s:
    if anchor not in s: raise SystemExit('models_anchor_missing')
    s=s.replace(anchor,insert,1)

# Two attempts on the selected model; a slow response on this C720P should not
# instantly force the entire digest into another multi-hour deferral.
s=s.replace('''        for attempt in range(1):\n            try:\n                r = requests.post(''',
            '''        for attempt in range(2):\n            try:\n                r = requests.post(''',1)
s=s.replace('''                    timeout=(8, 18),\n''','''                    timeout=(8, 35),\n''',1)
s=s.replace('''            if attempt == 0 and False:\n                time.sleep(0)\n''',
            '''            if attempt == 0:\n                time.sleep(2)\n''',1)

# Persist only fully contract-valid Gemini output, atomically.
needle='''                    if not required.issubset(result):\n                        raise ValueError(f"Gemini response missing keys: {sorted(required - set(result))}")\n                    return result\n'''
repl='''                    if not required.issubset(result):\n                        raise ValueError(f"Gemini response missing keys: {sorted(required - set(result))}")\n                    try:\n                        tmp = cache_file.with_suffix(".tmp")\n                        tmp.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")\n                        tmp.replace(cache_file)\n                    except Exception:\n                        pass\n                    return result\n'''
if 'tmp = cache_file.with_suffix(".tmp")' not in s:
    if needle not in s: raise SystemExit('return_anchor_missing')
    s=s.replace(needle,repl,1)

if s==orig:
    print('PATCHED=false')
else:
    stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    shutil.copy2(P,P.with_name(P.name+f'.before-v868-gemini-progress-{stamp}'))
    P.write_text(s,encoding='utf-8')
    print('PATCHED=true')

subprocess.run(['/opt/inbox-triage-agent/.venv/bin/python','-m','py_compile',str(P)],check=True)
print('RESULT=GEMINI_PROGRESS_V868_PATCHED')
