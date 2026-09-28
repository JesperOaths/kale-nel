#!/usr/bin/env python3
"""Install the v871 deterministic Kalenel order Gmail -> Signal watcher."""
from pathlib import Path
import os
import subprocess
import textwrap

APP=Path("/opt/inbox-triage-agent")
HOME=Path("/home/jespern")
UNIT=HOME/".config/systemd/user"
BIN=APP/"order_watch.py"

watcher=r'''#!/opt/inbox-triage-agent/.venv/bin/python
from __future__ import annotations
import copy
import datetime as dt
import json
import os
import sys
from pathlib import Path

APP=Path("/opt/inbox-triage-agent")
sys.path.insert(0,str(APP))
import triage_agent as triage

STATE=Path("/home/jespern/c720p-home-hub/state/inbox-order-watch-health.json")

def is_shop_order_email(item) -> bool:
    sender=str(item.sender or "").lower()
    subject=str(item.subject or "").strip().lower()
    hay=" ".join([sender,subject,str(item.snippet or "").lower(),str(item.body[:2500] or "").lower()])
    return (
        "orders@kalenel.nl" in sender
        and (
            subject.startswith("new kalenel shop order ")
            or "new kalenel shop order" in hay
            or "kalenel.nl/shop order received" in hay
        )
    )

def write_state(status: str, **extra) -> None:
    STATE.parent.mkdir(parents=True,exist_ok=True)
    payload={"status":status,"updated_iso":dt.datetime.now().astimezone().isoformat(timespec="seconds"),**extra}
    tmp=STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload,indent=2)+"\n",encoding="utf-8")
    os.replace(tmp,STATE)

def main() -> int:
    config=triage.load_config()
    order_config=copy.deepcopy(config)
    order_config["lookback_query"]='newer_than:7d from:orders@kalenel.nl subject:"New Kalenel shop order"'
    order_config["max_messages_per_account"]=20
    try:
        pending_delivered=triage.finalize_prior_delivery(config)
    except Exception as exc:
        print(f"order-watch: delivery finalization warning: {type(exc).__name__}: {exc}",flush=True)
        pending_delivered=set()

    results=[]; processed=[]; auth_failures=0; fetched=0
    for account in config["gmail_accounts"]:
        try:
            service,label_id,emails=triage.fetch_emails(account,order_config)
        except Exception as exc:
            auth_failures+=1
            print(f"order-watch: {account}: Gmail unavailable: {type(exc).__name__}",flush=True)
            continue
        fetched+=len(emails)
        for item in emails:
            if (account,item.message_id) in pending_delivered or not is_shop_order_email(item):
                continue
            classified=triage.local_fallback_triage(item)
            classified=triage.enforce_reply_policy(item,classified)
            classified=triage.apply_signal_policy(item,classified)
            if classified.get("signal_worthy") is not True:
                continue
            results.append((item,classified))
            processed.append((account,service,item.message_id,label_id))

    if not results:
        write_state("pass",orders_found=0,messages_fetched=fetched,accounts_auth_failed=auth_failures)
        print(f"ORDER_WATCH=NO_NEW_ORDERS fetched={fetched} auth_failures={auth_failures}",flush=True)
        return 0

    messages=triage.format_signal_messages(results)
    triage.send_signal(config,messages)
    rows=[{"account":a,"message_id":mid} for a,_,mid,_ in processed]
    triage.save_delivery_finalize(rows)
    remaining=list(rows)
    for account,service,message_id,label_id in processed:
        triage.mark_processed(service,message_id,label_id)
        remaining=[x for x in remaining if not (x["account"]==account and x["message_id"]==message_id)]
        triage.save_delivery_finalize(remaining)
    write_state("pass",orders_found=len(results),signal_bubbles=len(triage.pack_signal_messages(messages)),messages_fetched=fetched,accounts_auth_failed=auth_failures)
    print(f"ORDER_WATCH=DELIVERED orders={len(results)}",flush=True)
    return 0

if __name__=="__main__":
    raise SystemExit(main())
'''
BIN.write_text(watcher,encoding="utf-8")
os.chmod(BIN,0o755)

(UNIT/"inbox-triage-order-watch.service").write_text(textwrap.dedent("""[Unit]
Description=Kalenel new-order Gmail to Signal watcher
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/inbox-triage-agent
Environment=CONFIG_PATH=./config.json
Environment=TOKEN_DIR=./data/tokens
Environment=GOOGLE_CLIENT_SECRET=./secrets/google_oauth_client.json
Environment=HEADLESS_AUTH=true
Environment=OAUTH_OPEN_BROWSER=false
Environment=FORCE_IPV4=true
Environment=SIGNAL_SEND_TIMEOUT_SECONDS=120
ExecCondition=/usr/bin/bash -lc '! /usr/bin/systemctl --user --quiet is-active inbox-triage-agent.service'
ExecStart=/opt/inbox-triage-agent/.venv/bin/python /opt/inbox-triage-agent/order_watch.py
TimeoutStartSec=4min
Nice=5
StandardOutput=append:/home/jespern/c720p-home-hub/logs/inbox-order-watch.log
StandardError=append:/home/jespern/c720p-home-hub/logs/inbox-order-watch.log
"""),encoding="utf-8")

(UNIT/"inbox-triage-order-watch.timer").write_text(textwrap.dedent("""[Unit]
Description=Check for new Kalenel shop orders every five minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=20s
Persistent=true
Unit=inbox-triage-order-watch.service

[Install]
WantedBy=timers.target
"""),encoding="utf-8")

drop=UNIT/"inbox-triage-agent.service.d/60-order-watch-coordination.conf"
drop.parent.mkdir(parents=True,exist_ok=True)
drop.write_text("[Service]\nExecStartPre=-/usr/bin/systemctl --user stop inbox-triage-order-watch.service\n",encoding="utf-8")

subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","enable","--now","inbox-triage-order-watch.timer"],check=True)
print("v871 order watcher installed")
