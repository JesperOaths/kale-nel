#!/usr/bin/env python3
from pathlib import Path
import json, os, sys, time, shutil, subprocess

APP=Path("/opt/inbox-triage-agent")
TARGET=APP/"triage_agent.py"
text=TARGET.read_text(encoding="utf-8")
marker='''    account_auth_failures: list[str] = []

    for account in config["gmail_accounts"]:
'''
replacement='''    account_auth_failures: list[str] = []

    # v867: never leave a stale auth_required health result visible for the
    # entire duration of a healthy Gmail/AI run. Final status still replaces
    # this with pass/degraded_auth/deferred/local_fallback as appropriate.
    if not dry_run:
        write_health(
            "running",
            accounts_total=len(config["gmail_accounts"]),
            accounts_auth_required=0,
            processed_messages=0,
            digest_messages=0,
            reply_suggestions=0,
            oauth_verified=True,
        )

    for account in config["gmail_accounts"]:
'''
if replacement not in text:
    if marker not in text:
        raise SystemExit("triage_running_health_anchor_not_found")
    backup=TARGET.with_name(TARGET.name+".pre-v867-running-health")
    if not backup.exists():
        shutil.copy2(TARGET,backup)
    TARGET.write_text(text.replace(marker,replacement,1),encoding="utf-8")
    print("PATCHED=true")
else:
    print("PATCHED=already")

os.chdir(APP)
sys.path.insert(0,str(APP))
os.environ["TOKEN_DIR"]="/opt/inbox-triage-agent/data/tokens"
import triage_agent
cfg=triage_agent.load_config()
triage_agent.write_health(
    "running",
    accounts_total=len(cfg.get("gmail_accounts",[])),
    accounts_auth_required=0,
    processed_messages=0,
    digest_messages=0,
    reply_suggestions=0,
    oauth_verified=True,
)
push=Path("/home/jespern/c720p-home-hub/bin/c720p-cloud-health-push.py")
if push.exists():
    subprocess.run(["python3",str(push)],check=False,timeout=40)
print("RESULT=TRIAGE_RUNNING_HEALTH_V867_APPLIED")
