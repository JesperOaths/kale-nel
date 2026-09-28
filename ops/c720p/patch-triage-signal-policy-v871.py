#!/usr/bin/env python3
"""Idempotent v871 patch for C720P Gmail -> Signal notification policy."""
from pathlib import Path
import shutil, time

p=Path("/opt/inbox-triage-agent/triage_agent.py")
s=p.read_text(encoding="utf-8")
backup=p.with_name(f"triage_agent.py.before-v871-{time.strftime('%Y%m%d_%H%M%S')}")
shutil.copy2(p,backup)

marker="\ndef load_delivery_finalize() -> list[dict[str, str]]:\n"
if "def apply_signal_policy(" not in s:
    fn=r'''
def apply_signal_policy(email_item: EmailItem, triage: dict[str, Any]) -> dict[str, Any]:
    """Hard notification policy independent of cloud/local AI classification."""
    out = dict(triage or {})
    sender = str(email_item.sender or "").lower()
    subject = str(email_item.subject or "").strip()
    subject_l = subject.lower()
    hay = " ".join([sender, subject_l, str(email_item.snippet or "").lower(), str(email_item.body[:2500] or "").lower()])
    shop_order = (
        "orders@kalenel.nl" in sender
        and (
            subject_l.startswith("new kalenel shop order ")
            or "new kalenel shop order" in hay
            or "kalenel.nl/shop order received" in hay
        )
    )
    if shop_order:
        out.update({
            "category": "shop_order", "importance": "high", "show": True,
            "signal_worthy": True, "reply_needed": False, "suggested_reply": "",
            "calendar_needed": False, "risk_notes": "",
            "reason": "New kalenel.nl/shop order; merchant notification is always Signal-worthy.",
        })
        if not str(out.get("summary") or "").strip():
            out["summary"] = f"New shop order received: {subject}."
        return out
    ops_terms = (
        "run failed", "deployment failed", "workflow failed", "build failed",
        "pipeline failed", "scheduled job failed", "cron failed",
        "github actions", "action failed", "edge function failed",
        "failed run", "failed deployment",
    )
    kalenel_context = "kalenel" in hay or "jesperoaths/kale-nel" in hay or "github" in sender
    if kalenel_context and any(term in hay for term in ops_terms):
        out.update({
            "signal_worthy": False, "show": False, "reply_needed": False,
            "suggested_reply": "", "calendar_needed": False,
            "reason": "Kalenel operational run/deployment failure suppressed from Signal by policy.",
        })
        return out
    out.setdefault("signal_worthy", True)
    return out

'''
    if marker not in s:
        raise SystemExit("delivery-finalize marker missing")
    s=s.replace(marker,"\n"+fn+marker,1)

old='''def format_signal_messages(results: list[tuple[EmailItem, dict[str, Any]]]) -> list[str]:
    if not results:
        return ["📬 Email recap — 0 new emails."]
'''
new='''def format_signal_messages(results: list[tuple[EmailItem, dict[str, Any]]]) -> list[str]:
    results = [(e, t) for e, t in results if t.get("signal_worthy") is not False]
    if not results:
        return []
'''
if old in s:
    s=s.replace(old,new,1)

old2='''            triage = enforce_reply_policy(email_item, triage)
            shown.append((email_item, triage))
'''
new2='''            triage = enforce_reply_policy(email_item, triage)
            triage = apply_signal_policy(email_item, triage)
            shown.append((email_item, triage))
'''
if old2 in s:
    s=s.replace(old2,new2,1)

p.write_text(s,encoding="utf-8")
print(f"patched={p} backup={backup}")
