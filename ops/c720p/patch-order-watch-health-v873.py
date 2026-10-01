#!/usr/bin/env python3
"""v873: make the C720P Kalenel order-watch health state reflect Gmail failures."""
from pathlib import Path
import py_compile

TARGET = Path("/opt/inbox-triage-agent/order_watch.py")

OLD = '''    if not results:
        write_state("pass",orders_found=0,messages_fetched=fetched,accounts_auth_failed=auth_failures)
        print(f"ORDER_WATCH=NO_NEW_ORDERS fetched={fetched} auth_failures={auth_failures}",flush=True)
        return 0
'''

NEW = '''    if not results:
        total_accounts = len(config.get("gmail_accounts", []))
        if total_accounts and auth_failures >= total_accounts:
            health_status = "fail"
        elif auth_failures:
            health_status = "degraded"
        else:
            health_status = "pass"
        write_state(health_status,orders_found=0,messages_fetched=fetched,accounts_auth_failed=auth_failures)
        print(f"ORDER_WATCH=NO_NEW_ORDERS fetched={fetched} auth_failures={auth_failures} status={health_status}",flush=True)
        return 0
'''


def main() -> int:
    source = TARGET.read_text(encoding="utf-8")
    if 'health_status = "fail"' in source:
        print("PATCHED=already_present")
    elif OLD in source:
        backup = TARGET.with_suffix(".py.pre-health-v873")
        if not backup.exists():
            backup.write_text(source, encoding="utf-8")
        TARGET.write_text(source.replace(OLD, NEW, 1), encoding="utf-8")
        print(f"PATCHED={TARGET}")
    else:
        raise SystemExit("expected no-results health block not found")
    py_compile.compile(str(TARGET), doraise=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
