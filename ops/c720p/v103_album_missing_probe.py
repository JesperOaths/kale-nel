from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
from pathlib import Path
import time,re,json,hashlib,urllib.request

manifest=json.load(open('/opt/homeassistant/config/www/c720p-google-photos-album/manifest.json'))
url=manifest['source_url']
current={p.stem for p in Path('/opt/homeassistant/config/www/c720p-google-photos-album').glob('*.jpg')}
opts=Options(); opts.binary_location='/usr/bin/chromium'
for a in ['--headless=new','--no-sandbox','--disable-gpu','--window-size=1400,1000','--disable-dev-shm-usage']: opts.add_argument(a)
d=webdriver.Chrome(options=opts)
seen=set()
try:
 d.get(url); time.sleep(4)
 body=d.find_element(By.TAG_NAME,'body')
 stable=0; last=0
 for n in range(40):
  vals=d.execute_script(r'''
const u=[]; for(const i of document.images){for(const x of [i.src,i.currentSrc,i.getAttribute('src'),i.getAttribute('data-src')])if(x)u.push(x);}
for(const e of performance.getEntriesByType('resource'))if(e.name)u.push(e.name);
return u;''')
  for x in vals:
   if 'googleusercontent.com' in x and '/pw/' in x:
    y=x.replace('\\u003d','=').replace('\\u0026','&').split('?')[0]
    y=re.sub(r'=([wsrhpc]|rw|w)[^/?]*$','',y)
    seen.add(y)
  try: body.send_keys(Keys.PAGE_DOWN)
  except: pass
  d.execute_script("window.scrollBy(0,Math.max(innerHeight*.9,700)); for(const el of document.querySelectorAll('*')){const s=getComputedStyle(el);if((s.overflowY==='auto'||s.overflowY==='scroll')&&el.scrollHeight>el.clientHeight+200)el.scrollTop=Math.min(el.scrollHeight,el.scrollTop+Math.max(el.clientHeight*.9,700));}")
  time.sleep(.55)
  if len(seen)==last:stable+=1
  else:stable=0
  last=len(seen)
  if stable>=9 and n>14:break
finally:
 d.quit()

rows=[]
for base in sorted(seen):
 h=hashlib.sha1(base.encode()).hexdigest()[:20]
 rows.append({'hash':h,'url':base,'already_cached':h in current})
missing=[x for x in rows if not x['already_cached']]
Path('/tmp/v103_album_sources.json').write_text(json.dumps(rows,indent=2))
print('ALBUM_PHOTOS',len(rows))
print('CURRENT_CACHE',len(current))
print('MATCHED',sum(x['already_cached'] for x in rows))
print('MISSING',len(missing))
for x in missing:print('MISSING_ROW',json.dumps(x))
