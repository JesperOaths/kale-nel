from pathlib import Path
import shutil,datetime,re
W=Path('/opt/homeassistant/config/www')
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
b=Path('/home/jespern/c720p-backups')/f'saved-v93-{stamp}'
b.mkdir(parents=True,exist_ok=True)

p=W/'c720p-drive-saved.html'
shutil.copy2(p,b/(p.name+'.before'))
s=p.read_text(encoding='utf-8')
css='''<style id="C720P_SAVED_GALLERY_V93">
html,body{height:100%!important;overflow:hidden!important}
.app{height:100vh!important;min-height:0!important;overflow:hidden!important}
.content{min-height:0!important;height:100%!important;overflow:hidden!important;grid-template-columns:minmax(300px,.72fr) minmax(0,1.55fr)!important;gap:10px!important}
.player{height:100%!important;min-height:0!important;overflow:hidden!important}
.player video{max-height:58%!important;object-fit:contain!important}
.list{height:100%!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;padding:10px!important;grid-template-columns:repeat(2,minmax(220px,1fr))!important;grid-auto-rows:266px!important;gap:10px!important;align-content:start!important;scrollbar-width:thin!important;scrollbar-color:#2c485a #081019!important}
.clip{height:266px!important;min-height:266px!important;grid-template-rows:168px minmax(0,1fr)!important;border-radius:13px!important;border:1px solid rgba(93,188,255,.14)!important;box-shadow:0 5px 17px rgba(0,0,0,.18)!important}
.thumbWrap{display:block!important;height:168px!important;min-height:168px!important;width:100%!important}
.thumb{display:block!important;visibility:visible!important;opacity:1!important;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center center!important}
.clipBody{min-height:0!important;padding:8px 9px 9px!important;grid-template-rows:auto auto minmax(0,1fr) auto!important;gap:2px!important}
.actions{display:grid!important;grid-template-columns:1fr 1fr!important;gap:6px!important;margin-top:4px!important}
.actions button{height:28px!important;border-radius:8px!important;padding:0 7px!important}
@media(max-width:1050px){.content{grid-template-columns:1fr!important}.player{display:none!important}.list{grid-template-columns:repeat(2,minmax(190px,1fr))!important}}
</style>'''
if 'C720P_SAVED_GALLERY_V93' not in s:s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

p=W/'c720p-surveillance.html'
shutil.copy2(p,b/(p.name+'.before'))
s=p.read_text(encoding='utf-8')
css='''<style id="C720P_SAVED_PANEL_V93">#panel-saved{overflow:hidden!important}#cameraSavedFrame{display:block!important;width:100%!important;height:100%!important;min-height:0!important;border:0!important;background:#050a10!important}</style>'''
if 'C720P_SAVED_PANEL_V93' not in s:s=s.replace('</head>',css+'\n</head>',1)
s=re.sub(r'/local/c720p-drive-saved\.html\?camera=camera&v=[^"\']+','/local/c720p-drive-saved.html?camera=camera&v=SAVED_GALLERY_V93_20261007',s)
p.write_text(s,encoding='utf-8')
print('SAVED_V93=OK')
print('BACKUP='+str(b))
