#!/usr/bin/env python3
"""Upright display of pre-fix S9+ Camera2 thumbnails; originals never changed.

Install only the HTML widget on the native Home Assistant Security clips page.
Images are transformed in-browser *only* when a known native microSD
thumbnail has portrait-shaped JPEG pixels (the old -90 degree MP4 issue).
This cannot write to SD, Drive, archives, thumbnails, or the recording service.
"""
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import re
import shutil

STYLE_ID = 'id="s9-native-thumb-upright-style-v1"'
SCRIPT_ID = 'id="s9-native-thumb-upright-script-v1"'

SNIPPET = r'''
<style id="s9-native-thumb-upright-style-v1">
/* Fixed dimensions match the existing native clips and human-review cards. */
.s9phone-item > .s9-upright-thumb-shell{
 display:block;position:relative;overflow:hidden;width:92px;height:56px;
 border-radius:7px;background:#080f16
}
@media(max-width:1050px){
 .s9phone-item > .s9-upright-thumb-shell{width:76px;height:43px}
}
#s9-human-review .review-card > .s9-upright-thumb-shell{
 display:block;position:relative;overflow:hidden;width:100%;
 aspect-ratio:16/10;background:#080f16
}
.s9-upright-thumb-shell > img.s9-upright-thumb{
 position:absolute!important;top:50%!important;left:50%!important;
 width:100%!important;height:100%!important;max-width:none!important;
 max-height:none!important;object-fit:contain!important;
 aspect-ratio:auto!important;margin:0!important;
 transform-origin:center center!important;
 transform:translate(-50%,-50%) rotate(90deg) scale(var(--s9-thumb-scale,1.6))!important
}
</style>
<script id="s9-native-thumb-upright-script-v1">
(()=>{
 'use strict';
 // Strictly scoped to stationary native Camera2 motion thumbnails.
 // Never rotate historical Drive, old rec_ clips, MJPEG, or raw stills.
 const match=/\/s9-phone-thumbs\/motion_[0-9]{13}[.]mp4[.]thumb[.]jpg(?:[?#]|$)/;
 const selector='.s9phone-item img, #s9-human-review .review-card img';
 const watched=new WeakSet();
 const corrected=new Set();
 function apply(img){
  if(!img.isConnected||!img.complete||!img.naturalWidth||!img.naturalHeight)return;
  if(!match.test(String(img.currentSrc||img.getAttribute('src')||'')))return;
  if(img.naturalHeight<=img.naturalWidth*1.3)return;
  if(img.closest('.s9-upright-thumb-shell'))return;
  const parent=img.parentElement;
  if(!parent || !parent.matches('.s9phone-item, #s9-human-review .review-card'))return;
  const shell=document.createElement('span');
  shell.className='s9-upright-thumb-shell';
  shell.setAttribute('title','Camera2 recording preview · displayed upright without changing the JPEG');
  parent.insertBefore(shell,img);
  shell.append(img);
  img.classList.add('s9-upright-thumb');
  corrected.add(shell);
  update(shell);
 }
 function update(shell){
  if(!shell.isConnected)return;
  const width=shell.clientWidth,height=shell.clientHeight;
  if(width>0&&height>0)
   shell.style.setProperty('--s9-thumb-scale',String(width/height));
 }
 let pending=false;
 function scan(){
  pending=false;
  for(const img of document.querySelectorAll(selector)){
   if(!watched.has(img)){
    watched.add(img);
    img.addEventListener('load',()=>apply(img));
   }
   apply(img);
  }
  for(const shell of corrected){
   if(!shell.isConnected)corrected.delete(shell);
   else update(shell);
  }
 }
 function schedule(){
  if(pending)return;
  pending=true;
  requestAnimationFrame(scan);
 }
 const observer=new MutationObserver(schedule);
 observer.observe(document.documentElement,{childList:true,subtree:true});
 window.addEventListener('resize',schedule,{passive:true});
 if(document.readyState==='loading')
  document.addEventListener('DOMContentLoaded',schedule,{once:true});
 else schedule();
})();
</script>
'''

def patch(html: str) -> str:
    if html.count("</body>") != 1 or html.count('id="list"') != 1:
        raise ValueError("unexpected_security_page")
    if "s9-native-thumb-upright-" in html and not (STYLE_ID in html and SCRIPT_ID in html):
        raise ValueError("partial_thumbnail_orientation_widget")
    if STYLE_ID in html:
        if html.count(STYLE_ID) != 1 or html.count(SCRIPT_ID) != 1:
            raise ValueError("duplicate_thumbnail_orientation_widget")
        style = re.findall(r'<style id="s9-native-thumb-upright-style-v1">[\s\S]*?</style>', html)
        script = re.findall(r'<script id="s9-native-thumb-upright-script-v1">[\s\S]*?</script>', html)
        target_style = re.findall(r'<style id="s9-native-thumb-upright-style-v1">[\s\S]*?</style>', SNIPPET)
        target_script = re.findall(r'<script id="s9-native-thumb-upright-script-v1">[\s\S]*?</script>', SNIPPET)
        if len(style) != 1 or len(script) != 1:
            raise ValueError("invalid_thumbnail_orientation_widget")
        result = html.replace(style[0], target_style[0], 1)
        return result.replace(script[0], target_script[0], 1)
    if "s9-video-orientation-script-v1" not in html:
        raise ValueError("requires_verified_existing_video_orientation_widget")
    if "c720p-secure-relay-client.js" not in html:
        raise ValueError("secure_relay_required")
    return html.replace("</body>", SNIPPET + "\n</body>", 1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--page", type=Path, default=Path(
        "/opt/homeassistant/config/www/frontyard-security-new/clips.html"))
    parser.add_argument("--apply", action="store_true",
                        help="Explicit HTML-only installation; original images remain unchanged.")
    args = parser.parse_args()
    before = args.page.read_text()
    after = patch(before)
    if patch(after) != after:
        raise RuntimeError("thumbnail_orientation_not_idempotent")
    if before == after:
        print("S9_THUMBNAIL_UPRIGHT_ALREADY_PRESENT")
        return
    if not args.apply:
        print("S9_THUMBNAIL_UPRIGHT_DRY_RUN changed=True")
        return
    backup_dir = Path("/home/jespern/c720p-home-hub/backups/s9-orientation-production")
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = backup_dir / ("clips.before-thumbnail-upright." + stamp + ".html")
    shutil.copy2(args.page, backup)
    os.chmod(backup, 0o600)
    staged = args.page.with_name(args.page.name + ".thumbnail-upright-stage")
    replaced = False
    try:
        staged.write_text(after)
        os.chmod(staged, args.page.stat().st_mode & 0o777)
        if staged.read_text() != after:
            raise RuntimeError("staged_content_changed")
        os.replace(staged, args.page)
        replaced = True
        if patch(args.page.read_text()) != after:
            raise RuntimeError("post_install_validation_failed")
    except Exception:
        staged.unlink(missing_ok=True)
        if replaced:
            fallback = args.page.with_name(args.page.name + ".thumbnail-upright-rollback")
            shutil.copy2(backup, fallback)
            os.replace(fallback, args.page)
        raise
    print("S9_THUMBNAIL_UPRIGHT_HTML_ONLY_DEPLOYED",
          "rollback_backup=" + str(backup),
          "original_jpegs_modified=False original_mp4_modified=False services_restarted=False")


if __name__ == "__main__":
    main()
