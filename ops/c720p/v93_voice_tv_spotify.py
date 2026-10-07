from pathlib import Path
import re, shutil, datetime

WWW=Path('/opt/homeassistant/config/www')
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=Path('/home/jespern/c720p-backups')/f'v93-ui-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)

def backup(p):
    if p.exists():
        shutil.copy2(p,BACK/(p.name+'.before'))

# Voice: preserve outer dimensions; redesign only internals.
p=WWW/'c720p-voice-banner.html'; backup(p)
s=p.read_text(encoding='utf-8')
css=r'''<style id="C720P_VOICE_SPACE_V93">
/* V93: internal-only redesign. The surrounding Lovelace iframe/aspect ratio is untouched. */
.card{overflow:hidden!important;padding:0!important}
.inner{
  height:100%!important;min-height:0!important;box-sizing:border-box!important;
  padding:10px 12px 9px!important;
  display:grid!important;
  grid-template-rows:minmax(0,1fr) auto!important;
  gap:8px!important;
}
.main{
  min-height:0!important;
  display:grid!important;
  grid-template-columns:72px minmax(0,1fr)!important;
  align-items:center!important;
  gap:12px!important;
  padding:0!important;margin:0!important;
}
.orb{
  width:68px!important;height:68px!important;min-width:68px!important;
  border-radius:50%!important;
  display:grid!important;place-items:center!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 8px 22px rgba(0,0,0,.28),0 0 22px rgba(58,186,255,.08)!important;
}
.copy{min-width:0!important;display:flex!important;flex-direction:column!important;justify-content:center!important;gap:5px!important}
.title{
  font-size:22px!important;line-height:23px!important;font-weight:1000!important;
  letter-spacing:-.025em!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important
}
.detail{
  font-size:12px!important;line-height:14px!important;font-weight:760!important;
  color:#b8cbd9!important;white-space:normal!important;max-height:29px!important;overflow:hidden!important
}
.metrics{
  width:100%!important;
  display:grid!important;
  grid-template-columns:repeat(4,minmax(0,1fr))!important;
  gap:6px!important;
  margin:0!important;padding:0!important;
}
.metric{
  min-width:0!important;min-height:43px!important;
  padding:5px 6px!important;border-radius:10px!important;
  display:flex!important;flex-direction:column!important;justify-content:center!important;align-items:center!important;
  text-align:center!important;
  background:linear-gradient(155deg,rgba(255,255,255,.06),rgba(255,255,255,.025))!important;
  border:1px solid rgba(255,255,255,.095)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.035)!important
}
.metric .label{
  font-size:7.5px!important;line-height:9px!important;font-weight:900!important;
  letter-spacing:.05em!important;text-transform:uppercase!important;color:#829bad!important;
  white-space:nowrap!important
}
.metric .value{
  margin-top:2px!important;font-size:16px!important;line-height:17px!important;font-weight:1000!important;
  color:#f4fbff!important;font-variant-numeric:tabular-nums!important;
  white-space:nowrap!important
}
.metric.peak .value{color:#ffc978!important}
.metric.mic .value{color:#8ce5ff!important}
.version{
  position:absolute!important;right:9px!important;top:7px!important;
  font-size:7px!important;line-height:8px!important;opacity:.44!important
}
</style>'''
if 'C720P_VOICE_SPACE_V93' not in s:
    s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

# TV / Surround copy cleanup + visual order swap without altering handlers.
p=WWW/'c720p-tv-surround-v21.html'; backup(p)
s=p.read_text(encoding='utf-8')
s=s.replace('Find IR +','')
s=s.replace('TV & surround','TV & Surround')
swap_js=r'''<script id="C720P_TV_VOLUME_ORDER_V93">
document.addEventListener('DOMContentLoaded',()=>{
  const buttons=[...document.querySelectorAll('button')];
  const minus=buttons.find(b=>/volume\s*[−-]/i.test((b.textContent||'').trim()));
  const plus=buttons.find(b=>/volume\s*\+/i.test((b.textContent||'').trim()));
  if(minus&&plus&&minus.parentElement===plus.parentElement){
    const p=minus.parentElement;
    if(minus.compareDocumentPosition(plus)&Node.DOCUMENT_POSITION_FOLLOWING){
      p.insertBefore(plus,minus);
    }
  }
});
</script>'''
if 'C720P_TV_VOLUME_ORDER_V93' not in s:
    s=s.replace('</body>',swap_js+'\n</body>',1)
p.write_text(s,encoding='utf-8')

# Spotify: hub-consistent tactile controls, while retaining existing button semantics.
p=WWW/'c720p-spotify-compact-v1.html'; backup(p)
s=p.read_text(encoding='utf-8')
css=r'''<style id="C720P_SPOTIFY_CONTROLS_V93">
button,.btn,[role="button"]{
  -webkit-tap-highlight-color:transparent;
}
button{
  min-width:38px!important;height:36px!important;
  border-radius:11px!important;
  border:1px solid rgba(75,210,139,.22)!important;
  color:#effff6!important;
  background:
    radial-gradient(90% 140% at 12% 0%,rgba(67,218,139,.17),transparent 60%),
    linear-gradient(145deg,rgba(17,45,35,.90),rgba(10,27,22,.90))!important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.075),
    inset 0 -1px 0 rgba(0,0,0,.16),
    0 4px 12px rgba(0,0,0,.18)!important;
  font-weight:950!important;
  transition:transform .12s ease,filter .12s ease,border-color .12s ease!important;
}
button:hover{filter:brightness(1.12)!important;border-color:rgba(88,229,153,.38)!important}
button:active{transform:translateY(1px) scale(.96)!important;filter:brightness(.96)!important}
button svg,button ha-icon{filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))!important}
.controls,.buttons,.playerControls,.transport,.actions{
  gap:7px!important;
}
.controls button:first-child,.playerControls button:first-child{
  border-color:rgba(89,222,151,.34)!important;
}
</style>'''
if 'C720P_SPOTIFY_CONTROLS_V93' not in s:
    s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

print('VOICE_PATCH=OK')
print('TV_COPY_ORDER_PATCH=OK')
print('SPOTIFY_PATCH=OK')
print('BACKUP='+str(BACK))
