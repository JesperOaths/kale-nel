from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
import time,re,json,hashlib,os,sys

url=json.load(open('/opt/homeassistant/config/www/c720p-google-photos-album/manifest.json'))['source_url']
opts=Options()
opts.binary_location='/usr/bin/chromium'
opts.add_argument('--headless=new')
opts.add_argument('--no-sandbox')
opts.add_argument('--disable-gpu')
opts.add_argument('--window-size=1400,1000')
opts.add_argument('--lang=en-US')
opts.add_argument('--disable-dev-shm-usage')
opts.add_argument('--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36')
d=webdriver.Chrome(options=opts)
try:
    d.get(url)
    time.sleep(5)
    seen=set()
    heights=[]
    def collect():
        vals=d.execute_script(r'''
const u=[];
for(const i of document.images){for(const x of [i.src,i.currentSrc,i.getAttribute('src'),i.getAttribute('data-src')]) if(x)u.push(x);}
for(const e of performance.getEntriesByType('resource')) if(e.name)u.push(e.name);
for(const el of document.querySelectorAll('[style*="background"]')) {
 const b=getComputedStyle(el).backgroundImage||'';
 for(const m of b.matchAll(/url\(["']?([^"')]+)["']?\)/g))u.push(m[1]);
}
return u;
''')
        for x in vals:
            if 'googleusercontent.com' in x or 'ggpht.com' in x: seen.add(x.replace('\\u003d','=').replace('\\u0026','&'))
    collect()
    body=d.find_element(By.TAG_NAME,'body')
    stable=0
    last=0
    for n in range(45):
        try: body.send_keys(Keys.PAGE_DOWN)
        except: pass
        d.execute_script("window.scrollBy(0, Math.max(window.innerHeight*0.85,700));")
        # scroll likely inner containers too
        d.execute_script(r'''
for(const el of document.querySelectorAll('*')){
 const s=getComputedStyle(el);
 if((s.overflowY==='auto'||s.overflowY==='scroll') && el.scrollHeight>el.clientHeight+200){
   el.scrollTop=Math.min(el.scrollHeight,el.scrollTop+Math.max(el.clientHeight*.85,600));
 }
}
''')
        time.sleep(.65)
        collect()
        h=d.execute_script("return [document.documentElement.scrollHeight,window.scrollY,document.body.scrollHeight]")
        heights.append(h)
        if len(seen)==last: stable+=1
        else: stable=0
        last=len(seen)
        if stable>=10 and n>15: break
    print('TITLE',d.title)
    print('FINAL_URL',d.current_url)
    print('ROUNDS',len(heights))
    print('RAW_UNIQUE_RESOURCES',len(seen))
    # Normalize image URL to identity: strip sizing suffix/query. Keep only obvious image-host resource paths.
    ids={}
    for x in seen:
        y=x.split('?')[0]
        # Google image sizing often starts at =w / =s / =rw etc
        y=re.sub(r'=([wsrhpc]|rw|w)[^/?]*$','',y)
        # only substantial lh3 / lh*.googleusercontent URLs
        if re.search(r'https://(?:lh\d+|lh3)\.(?:googleusercontent\.com|ggpht\.com)/',y):
            ids.setdefault(y,x)
    print('NORMALIZED_UNIQUE',len(ids))
    for i,(base,full) in enumerate(sorted(ids.items())):
        print('URL',i,base)
finally:
    d.quit()
