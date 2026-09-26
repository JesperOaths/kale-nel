#!/usr/bin/env python3
from pathlib import Path
import requests, json
key=Path("/opt/inbox-triage-agent/secrets/openai_api_key.txt").read_text().strip()
headers={"Authorization":f"Bearer {key}","Content-Type":"application/json"}
for model in ("gpt-5.6-luna","gpt-5.6-terra","gpt-5.6-sol"):
    payload={"model":model,"messages":[{"role":"user","content":"Reply with OK only."}],"max_completion_tokens":8}
    r=requests.post("https://api.openai.com/v1/chat/completions",headers=headers,json=payload,timeout=(8,30))
    print(model+"_HTTP="+str(r.status_code))
    try:
        d=r.json()
    except Exception:
        print(model+"_BODY="+r.text[:400].replace("\n"," "))
        continue
    if r.ok:
        print(model+"_OK=true")
        print(model+"_RETURNED_MODEL="+str(d.get("model","")))
    else:
        e=d.get("error",{})
        print(model+"_ERROR_TYPE="+str(e.get("type","")))
        print(model+"_ERROR_CODE="+str(e.get("code","")))
        print(model+"_ERROR_MESSAGE="+str(e.get("message",""))[:500].replace("\n"," "))
print("RESULT=OPENAI_CURRENT_MODEL_TEST_V869_DONE")
