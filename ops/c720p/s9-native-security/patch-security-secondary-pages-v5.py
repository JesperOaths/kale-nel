#!/usr/bin/env python3
"""Unified styling for the existing Faces and Drive archive HTML.

Presentation only: keep all native controls, filters, media and authentication.
"""
import re

FACE_MARKER='id="s9v5-face-style"'
DRIVE_MARKER='id="s9v5-drive-style"'

FACE=r'''
<style id="s9v5-face-style">
:root{color-scheme:dark;--bg:#0a111b;--surface:#111e2d;--raised:#17293b;--line:#334a5d;--ink:#f0f8fc;--muted:#98b1c3;--cyan:#80e6d6;--amber:#f8bd72}
html{background:#0a111b}
body{background:radial-gradient(ellipse at 90% -10%,#18384b,transparent 34%),#0a111b!important;color:#f0f8fc!important;padding:clamp(12px,2vw,28px)!important;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif!important}
.heading{align-items:center!important;margin-bottom:15px;gap:18px}
.kicker{color:#65dfc9!important;font-size:10px!important;letter-spacing:.17em!important}
h1{font-size:clamp(23px,3vw,35px)!important;font-weight:870!important;letter-spacing:-.05em!important}
.heading p{color:#9fb7c6!important;font-size:12px!important}
.state{padding:9px 14px!important;background:#162e3a!important;border:1px solid #42677a!important;font-weight:700!important}
.stats{gap:12px!important;margin:16px 0 20px!important;grid-template-columns:repeat(4,minmax(0,1fr))!important}
.stat{background:linear-gradient(150deg,#1c3243,#11212f)!important;border:1px solid #354f61!important;border-radius:16px!important;padding:20px!important;box-shadow:0 9px 22px #0002}
.stat strong{font-size:clamp(27px,3.2vw,38px)!important;font-weight:850!important;letter-spacing:-.045em}
.stat span{color:#a2b8c7!important;font-size:12px!important}
.scan-progress{border-radius:15px!important;background:#142636!important;border:1px solid #365468!important;padding:17px 20px!important}
.scan-meter{height:7px!important;border:0!important;background:#263f50!important}
.scan-meter div{background:linear-gradient(90deg,#38aeaf,#78f0c9)!important}
.notice{background:#2b271b!important;border:1px solid #806f4a!important;border-radius:13px!important;color:#ead6aa!important;padding:12px 16px!important;line-height:1.5}
.filters{position:sticky;top:0;z-index:4;background:#0e1924f2!important;border:1px solid #304b5e;border-radius:13px;padding:11px!important;gap:8px!important;backdrop-filter:blur(14px);margin:15px 0!important}
.filters button{min-height:36px!important;background:#1a2e3d!important;border:1px solid #3c5b70!important;border-radius:9px!important;padding:8px 11px!important;font-size:12px!important}
.filters button[aria-pressed=true]{background:#79e8d2!important;border-color:#79e8d2!important;color:#082530!important}
.filters input,.filters select{min-height:36px!important;background:#112231!important;border:1px solid #395467!important;border-radius:9px!important;color:#e7f5fc!important}
.count{font-size:11px!important;color:#a2bdc7!important;margin:10px 2px!important}
.gallery{grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))!important;gap:14px!important}
.card{border:1px solid #385269!important;border-radius:15px!important;background:#152637!important;box-shadow:0 8px 26px #0003;transition:transform .16s,border-color .16s}
.card:hover{transform:translateY(-2px);border-color:#62aeb7!important}
.visual{height:170px!important;background:radial-gradient(ellipse at 50% 25%,#294553,#0b1b27)!important}
.visual img{object-fit:contain!important}
.visual .type{background:#0a1a25ef!important;border:1px solid #5b8b94!important;border-radius:7px!important}
.card-body{padding:15px!important;gap:7px!important}
.card h3{font-size:14px!important;font-weight:750!important;color:#f2fbff}
.chip{background:#20394a;border:1px solid #496b7b!important;padding:3px 8px!important}
.actions button,.more{background:#1d4856!important;color:#dcf8f0!important;border:1px solid #4d8791!important;border-radius:9px!important}
dialog{background:#111d2b!important;border:1px solid #45687a!important;border-radius:18px!important;box-shadow:0 30px 85px #000a}
dialog video{max-height:70dvh!important;border-radius:11px!important}
footer{color:#7a96a8!important}
@media(max-width:780px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}.filters{position:static!important}.gallery{grid-template-columns:repeat(auto-fill,minmax(min(100%,215px),1fr))!important}}
@media(prefers-reduced-motion:reduce){.card{transition:none!important}}
</style>
'''
DRIVE=r'''
<style id="s9v5-drive-style">
:root{color-scheme:dark!important;--bg:#0a111b;--panel:#142333;--card:#192c3d;--ink:#ebf8fc;--muted:#9cb5c3;--line:#365266;--accent:#69e7d4}
html,body{background:#0a111b!important;color:#edf8fd!important}
body{background:radial-gradient(ellipse at 90% -18%,#224050,transparent 38%),#0a111b!important;color:#edf8fd!important;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif!important;min-height:100vh;scrollbar-color:#49697c #0a111b}
h1{font-weight:850!important;letter-spacing:-.04em!important;color:#f1fafc!important;font-size:clamp(23px,3vw,32px)!important}
h2,h3{color:#edf8fc!important;letter-spacing:-.02em}
header,main,section,article{min-width:0}
button,select,input{font-family:inherit!important}
button{border-radius:10px!important}
button:not(:disabled):hover{filter:brightness(1.12)}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #7beddb!important;outline-offset:2px}
iframe{border:0!important}
video{background:#02070a!important;border-radius:12px!important;object-fit:contain!important}
img{max-width:100%;object-fit:contain}
table{border-collapse:separate!important;border-spacing:0!important;overflow:hidden}
th,td{border-color:#334a5d!important}
label,small,footer{color:#a2b9c8}
body:has(#savedList) #savedList,body:has(#list) #list{min-width:0}
@media(max-width:750px){body{padding:10px!important}video{max-height:40dvh!important}}
</style>
'''

def insert(html,marker,style,required):
 if html.count('</head>')!=1 or html.count('</body>')!=1:
  raise ValueError('unrecognized_secondary_page')
 for part in required:
  if part not in html:raise ValueError('missing_secondary_anchor_'+part)
 if marker in html:
  if html.count(marker)!=1:raise ValueError('duplicate_v5_page_style')
  expression=r'<style '+re.escape(marker)+r'>(?s:.*?)</style>'
  match=re.search(expression,html)
  if not match:raise ValueError('broken_v5_secondary_style')
  return html[:match.start()]+style.strip()+html[match.end():]
 return html.replace('</head>',style+'\n</head>',1)

def face(html):
 return insert(html,FACE_MARKER,FACE,('id="gallery"','id="playerDialog"','id="filters"'))

def archive(html):
 return insert(html,DRIVE_MARKER,DRIVE,('C720PSecureRelay','/api/saved'))
