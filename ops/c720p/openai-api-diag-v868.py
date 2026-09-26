#!/usr/bin/env python3
from pathlib import Path
import json, requests, hashlib

KEY_PATH=Path("/opt/inbox-triage-agent/secrets/openai_api_key.txt")
key=KEY_PATH.read_text(encoding="utf-8").strip()
print("KEY_PRESENT="+str(bool(key)).lower())
print("KEY_LENGTH="+str(len(key)))
print("KEY_FINGERPRINT="+hashlib.sha256(key.encode()).hexdigest()[:12])

headers={"Authorization":f"Bearer {key}","Content-Type":"application/json"}
try:
    r=requests.get("https://api.openai.com/v1/models",headers=headers,timeout=(8,20))
    print("MODELS_HTTP="+str(r.status_code))
    if r.status_code!=200:
        try:
            e=r.json().get("error",{})
            print("MODELS_ERROR_TYPE="+str(e.get("type","")))
            print("MODELS_ERROR_CODE="+str(e.get("code","")))
            print("MODELS_ERROR_MESSAGE="+str(e.get("message",""))[:400].replace("\n"," "))
        except Exception:
            print("MODELS_ERROR_BODY="+r.text[:400].replace("\n"," "))
except Exception as e:
    print("MODELS_EXCEPTION="+type(e).__name__+":"+str(e)[:300])

for model in ("gpt-5-mini","gpt-4.1-mini"):
    payload={
      "model":model,
      "messages":[{"role":"user","content":"Reply with OK only."}],
      "max_completion_tokens":8
    }
    try:
        r=requests.post("https://api.openai.com/v1/chat/completions",headers=headers,json=payload,timeout=(8,30))
        print(f"{model}_HTTP={r.status_code}")
        if r.status_code==200:
            try:
                data=r.json()
                print(f"{model}_REQUEST_ID="+str(r.headers.get("x-request-id","")))
                print(f"{model}_MODEL="+str(data.get("model","")))
                print(f"{model}_USAGE="+json.dumps(data.get("usage",{}),separators=(",",":")))
            except Exception as e:
                print(f"{model}_PARSE_EXCEPTION={type(e).__name__}")
        else:
            try:
                e=r.json().get("error",{})
                print(f"{model}_ERROR_TYPE="+str(e.get("type","")))
                print(f"{model}_ERROR_CODE="+str(e.get("code","")))
                print(f"{model}_ERROR_MESSAGE="+str(e.get("message",""))[:500].replace("\n"," "))
            except Exception:
                print(f"{model}_ERROR_BODY="+r.text[:500].replace("\n"," "))
    except Exception as e:
        print(f"{model}_EXCEPTION="+type(e).__name__+":"+str(e)[:300])
print("RESULT=OPENAI_API_DIAG_V868_DONE")
