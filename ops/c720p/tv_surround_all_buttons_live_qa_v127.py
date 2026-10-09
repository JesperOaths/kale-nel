#!/usr/bin/env python3
"""C720P live Selenium button QA. Stages:
 inventory, safe-controls, tv-roundtrip, spotify, hts-guard, macro.
Does not transmit HTS POWER. Uses a safe fetch mock ONLY for HTS OFF.
"""
import sys,json,time,urllib.request,urllib.error,traceback
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

def backend(port,path,method="GET",timeout=20):
    try:
        with urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}{path}",method=method),timeout=timeout) as r:
            return {"http":r.status,**json.load(r)}
    except urllib.error.HTTPError as ex:
        try:return {"http":ex.code,**json.loads(ex.read().decode())}
        except:return {"http":ex.code,"error":"HTTP error"}
    except Exception as ex:return {"error":str(ex)}

LOCATE = r"""
const h=document.querySelector('home-assistant');
const panel=h?.shadowRoot?.querySelector('home-assistant-main')?.shadowRoot?.querySelector('partial-panel-resolver')?.querySelector('ha-panel-lovelace')?.shadowRoot?.querySelector('hui-root')?.shadowRoot?.querySelector('hui-view-container')?.querySelector('hui-view')?.querySelector('hui-panel-view');
const stack=panel?.shadowRoot?.querySelector('hui-card')?.querySelector('hui-vertical-stack-card');
const cards=Array.from(stack?.shadowRoot?.querySelectorAll('hui-card')||[]);
const weather=cards.find(c=>c.firstElementChild?.shadowRoot?.querySelector('iframe')?.src?.includes('weather-row'))?.firstElementChild?.shadowRoot?.querySelector('iframe');
const f=Array.from(weather?.contentDocument?.querySelectorAll('iframe')||[]).find(e=>e.src?.includes('tv-surround'));
const d=f?.contentDocument;
const win=f?.contentWindow;
"""
SNAPSHOT=LOCATE+r"""
return {
  haConnected:!!h?.hass?.connection?.connected,
  weatherUrl:weather?.src,
  tvWidgetUrl:f?.src,
  uiLoaded:!!d?.getElementById('hts'),
  uiVersion:d?.documentElement?.outerHTML?.includes('C720P_HTS_UNKNOWN_POWER_INTERLOCK_V125'),
  btns: Array.from(d?.querySelectorAll('button')||[]).map(x=>({id:x.id,text:x.textContent,disabled:x.disabled})),
  pills:["tvPill","htsPill","bridgePill"].map(x=>({name:x,text:d?.getElementById(x)?.textContent})),
  status:d?.getElementById('status')?.textContent,
  audit:win?.__c720pQA?.slice(-25)
};
"""
INSTRUMENT=LOCATE+r"""
if(!win||!d) return {ok:false};
if(!win.__c720pQA){
  win.__c720pQA=[];
  const orig=win.fetch.bind(win);
  win.fetch=async function(uri,opts){
    const target=String(uri),method=String(opts?.method||"GET");
    if(method==="POST"&&target.includes("/ht-e6500/ensure-off")&&win.__c720pStubOff){
       win.__c720pQA.push({url:target,method,stub:true});
       return new win.Response(JSON.stringify({ok:true,action:"stubbed_HTS_power_off_safety_QA",state:"on",confirmed:false}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    try {
       const resp=await orig(uri,opts);
       if(method==="POST"){
          let payload={};
          try{payload=await resp.clone().json()}catch(e){}
          win.__c720pQA.push({url:target,method,status:resp.status,
            ok:payload?.ok,action:payload?.action,state:payload?.state,
            failure:payload?.failure,confirmed:payload?.confirmed});
       }
       return resp;
    }catch(e){
       if(method==="POST")win.__c720pQA.push({url:target,method,error:String(e)});
       throw e;
    }
  };
}
return {ok:true,buttons:d.querySelectorAll("button").length}
"""
CLICK=LOCATE+r"""
if(!d) return {ok:false,error:"no UI"};
const id=arguments[0];
const btn=d.getElementById(id);
if(!btn)return {ok:false,error:"no button: "+id};
if(btn.disabled)return {ok:false,error:"button disabled: "+id};
btn.click();
return {ok:true,id:id};
"""
MOCK_OFF=LOCATE+r"""
if(!win?.__c720pQA)return false;
win.__c720pStubOff=true;
return true;
"""

def snapshot(d):
    return d.execute_script(SNAPSHOT)
def instrument(d):
    return d.execute_script(INSTRUMENT)
def click(d,id):
    return d.execute_script(CLICK,id)
def settle(d,seconds=12):
    t=time.monotonic()
    last=snapshot(d)
    while time.monotonic()-t<seconds:
        time.sleep(1.4)
        last=snapshot(d)
        if last.get("uiLoaded") and last.get("btns") and not any(b["disabled"] for b in last["btns"]):
            if time.monotonic()-t>=2:
                return last
    return last

def app():
    o=Options();o.add_experimental_option('debuggerAddress','127.0.0.1:9222')
    d=webdriver.Chrome(options=o);d.set_script_timeout(25)
    return d

def main(stage):
    d=app()
    try:
        start=snapshot(d)
        if start.get("uiLoaded") and not start.get("uiVersion"):
            # Refresh the parent iframe; an older embedded document can survive
            # despite current widget source files already being installed.
            d.execute_script(LOCATE + """
if(weather) weather.src='/local/c720p-weather-row.html?v=TVQA_HOT_REFRESH_V127_'+Date.now();
""")
            for _ in range(8):
                time.sleep(2)
                start=snapshot(d)
                if start.get("uiVersion"): break
        if not start.get("uiLoaded"):
            print(json.dumps({"ok":False,"stage":stage,"error":"C720P TV iframe missing","snapshot":start},indent=2));return 3
        inst=instrument(d)
        out={"stage":stage,"initial":start,"instrument":inst}
        if stage=="inventory":
            out["backend"]={
                "tv":backend(8789,"/grundig-tv/power-state"),
                "hts":backend(8789,"/ht-e6500/power-state"),
                "s5":backend(8789,"/health"),
                "bluetooth":backend(8790,"/state"),
            }
        elif stage=="safe-controls":
            actions=[]
            for ident in ["htsSync","vup","vdown"]:
                before=snapshot(d)
                click_result=click(d,ident)
                after=settle(d,9)
                actions.append({"id":ident,"click":click_result,"status":after.get("status"),
                                "pills":after.get("pills"),
                                "newPosts":(after.get("audit") or [])[len(before.get("audit") or []):]})
            out["actions"]=actions
            out["hts"]=backend(8789,"/ht-e6500/power-state")
        elif stage=="hts-guard":
            assert d.execute_script(MOCK_OFF),"intercept failed"
            pre=snapshot(d)
            click_result=click(d,"hts")
            after=settle(d,8)
            intercepted=[v for v in after.get("audit") or [] if v.get("stub") and "ensure-off" in v.get("url","")]
            out.update(click=click_result,after=after,intercepted=intercepted,
                        real_hts_state=backend(8789,"/ht-e6500/power-state"),
                        live_power_off_sent=False if intercepted else None)
        elif stage=="tv-roundtrip":
            initial=backend(8789,"/grundig-tv/power-state")
            assert isinstance(initial.get("is_on"),bool), "TV status cannot safely roundtrip: "+str(initial)
            records=[]
            try:
                for i in range(2):
                    pre=backend(8789,"/grundig-tv/power-state")
                    x=click(d,"tv")
                    after=settle(d,16)
                    real=backend(8789,"/grundig-tv/power-state")
                    records.append({"click":x,"before":pre.get("is_on"),"after":real.get("is_on"),
                                    "status":after.get("status"),"audit":(after.get("audit") or [])[-4:]})
            finally:
                restored=backend(8789,"/grundig-tv/power-state")
                if restored.get("is_on")!=initial.get("is_on"):
                    # Bring television back to its starting state using explicit idempotent Wi-Fi route
                    backend(8789,"/grundig-tv/on" if initial["is_on"] else "/grundig-tv/off",method="POST",timeout=24)
            out.update(initialTV=initial.get("is_on"),records=records,finalTV=backend(8789,"/grundig-tv/power-state").get("is_on"))
        elif stage=="spotify":
            clicked=click(d,"spotify")
            after=settle(d,14)
            out.update(click=clicked,after=after)
        elif stage=="macro":
            before=snapshot(d)
            clicked=click(d,"macro")
            out.update(click=clicked,before=before)
            # Observe async pipeline up to ~110 sec; no receiver POWER test.
            deadline=time.monotonic()+110
            polls=[]
            while time.monotonic()<deadline:
                time.sleep(5)
                audio=backend(8790,"/state",timeout=12)
                snap=snapshot(d)
                polls.append({"elapsed_sec":round(110-(deadline-time.monotonic()),1),
                    "pipeline_state":audio.get("pipeline_state"),"pipeline_running":audio.get("pipeline_running"),
                    "live_ready":audio.get("live_ready"),"bluetooth_connected":audio.get("bluetooth_connected"),
                    "status":snap.get("status"),"latest_posts":(snap.get("audit") or [])[-3:]})
                if len(polls)>3 and not audio.get("pipeline_running") and audio.get("pipeline_state") in ("failed","connected_verified"):
                    break
            out.update(polls=polls[-25:],final=snapshot(d),finalAudio=backend(8790,"/state",timeout=15),
                       finalHTS=backend(8789,"/ht-e6500/power-state",timeout=12))
        else:raise ValueError("invalid stage "+stage)
        print(json.dumps(out,indent=2,default=str)[:25000],flush=True)
        return 0
    finally:
        d.quit()

if __name__=="__main__":
    try:sys.exit(main(sys.argv[1]))
    except Exception as e:
        print(json.dumps({"ok":False,"error":str(e),"trace":traceback.format_exc()}))
        sys.exit(1)
