from pathlib import Path
import re, shutil, datetime

W=Path('/opt/homeassistant/config/www')
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
back=Path('/home/jespern/c720p-backups')/f'saved-display-v93-{stamp}'
back.mkdir(parents=True,exist_ok=True)

p=W/'c720p-drive-saved.html'
shutil.copy2(p,back/(p.name+'.before'))
s=p.read_text(encoding='utf-8')
css='''<style id="C720P_SAVED_GALLERY_V93">
html,body{height:100%!important;overflow:hidden!important}
.app{height:100vh!important;min-height:0!important;overflow:hidden!important}
.content{height:calc(100vh - 76px)!important;min-height:0!important;overflow:hidden!important;display:grid!important;grid-template-columns:minmax(270px,.72fr) minmax(0,1.55fr)!important;gap:10px!important}
.player{height:100%!important;min-height:0!important;overflow:hidden!important}
.player video{max-height:56%!important;object-fit:contain!important}
.list{height:100%!important;min-height:0!important;overflow-y:scroll!important;overflow-x:hidden!important;display:grid!important;grid-template-columns:repeat(2,minmax(210px,1fr))!important;grid-auto-rows:254px!important;gap:10px!important;align-content:start!important;padding:9px!important;scrollbar-width:thin!important}
.clip{height:254px!important;min-height:254px!important;display:grid!important;grid-template-rows:158px minmax(0,1fr)!important;border-radius:13px!important;overflow:hidden!important;border:1px solid rgba(255,255,255,.11)!important;background:linear-gradient(155deg,#0c1822,#081119)!important}
.thumbWrap{display:block!important;position:relative!important;width:100%!important;height:158px!important;min-height:158px!important;overflow:hidden!important;background:#071018!important}
.thumb{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center center!important;opacity:1!important;visibility:visible!important}
.clipBody{min-height:0!important;padding:8px 9px!important;display:grid!important;grid-template-rows:auto auto 1fr auto!important;gap:3px!important}
.clipTitle{font-size:12px!important;line-height:14px!important;font-weight:1000!important}
.clipMeta{font-size:9px!important;line-height:11px!important;white-space:normal!important}
.actions{margin-top:2px!important;display:grid!important;grid-template-columns:1fr 1fr!important;gap:6px!important}
.actions button{height:28px!important;border-radius:8px!important}
</style>'''
force='''<script id="C720P_SAVED_FORCE_THUMBS_V93">
(function(){
 function force(){
  try{
   if(typeof events==="undefined"||typeof loadThumb!=="function")return;
   document.querySelectorAll("#list .clip").forEach((el,i)=>{if(events[i]&&!el.querySelector("img.thumb"))loadThumb(el,events[i])});
  }catch(_){}
 }
 window.addEventListener("load",()=>{force();setTimeout(force,350);setTimeout(force,1100)});
 const root=document.getElementById("list");
 if(root)new MutationObserver(()=>setTimeout(force,25)).observe(root,{childList:true,subtree:true});
})();
</script>'''
if 'C720P_SAVED_GALLERY_V93' not in s:s=s.replace('</head>',css+'\n</head>',1)
if 'C720P_SAVED_FORCE_THUMBS_V93' not in s:s=s.replace('</body>',force+'\n</body>',1)
p.write_text(s,encoding='utf-8')

p=W/'c720p-surveillance.html'
shutil.copy2(p,back/(p.name+'.before'))
s=p.read_text(encoding='utf-8')
panel='''<style id="C720P_SAVED_PANEL_V93">#panel-saved{overflow:hidden!important}#cameraSavedFrame{display:block!important;width:100%!important;height:calc(100vh - 62px)!important;min-height:560px!important;border:0!important}</style>'''
if 'C720P_SAVED_PANEL_V93' not in s:s=s.replace('</head>',panel+'\n</head>',1)
s=re.sub(r'/local/c720p-drive-saved\.html\?camera=camera&v=[^"\']+','/local/c720p-drive-saved.html?camera=camera&v=SAVED_GALLERY_V93_20261007',s)
p.write_text(s,encoding='utf-8')
print('SAVED_DISPLAY_V93=OK')
print('BACKUP='+str(back))
