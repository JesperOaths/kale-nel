#!/usr/bin/env python3
"""Present S9+ microSD date/category folders in the Security Saved tab.

Preserve existing Drive archive view behind a second explicit Saved subtab.
Does not touch the camera, clips, category labels, retention, or login gates.
"""
import argparse
from datetime import datetime,timezone
import os
from pathlib import Path
import shutil

MARKER='S9_SAVED_TAB_DATE_CATEGORY_FOLDERS_V1'
TARGET=Path('/opt/homeassistant/config/www/c720p-surveillance.html')
OLD_START='<section class="panel" id="panel-saved"><iframe id="cameraSavedFrame"'
TAB_SNIPPET=r'''<section class="panel" id="panel-saved">
<div class="s9-saved-subnav">
 <button type="button" class="s9-saved-subbtn selected" data-s9-saved="microSD">microSD · folders by date</button>
 <button type="button" class="s9-saved-subbtn" data-s9-saved="drive">Historical Drive archive</button>
</div>
<iframe id="s9SavedFolderFrame" title="S9+ saved clips organized by date and detection category"
 data-src="/local/frontyard-security-new/clips.html?embedded=1&savedFolders=1"></iframe>
<iframe id="cameraSavedFrame" title="Historical Drive saved recordings"
 data-src="/local/c720p-drive-saved.html?camera=camera&v=SAVED_THUMB_UI_V115_20261007"
 style="display:none"></iframe>
</section>'''
CSS=r'''<style id="s9-saved-tab-folders-style-v1">
#panel-saved .s9-saved-subnav{height:45px;display:flex;align-items:center;gap:9px;padding:5px 10px;background:#0e2130}
#panel-saved .s9-saved-subbtn{border:1px solid #51738c;background:#1a3545;color:#d9f0fc;font-weight:750;font-size:12px;padding:8px 12px;border-radius:8px;cursor:pointer}
#panel-saved .s9-saved-subbtn.selected{background:#225371;border-color:#70b0d4}
#panel-saved iframe{height:calc(100% - 45px);width:100%;border:0}
</style>'''
JS=r'''<script id="s9-saved-tab-folders-script-v1">
(()=>{
 const tabs=[...document.querySelectorAll('[data-s9-saved]')];
 const micro=document.getElementById('s9SavedFolderFrame');
 const drive=document.getElementById('cameraSavedFrame');
 if(!micro||!drive||tabs.length!==2)return;
 function show(type){
  const archival=type==='drive';
  for(const el of tabs){
   const selected=el.dataset.s9Saved===type;
   el.classList.toggle('selected',selected);
   el.setAttribute('aria-pressed',selected?'true':'false');
  }
  micro.style.display=archival?'none':'block';
  drive.style.display=archival?'block':'none';
  const frame=archival?drive:micro;
  if(!frame.getAttribute('src'))frame.src=frame.dataset.src;
 }
 for(const el of tabs)el.addEventListener('click',()=>show(el.dataset.s9Saved));
})();
</script>'''

def patch(src:str)->str:
    if MARKER in src:return src
    if src.count('</body>')!=1 or src.count(OLD_START)!=1:
        raise ValueError('unexpected_saved_tab_page_contract')
    start=src.index(OLD_START)
    end=src.find('</section>',start)
    if end<0 or end-start>850:
        raise ValueError('saved_tab_section_structure_changed')
    original=src[start:end+10]
    if original.count('cameraSavedFrame')!=1 or 'data-src="/local/c720p-drive-saved.html' not in original:
        raise ValueError('original_Drive_tab_not_found')
    changed=src.replace(original,TAB_SNIPPET,1)
    former="if(t==='saved'){const f=$('#cameraSavedFrame');if(!f.getAttribute('src'))f.src=f.dataset.src}"
    latter="if(t==='saved'){const f=$('#s9SavedFolderFrame');if(f&&!f.getAttribute('src'))f.src=f.dataset.src}"
    if changed.count(former)!=1:
        raise ValueError('saved_tab_activation_code_changed')
    changed=changed.replace(former,latter,1)
    return changed.replace('</body>','<!-- '+MARKER+' -->\n'+CSS+'\n'+JS+'\n</body>',1)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--page',type=Path,default=TARGET)
    p.add_argument('--apply',action='store_true')
    args=p.parse_args()
    old=args.page.read_text()
    new=patch(old)
    if patch(new)!=new:raise RuntimeError('saved_tab_patch_not_idempotent')
    if not args.apply:
        print('S9_SAVED_TAB_FOLDER_SWITCH_DRY_RUN',old!=new);return
    if new==old:
        print('S9_SAVED_TAB_FOLDER_SWITCH_ALREADY_PRESENT');return
    root=Path('/home/jespern/c720p-home-hub/backups/s9-date-tab')
    root.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    back=root/('c720p-surveillance.'+stamp+'.html')
    shutil.copy2(args.page,back);os.chmod(back,0o600)
    stage=args.page.with_name(args.page.name+'.saved-folders-stage')
    try:
        stage.write_text(new);os.chmod(stage,args.page.stat().st_mode&0o777)
        if stage.read_text()!=new:raise RuntimeError('saved_tab_staging_mismatch')
        os.replace(stage,args.page)
        if patch(args.page.read_text())!=new:raise RuntimeError('saved_tab_install_mismatch')
    except Exception:
        stage.unlink(missing_ok=True)
        rollback=args.page.with_name(args.page.name+'.saved-tab-rollback')
        shutil.copy2(back,rollback);os.replace(rollback,args.page)
        raise
    print('S9_SAVED_TAB_DATE_FOLDERS_DEPLOYED',str(back),
          'Drive_tab_preserved=True phone_restarted=False original_clips_modified=False')

if __name__=='__main__':
    main()
