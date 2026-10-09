#!/home/jespern/c720p-home-hub/.venv-webdriver/bin/python
"""Read-only TV state + real fail-safe click of Connect Surround on C720P kiosk."""
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import urllib.request,json,time,sys
BASE='http://127.0.0.1:8789'
def state():
 with urllib.request.urlopen(BASE+'/grundig-tv/power-state',timeout=20) as r: return json.load(r).get('is_on')
original=state()
if original is not False:
 print(json.dumps({'ok':False,'skipped':'TV must be observably off to test non-intrusive macro preflight','tv_is_on':original}))
 sys.exit(0)
o=Options();o.add_experimental_option('debuggerAddress','127.0.0.1:9222')
d=webdriver.Chrome(options=o)
find=r"""const h=document.querySelector('home-assistant'), m=h?.shadowRoot?.querySelector('home-assistant-main'), s=m?.shadowRoot?.querySelector('partial-panel-resolver')?.querySelector('ha-panel-lovelace')?.shadowRoot?.querySelector('hui-root')?.shadowRoot?.querySelector('hui-view-container')?.querySelector('hui-view')?.querySelector('hui-panel-view')?.shadowRoot?.querySelector('hui-card')?.querySelector('hui-vertical-stack-card'), cards=Array.from(s?.shadowRoot?.querySelectorAll('hui-card')||[]), w=cards.find(c=>c.firstElementChild?.shadowRoot?.querySelector('iframe')?.src?.includes('weather-row'))?.firstElementChild?.shadowRoot?.querySelector('iframe');return w"""
try:
 weather=d.execute_script(find)
 if weather is None:raise RuntimeError('weather iframe missing')
 d.execute_script("arguments[0].src='/local/c720p-weather-row.html?v=S5_V27_SMOKETEST_'+Date.now()",weather)
 time.sleep(5)
 js=r"""const h=document.querySelector('home-assistant'), m=h?.shadowRoot?.querySelector('home-assistant-main'), s=m?.shadowRoot?.querySelector('partial-panel-resolver')?.querySelector('ha-panel-lovelace')?.shadowRoot?.querySelector('hui-root')?.shadowRoot?.querySelector('hui-view-container')?.querySelector('hui-view')?.querySelector('hui-panel-view')?.shadowRoot?.querySelector('hui-card')?.querySelector('hui-vertical-stack-card'), cards=Array.from(s?.shadowRoot?.querySelectorAll('hui-card')||[]), f=cards.find(c=>c.firstElementChild?.shadowRoot?.querySelector('iframe')?.src?.includes('weather-row'))?.firstElementChild?.shadowRoot?.querySelector('iframe'), t=Array.from(f?.contentDocument?.querySelectorAll('iframe')||[]).find(x=>x.src?.includes('tv-surround'));return t?.contentDocument||null"""
 # Chrome should not return a Document object via webdriver JSON serialization;
 # expose only primitive derived UI state.
 def inspect(click=False):
  jsstate=js.replace('return t?.contentDocument||null',"""const doc=t?.contentDocument;if(!doc)return {ok:false};const b=doc.getElementById('macro');const all=Array.from(doc.querySelectorAll('button'));if(arguments[0])b?.click();return {ok:true,version:doc.documentElement.outerHTML.includes('C720P_TV_SURROUND_MACRO_S5_PREFLIGHT_V27'),status:doc.getElementById('status')?.textContent,macroDisabled:b?.disabled,disabledCount:all.filter(x=>x.disabled).length,buttons:all.length,tvText:doc.getElementById('tv')?.textContent.slice(0,40)}""")
  return d.execute_script(jsstate,click)
 before=inspect()
 if not before.get('version'):raise RuntimeError('new V27 widget not loaded: '+str(before))
 clicked=inspect(True)
 end=time.monotonic()+55
 last=clicked
 while time.monotonic()<end:
  time.sleep(2.5)
  last=inspect()
  if last.get('disabledCount')==0 and 'Checking TV and surround paths' not in str(last.get('status')) and 'S5 over wireless' not in str(last.get('status')):
   break
 aftertv=state()
 unintended_tv_on=aftertv is True
 if aftertv is not False:
  try:
   req=urllib.request.Request(BASE+'/grundig-tv/off',method='POST')
   with urllib.request.urlopen(req,timeout=35): pass
  except Exception: pass
  aftertv=state()
 print(json.dumps({'ok':last.get('disabledCount')==0 and aftertv is False and not unintended_tv_on,
                   'original_tv_off':True,'tv_remained_off':not unintended_tv_on,'tv_restored_off':aftertv is False,
                   'before':before,'clicked':clicked,'after':last,
                   'all_buttons_reenabled':last.get('disabledCount')==0},ensure_ascii=False))
finally:
 d.quit()
