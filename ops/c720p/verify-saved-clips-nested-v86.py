#!/usr/bin/env python3
import importlib.util, json, pathlib

REC=pathlib.Path('/home/jespern/c720p-home-hub/bin/c720p-cdp-dashboard-recover.py')
sp=importlib.util.spec_from_file_location('c720p_recover',REC)
m=importlib.util.module_from_spec(sp); sp.loader.exec_module(m)
tabs=m.http_json(m.CDP+'/json',timeout=3)
pages=[t for t in tabs if t.get('type')=='page' and t.get('webSocketDebuggerUrl')]
ranked=[t for t in pages if ':8123' in (t.get('url') or '') and '/c720p-hub/' in (t.get('url') or '')]
if not ranked: raise SystemExit('no authenticated HA target')
c=m.Client(ranked[0])
try:
    expr=r'''(async()=>{
      const result={ok:false,stage:'start'};
      let outer=null;
      try{
        document.getElementById('c720pSecurityVerifyV86')?.remove();
        outer=document.createElement('iframe');
        outer.id='c720pSecurityVerifyV86';
        outer.style.cssText='position:fixed;left:-10000px;top:-10000px;width:1600px;height:1000px;opacity:0;pointer-events:none';
        outer.src='/local/c720p-surveillance.html?v=CAMERA_SAVED_V86_20261007&t='+Date.now();
        document.body.appendChild(outer);
        result.stage='security-loading';
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('security iframe timeout')),12000);
          outer.onload=()=>{clearTimeout(timer);resolve()};
        });
        const sd=outer.contentDocument;
        result.securityTitle=sd?.title||'';
        const savedButton=sd?.querySelector('button[data-tab="saved"]');
        if(!savedButton) throw new Error('saved tab button missing');
        result.stage='saved-click';
        savedButton.click();
        const inner=sd.getElementById('cameraSavedFrame');
        if(!inner) throw new Error('saved iframe missing');
        result.savedSrc=inner.getAttribute('src')||'';
        if(!result.savedSrc) throw new Error('saved iframe src not assigned after click');
        result.stage='saved-loading';
        if(!inner.contentDocument || inner.contentDocument.readyState!=='complete'){
          await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('saved iframe timeout')),12000);
            inner.onload=()=>{clearTimeout(timer);resolve()};
          });
        }
        await new Promise(r=>setTimeout(r,8000));
        const d=inner.contentDocument;
        result.stage='inspect';
        result.savedTitle=d?.title||'';
        result.countText=d?.getElementById('count')?.textContent||'';
        result.clipCards=d?.querySelectorAll('.clip')?.length||0;
        result.emptyText=d?.querySelector('.empty')?.textContent||'';
        result.playerTitle=d?.getElementById('playerTitle')?.textContent||'';
        result.bodyText=(d?.body?.innerText||'').slice(0,700);
        result.ok=result.clipCards>0;
      }catch(e){
        result.error=String(e&&e.stack||e);
      }finally{
        try{outer?.remove()}catch(e){}
      }
      return result;
    })()'''
    raw=c.call('Runtime.evaluate',{'expression':expr,'awaitPromise':True,'returnByValue':True},timeout=35)
    print('RAW='+json.dumps(raw,ensure_ascii=False)[:12000])
    rr=raw.get('result') or {}
    v=(rr.get('result') or {}).get('value')
    if v is None and 'value' in rr:
        v=rr.get('value')
    print('VALUE='+json.dumps(v,ensure_ascii=False,sort_keys=True))
    if not isinstance(v,dict) or not v.get('ok'):
        raise SystemExit('saved clips exact nesting verification failed')
finally:
    c.close()
