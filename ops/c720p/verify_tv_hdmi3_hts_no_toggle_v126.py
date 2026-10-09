#!/usr/bin/env python3
import importlib.util,json,tempfile
from pathlib import Path
p="/home/jespern/c720p-home-hub/bin/c720p-bluetooth-helper-server.py"
s=importlib.util.spec_from_file_location("hts_regression",p)
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.bt_connected_info=lambda:{"connected":False}
m.post_json=lambda *a,**k:(_ for _ in ()).throw(AssertionError("Power endpoint invoked"))
m.run=lambda *a,**k:{"ok":False,"stdout":"","stderr":"simulated","returncode":1}
data={"on":{"state":"on","reported":True,"source":"user_confirmed_on","presence":{"shadow":{"state":"on","source":"user_confirmed_on"}}},"unknown":{"state":"unknown","presence":{"shadow":{}}},"off":{"state":"off","source":"verified_off_shadow","presence":{"shadow":{"state":"off","source":"verified_absence_after_single_power_toggle"}}}}
results={}
with tempfile.TemporaryDirectory() as d:
 m.STATE=Path(d)/"bt.json"
 for name,info in data.items():
  m.get_json=lambda *a,info=info,**k:info
  r=m.prepare_hts_bluetooth([])
  assert r["power_toggle_sent"] is False and r["hts_input"] in ("failed","adaptive_source_search_required"),(name,r)
  results[name]={"input":r["hts_input"],"power_toggled":False}
print(json.dumps({"ok":True,"tests":results,"real_hardware_touched":False}))
