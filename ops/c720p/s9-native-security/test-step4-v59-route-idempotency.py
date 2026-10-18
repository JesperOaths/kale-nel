#!/usr/bin/env python3
"""Offline gate for first V58 -> V59 and repeat-safe V59 -> V59 routes."""
import importlib.util
from pathlib import Path

source=Path(__file__).with_name("deploy-security-step4-v59-ui-only.py")
spec=importlib.util.spec_from_file_location("security_step4_installer",source)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

v58=module.OLD
v59=module.NEW
j58=module.JS_OLD
j59=module.JS_NEW
old={
 "people":("header security-people-v45.js?v="+j58+" footer").encode(),
 "hub":("header security-people-v50.html?v="+v58+"& footer").encode(),
 "entry":("header security-hub-v30.js?v="+v58+" footer").encode(),
 "shell":("header security-hub-v30.html?v="+v58+" "+
          "security-hub-v30.js?v="+v58+" "+
          "security-people-v50.html?v="+v58+" footer").encode()
}
first=module.routes(old)
assert all(first[k]!=old[k] for k in old),"first release must bust caches"
assert module.routes(first)==first,"repeat V59 dry run must be safely idempotent"
bad={**first,"shell":b"header unrelated-security-route-v61 footer"}
try:
 module.routes(bad)
except RuntimeError as error:
 assert "shell cache routing unknown" in str(error)
else:
 raise AssertionError("unknown shell route must stop release")
print("STEP4_V59_ROUTE_IDEMPOTENCY_TEST_PASS")
