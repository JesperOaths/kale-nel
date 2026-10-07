from pathlib import Path
import re,shutil,datetime
W=Path('/opt/homeassistant/config/www'); stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
B=Path('/home/jespern/c720p-backups')/f'v94-ui-{stamp}'; B.mkdir(parents=True,exist_ok=True)
def backup(p):
    if p.exists(): shutil.copy2(p,B/(p.name+'.before'))

# Extra row: correct room labels, restore real Agenda icons, static-text capitalization.
p=W/'c720p-extra-row-v85.html'; backup(p); s=p.read_text(encoding='utf-8')
s=s.replace('<span class="sensorName">Living</span>','<span class="sensorName">Bathroom</span>',1)
s=s.replace('<span class="sensorName">Bedroom</span>','<span class="sensorName">Living Room</span>',1)
for a,b in [
 ('<div class="title">Upcoming calendar</div>','<div class="title">Agenda</div>'),
 ('id="calBadge" class="badge">checking<','id="calBadge" class="badge">Checking<'),
 ('id="ambientSummary" class="ambientSummary">Ambient sensors<','id="ambientSummary" class="ambientSummary">Ambient Sensors<'),
 ('id="mode" class="mode">connecting<','id="mode" class="mode">Connecting<'),
 ('<div class="title">Now playing</div>','<div class="title">Now Playing</div>'),
 ('id="track" class="track">Nothing playing<','id="track" class="track">Nothing Playing<'),
 ('id="artist" class="artist">C720P audio hub<','id="artist" class="artist">C720P Audio Hub<'),
 ('id="prev">Prev<','id="prev">Previous<')
]: s=s.replace(a,b)
agenda_css='''<style id="C720P_AGENDA_ICONS_V94">
.calendarBox .agendaEvent{padding-left:52px!important}
.calendarBox .agendaIcon.ico{
 position:absolute!important;left:9px!important;top:9px!important;width:34px!important;height:34px!important;
 border-radius:10px!important;display:block!important;opacity:1!important;background-size:22px 22px!important;
 background-position:center!important;background-repeat:no-repeat!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 4px 12px rgba(0,0,0,.16)!important
}
.calendarBox .agendaEvent.today .agendaIcon{box-shadow:inset 0 0 0 1px rgba(255,255,255,.20),0 0 12px rgba(91,190,255,.16)!important}
.calendarBox .agendaKind,.calendarBox .agendaCountdown{font-size:8.5px!important}
.calendarBox .agendaSource{text-transform:none!important}
</style>'''
agenda_js='''<script id="C720P_AGENDA_ICON_DECORATOR_V94">
(()=>{const root=document.getElementById("events");if(!root)return;
 const decorate=()=>root.querySelectorAll(".agendaEvent").forEach(e=>{if(!e.querySelector(".agendaIcon")){const i=document.createElement("span");i.className="agendaIcon ico";i.setAttribute("aria-hidden","true");e.prepend(i)}});
 new MutationObserver(decorate).observe(root,{childList:true,subtree:true});decorate();
})();
</script>'''
if 'C720P_AGENDA_ICONS_V94' not in s:s=s.replace('</head>',agenda_css+'\n</head>',1)
if 'C720P_AGENDA_ICON_DECORATOR_V94' not in s:s=s.replace('</body>',agenda_js+'\n</body>',1)
p.write_text(s,encoding='utf-8')

# Voice: use the same allocated iframe size, but never ellipsize speech/status text.
p=W/'c720p-voice-banner.html'; backup(p); s=p.read_text(encoding='utf-8')
voice_css='''<style id="C720P_VOICE_REFLOW_V94">
.inner{padding:9px 11px 8px!important;grid-template-rows:minmax(0,1fr) 40px!important;gap:6px!important}
.main{grid-template-columns:60px minmax(0,1fr)!important;gap:10px!important;min-height:0!important}
.orb{width:58px!important;height:58px!important;min-width:58px!important}
.copy{min-width:0!important;gap:3px!important;overflow:visible!important}
.title{
 font-size:18px!important;line-height:19px!important;font-weight:1000!important;letter-spacing:-.018em!important;
 white-space:normal!important;overflow:visible!important;text-overflow:clip!important;overflow-wrap:anywhere!important
}
.detail{
 margin:0!important;font-size:11px!important;line-height:13px!important;font-weight:760!important;color:#b8cbd9!important;
 white-space:normal!important;overflow-y:auto!important;overflow-x:hidden!important;text-overflow:clip!important;
 max-height:39px!important;scrollbar-width:thin!important
}
.metrics{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:5px!important;height:40px!important}
.metric{min-width:0!important;min-height:40px!important;padding:4px 4px!important;border-radius:9px!important}
.metric .label{font-size:7px!important;line-height:8px!important}
.metric .value{font-size:15px!important;line-height:16px!important;margin-top:2px!important}
</style>'''
voice_js='''<script id="C720P_VOICE_TEXT_FIT_V94">
(()=>{const t=document.querySelector(".title"),d=document.querySelector(".detail");if(!t||!d)return;
 function fit(){
  const n=(t.textContent||"").trim().length,m=(d.textContent||"").trim().length;
  t.style.fontSize=(n>58?14.5:n>40?16:n>24?17:18)+"px";
  t.style.lineHeight=(n>40?17:19)+"px";
  d.style.fontSize=(m>135?9.5:m>80?10.2:11)+"px";
  d.style.lineHeight=(m>80?11.5:13)+"px";
 }
 new MutationObserver(fit).observe(t,{childList:true,subtree:true,characterData:true});
 new MutationObserver(fit).observe(d,{childList:true,subtree:true,characterData:true});fit();
})();
</script>'''
if 'C720P_VOICE_REFLOW_V94' not in s:s=s.replace('</head>',voice_css+'\n</head>',1)
if 'C720P_VOICE_TEXT_FIT_V94' not in s:s=s.replace('</body>',voice_js+'\n</body>',1)
p.write_text(s,encoding='utf-8')

# Clock: same outer iframe size, fuller internal composition.
p=W/'c720p-time-mini.html'; backup(p)
clock='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:#f5f2ec;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.box{height:100vh;min-height:0;border-radius:10px;background:radial-gradient(circle at 16% 0%,rgba(255,184,96,.12),transparent 38%),linear-gradient(155deg,#111b25,#080d13 72%);border:1px solid rgba(255,255,255,.08);padding:8px 10px;display:grid;grid-template-rows:auto 1fr auto;gap:2px;overflow:hidden}
.top,.bottom{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}.kicker{font-size:8px;line-height:9px;font-weight:950;letter-spacing:.12em;text-transform:uppercase;color:#9eabba}.year,.week{border-radius:999px;padding:3px 7px;border:1px solid rgba(255,189,112,.16);background:rgba(255,189,112,.08);font-size:8px;line-height:9px;font-weight:950;color:#ffcf97;white-space:nowrap}
.timeRow{min-height:0;display:flex;align-items:center;justify-content:center;gap:3px}.time{font-size:48px;line-height:.88;font-weight:1000;color:#ffbd70;letter-spacing:-.045em;font-variant-numeric:tabular-nums;text-shadow:0 4px 18px rgba(255,157,64,.10)}.seconds{align-self:flex-end;margin-bottom:5px;font-size:15px;line-height:16px;font-weight:900;color:#9eabba;font-variant-numeric:tabular-nums}
.date{min-width:0;font-size:11.5px;line-height:13px;color:#edf0f2;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:clip;text-transform:capitalize}
@media(max-height:94px){.box{padding:6px 9px}.time{font-size:40px}.date{font-size:10px}.seconds{font-size:13px;margin-bottom:3px}}
</style></head><body><div class="box"><div class="top"><span class="kicker">Local Time</span><span id="year" class="year">----</span></div><div class="timeRow"><span id="time" class="time">--:--</span><span id="seconds" class="seconds">:--</span></div><div class="bottom"><span id="date" class="date"></span><span id="week" class="week">Week --</span></div></div>
<script>
function isoWeek(d){const x=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));x.setUTCDate(x.getUTCDate()+4-(x.getUTCDay()||7));const y=new Date(Date.UTC(x.getUTCFullYear(),0,1));return Math.ceil((((x-y)/86400000)+1)/7)}
function tick(){const d=new Date(),parts=new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(d),g=t=>parts.find(x=>x.type===t)?.value||"--";document.getElementById("time").textContent=g("hour")+":"+g("minute");document.getElementById("seconds").textContent=":"+g("second");document.getElementById("date").textContent=d.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});document.getElementById("year").textContent=d.getFullYear();document.getElementById("week").textContent="Week "+isoWeek(d)}
tick();setInterval(tick,1000)
</script></body></html>'''
p.write_text(clock,encoding='utf-8')

# Spotify: two polished control rows, real Play/Pause focal button + audio controls.
p=W/'c720p-spotify-compact-v1.html'; backup(p); s=p.read_text(encoding='utf-8')
old=re.search(r'<div class="controls">.*?</div><div id="state"',s,re.S)
if not old: raise SystemExit('Spotify controls block not found')
svg_prev='<svg viewBox="0 0 24 24"><path d="M6 5v14M18 6l-8 6 8 6z"/></svg>'
svg_next='<svg viewBox="0 0 24 24"><path d="M18 5v14M6 6l8 6-8 6z"/></svg>'
svg_shuffle='<svg viewBox="0 0 24 24"><path d="M4 7h3c4 0 6 10 10 10h3M17 14l3 3-3 3M4 17h3c1.5 0 2.7-1.2 3.8-2.8M17 4l3 3-3 3M14 9c1-1.2 2-2 3-2h3"/></svg>'
svg_down='<svg viewBox="0 0 24 24"><path d="M5 10v4h4l5 4V6l-5 4H5M17 12h4"/></svg>'
svg_mute='<svg viewBox="0 0 24 24"><path d="M5 10v4h4l5 4V6l-5 4H5M17 9l4 6M21 9l-4 6"/></svg>'
svg_up='<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4H4M16 9c1 1 1 5 0 6M19 7c2 2 2 8 0 10"/></svg>'
svg_play='<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>'
controls=f'''<div class="controls"><div class="transport"><button class="btn" data-act="media_previous_track" aria-label="Previous">{svg_prev}</button><button id="playPause" class="btn main" data-act="media_play_pause" aria-label="Play or Pause">{svg_play}</button><button class="btn" data-act="media_next_track" aria-label="Next">{svg_next}</button></div><div class="audioControls"><button id="shuffle" class="btn small" data-control="shuffle" aria-label="Shuffle">{svg_shuffle}</button><button class="btn small" data-control="volumeDown" aria-label="Volume Down">{svg_down}</button><button id="mute" class="btn small" data-control="mute" aria-label="Mute">{svg_mute}</button><button class="btn small" data-control="volumeUp" aria-label="Volume Up">{svg_up}</button></div></div><div id="state"'''
s=s[:old.start()]+controls+s[old.end():]
spotify_css='''<style id="C720P_SPOTIFY_LAYOUT_V94">
.right{gap:4px!important}.controls{display:grid!important;grid-template-rows:auto auto!important;gap:5px!important}.transport,.audioControls{display:flex!important;align-items:center!important;gap:6px!important}
.transport .btn{width:34px!important;height:32px!important;border-radius:10px!important}.transport .main{width:42px!important;height:42px!important;border-radius:50%!important;background:linear-gradient(145deg,#31d77f,#169a58)!important;border-color:rgba(93,255,166,.48)!important;box-shadow:inset 0 1px rgba(255,255,255,.24),0 5px 16px rgba(28,190,102,.25)!important}
.audioControls .small{width:30px!important;height:27px!important;border-radius:9px!important;background:linear-gradient(145deg,rgba(32,55,48,.95),rgba(10,27,22,.95))!important}
.btn svg{width:16px!important;height:16px!important;fill:none!important;stroke:currentColor!important;stroke-width:1.9!important;stroke-linecap:round!important;stroke-linejoin:round!important}.main svg{width:19px!important;height:19px!important;fill:currentColor!important;stroke:none!important}
.btn.active{color:#baffd1!important;border-color:rgba(79,235,145,.55)!important;background:linear-gradient(145deg,rgba(34,108,69,.95),rgba(17,70,45,.95))!important}
.state{font-size:9px!important}.title{font-size:14px!important}.artist{font-size:10px!important}
@media(max-height:145px){.art{max-height:92px}.transport .main{width:37px!important;height:37px!important}.transport .btn{height:29px!important}.audioControls .small{height:24px!important}.controls{gap:3px!important}}
</style>'''
if 'C720P_SPOTIFY_LAYOUT_V94' not in s:s=s.replace('</head>',spotify_css+'\n</head>',1)
# Replace main-button render text with SVG and active state handling.
play_svg_js="'<svg viewBox=\"0 0 24 24\"><path d=\"M8 5l11 7-11 7z\"/></svg>'"
pause_svg_js="'<svg viewBox=\"0 0 24 24\"><path d=\"M7 5h4v14H7zM13 5h4v14h-4z\"/></svg>'"
s=s.replace("document.querySelector('.main').textContent=s.state==='playing'?'Ⅱ':'▶'",
            f"$('playPause').innerHTML=s.state==='playing'?{pause_svg_js}:{play_svg_js};$('shuffle').classList.toggle('active',!!a.shuffle);$('mute').classList.toggle('active',!!a.is_volume_muted);const vol=Number(a.volume_level);$('state').textContent=(s.state==='playing'?'Playing':s.state==='paused'?'Paused':'Ready')+(Number.isFinite(vol)?' · Volume '+Math.round(vol*100)+'%':'')")
old_click="document.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;const h=hass();if(!h||!eid)return;h.callService('media_player',b.dataset.act,{entity_id:eid}).catch(()=>{})});"
new_click="""document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const h=hass();if(!h||!eid)return;const st=h.states?.[eid],a=st?.attributes||{};if(b.dataset.act){h.callService('media_player',b.dataset.act,{entity_id:eid}).catch(()=>{});return}const c=b.dataset.control;if(!c)return;if(c==='shuffle')h.callService('media_player','shuffle_set',{entity_id:eid,shuffle:!a.shuffle}).catch(()=>{});else if(c==='mute')h.callService('media_player','volume_mute',{entity_id:eid,is_volume_muted:!a.is_volume_muted}).catch(()=>{});else if(c==='volumeDown'){const v=Number(a.volume_level);h.callService('media_player',Number.isFinite(v)?'volume_set':'volume_down',Number.isFinite(v)?{entity_id:eid,volume_level:Math.max(0,v-.05)}:{entity_id:eid}).catch(()=>{})}else if(c==='volumeUp'){const v=Number(a.volume_level);h.callService('media_player',Number.isFinite(v)?'volume_set':'volume_up',Number.isFinite(v)?{entity_id:eid,volume_level:Math.min(1,v+.05)}:{entity_id:eid}).catch(()=>{})}});"""
if old_click not in s: raise SystemExit('Spotify click handler not found')
s=s.replace(old_click,new_click)
p.write_text(s,encoding='utf-8')

print('V94_UI_COMPONENTS=OK')
print('BACKUP='+str(B))
