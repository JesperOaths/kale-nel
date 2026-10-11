#!/usr/bin/env python3
"""Hide obsolete S9+ fallback photographs until explicitly requested.

Live 4K Camera2 now records videos only. Keep historical JPEG evidence
recoverable, but avoid displaying old stills as if they were new video clips.
The actual Security Saved Videos and signed MP4 playback are untouched.
"""
from datetime import datetime,timezone
from pathlib import Path
import argparse,os,shutil

PAGE=Path('/opt/homeassistant/config/www/frontyard-security-new/clips.html')
MARKER='s9-legacy-stills-optin-v1'
SCRIPT=r'''
<style id="s9-legacy-stills-optin-v1">
#s9-fallback-section{display:none!important}
body.s9-legacy-stills-visible #s9-fallback-section{display:block!important}
#s9-legacy-stills-toggle{border:1px solid #6794ae;background:#21495d;color:#def3fb;
 border-radius:9px;padding:10px 12px;margin:10px 0;font-size:13px;cursor:pointer}
</style>
<script id="s9-legacy-stills-optin-script-v1">
(()=>{
 'use strict';
 const init=()=>{
  if(document.getElementById('s9-legacy-stills-toggle'))return;
  const list=document.getElementById('list');
  if(!list)return;
  const button=document.createElement('button');
  button.id='s9-legacy-stills-toggle';
  button.type='button';
  button.setAttribute('aria-expanded','false');
  button.textContent='Show legacy motion photographs (not video clips)';
  button.addEventListener('click',()=>{
   const visible=document.body.classList.toggle('s9-legacy-stills-visible');
   button.setAttribute('aria-expanded',visible?'true':'false');
   button.textContent=visible?'Hide legacy motion photographs':'Show legacy motion photographs (not video clips)';
  });
  list.prepend(button);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();
</script>'''

def patch(html):
    if MARKER in html:
        if html.count('id="'+MARKER+'"')!=1 or html.count('s9-legacy-stills-optin-script-v1')!=1:
            raise ValueError('partial_legacy_still_optin')
        return html
    for required in ('id="s9-fallback-gallery-script-v1"',
                     'id="s9-saved-virtual-folders-script-v1"',
                     'id="player"','/local/c720p-secure-relay-client.js'):
        if required not in html:raise ValueError('missing_gallery_contract_'+required)
    if html.count('</body>')!=1:raise ValueError('unrecognized_page')
    return html.replace('</body>',SCRIPT+'\n</body>',1)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--page',type=Path,default=PAGE)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    before=args.page.read_text()
    after=patch(before)
    if patch(after)!=after:raise RuntimeError('non_idempotent')
    if not args.apply:
        print('S9_OLD_STILLS_OPTIN_DRYRUN',len(after)-len(before));return
    if before==after:
        print('S9_OLD_STILLS_ALREADY_OPTIN');return
    backups=Path('/home/jespern/c720p-home-hub/backups/s9-security-ui-repair')
    backups.mkdir(parents=True,exist_ok=True)
    name='clips.before-legacy-stills-optin.'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.html'
    backup=backups/name
    shutil.copy2(args.page,backup);os.chmod(backup,0o600)
    tmp=args.page.with_name(args.page.name+'.optin-stills-stage')
    installed=False
    try:
        tmp.write_text(after)
        os.chmod(tmp,args.page.stat().st_mode&0o777)
        if tmp.read_text()!=after:raise RuntimeError('staging_mismatch')
        os.replace(tmp,args.page);installed=True
        if patch(args.page.read_text())!=after:raise RuntimeError('postwrite_mismatch')
    except Exception:
        tmp.unlink(missing_ok=True)
        if installed:
            rollback=args.page.with_name(args.page.name+'.optin-stills-rollback')
            shutil.copy2(backup,rollback);os.replace(rollback,args.page)
        raise
    print('S9_LEGACY_STILL_GALLERY_OPTIN_DEPLOYED',
          'backup='+str(backup),'recordings_unmodified=True')

if __name__=='__main__':main()
