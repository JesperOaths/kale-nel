#!/usr/bin/env python3
import importlib.util, json, pathlib, time

REC=pathlib.Path('/home/jespern/c720p-home-hub/bin/c720p-cdp-dashboard-recover.py')
sp=importlib.util.spec_from_file_location('c720p_recover',REC)
m=importlib.util.module_from_spec(sp); sp.loader.exec_module(m)

tabs=m.http_json(m.CDP+'/json',timeout=3)
pages=[t for t in tabs if t.get('type')=='page' and t.get('webSocketDebuggerUrl')]
ranked=[t for t in pages if ':8123' in (t.get('url') or '') and '/c720p-hub/' in (t.get('url') or '')]
if not ranked:
    raise SystemExit('no authenticated HA page target')
c=m.Client(ranked[0])
try:
    expr=r'''(async()=>{
      const old=document.getElementById('c720pSavedVerifyV86');
      if(old) old.remove();
      const f=document.createElement('iframe');
      f.id='c720pSavedVerifyV86';
      f.style.cssText='position:fixed;left:-10000px;top:-10000px;width:1400px;height:900px;opacity:0;pointer-events:none';
      f.src='/local/c720p-drive-saved.html?camera=camera&v=CAMERA_SAVED_V86_20261007&t='+Date.now();
      document.body.appendChild(f);
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('iframe load timeout')),10000);
        f.onload=()=>{clearTimeout(timer);resolve()};
      });
      await new Promise(r=>setTimeout(r,7000));
      const d=f.contentDocument;
      const result={
        url:f.contentWindow.location.href,
        title:d?.title||'',
        countText:d?.getElementById('count')?.textContent||'',
        clipCards:d?.querySelectorAll('.clip')?.length||0,
        emptyText:d?.querySelector('.empty')?.textContent||'',
        playerTitle:d?.getElementById('playerTitle')?.textContent||'',
        bodyText:(d?.body?.innerText||'').slice(0,1000)
      };
      f.remove();
      return result;
    })()'''
    r=c.call('Runtime.evaluate',{'expression':expr,'awaitPromise':True,'returnByValue':True},timeout=25)
    v=((r.get('result') or {}).get('result') or {}).get('value') or {}
    print(json.dumps(v,ensure_ascii=False,sort_keys=True))
    if int(v.get('clipCards') or 0)<1:
        raise SystemExit('saved clips did not render in authenticated HA iframe')
finally:
    c.close()
