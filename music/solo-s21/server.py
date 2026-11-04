#!/usr/bin/env python3
"""Tune Rush Solo: LAN-only game service, designed for Samsung S21 / Termux."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import RLock, Event, Thread
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit, urlencode
from difflib import SequenceMatcher
import hashlib, hmac, ipaddress, json, os, random, re, secrets, socket, time
import unicodedata, urllib.request, urllib.error
from game_audio_cache import GameAudioCache, MAX_TRACKS

ROOT=Path(__file__).resolve().parent
DATA=Path(os.environ.get("TUNERUSH_SOLO_DATA",str(Path.home()/".tunerush-solo")))
CATALOG_STATE=DATA/"popular-audius-v2.json"
CATALOG_TTL=3600
POPULAR_MIN_PLAYS=50000
HOST=os.environ.get("TUNERUSH_SOLO_BIND","::")
PORT=int(os.environ.get("TUNERUSH_SOLO_PORT","8797"))
API="https://api.audius.co/v1"
DURATIONS=(500,1500,3000,5000,8000,12000,20000)
GENRES={"pop":"Pop","rock":"Rock","hiphop":"Hip-Hop/Rap",
 "electronic":"Electronic","dance":"Electronic","disco":"Disco",
 "indie":"Alternative","rnb":"R&B/Soul","metal":"Metal"}
LOCK=RLock()
SESSIONS={}
CACHE={}
GENRE_CACHE={}
GENRE_INFLIGHT={}
STATE=DATA/"state.json"
GAME_CACHE=GameAudioCache()

def norm(value):
 value=unicodedata.normalize("NFKD",str(value).casefold())
 value="".join(c for c in value if not unicodedata.combining(c))
 return " ".join(re.findall("[a-z0-9]+",value))

def matches(guess,answer):
 a,b=norm(guess),norm(answer)
 if not a or not b:return False
 if a==b:return True
 if len(a)<5 or len(b)<5:return False
 if a.startswith("the ") and a[4:]==b:return True
 if b.startswith("the ") and b[4:]==a:return True
 return SequenceMatcher(None,a,b).ratio()>=0.9

def ident(track):
 return hashlib.sha256((norm(track["artist"])+"|"+norm(track["title"])).encode()).hexdigest()[:20]

def track_from(item,genres,decades):
 if not isinstance(item,dict) or not item.get("is_streamable"):return None
 if any(item.get(k) for k in ("is_unlisted","is_delete","is_premium","is_blocked")):return None
 id=str(item.get("id") or "")
 if not re.fullmatch("[A-Za-z0-9_-]{3,32}",id):return None
 title=str(item.get("title") or "").strip()[:100]
 artist=str((item.get("user") or {}).get("name") or "").strip()[:100]
 try:
  duration=int(item.get("duration") or 0)
  plays=max(0,int(item.get("play_count") or 0))
 except (ValueError,TypeError):return None
 if not title or not artist or not 35<=duration<=7200:return None
 # Audius trending is not a measure of recognizability: it can contain uploads
 # with single-digit listens. Strictly never use them in a guessing quiz.
 if plays<POPULAR_MIN_PLAYS:return None
 category=str(item.get("genre") or "").casefold()
 if not any(category in (GENRES[g].casefold(),
  {"dance":"electronic","indie":"alternative"}.get(g,"__none__")) for g in genres):return None
 date=str(item.get("orig_release_date") or item.get("release_date") or "")
 year=int(date[:4]) if re.match(r"^\d{4}",date) else None
 if decades and (year is None or str(year//10*10) not in decades):return None
 return {"id":id,"title":title,"artist":artist,"duration":duration,
         "plays":plays,"year":year}


def restore_catalog():
 try:
  obj=json.loads(CATALOG_STATE.read_text(encoding="utf-8"))
  if obj.get("version")!=2:return
  with LOCK:
   for genre,entry in obj.get("genres",{}).items():
    if (genre in GENRES.values() and isinstance(entry,dict)
        and isinstance(entry.get("at"),(int,float))
        and isinstance(entry.get("tracks"),list)):
     GENRE_CACHE[genre]=(entry["at"],entry["tracks"])
 except (OSError,ValueError,TypeError,AttributeError):pass


def save_catalog():
 # Cache publicly available metadata only: no protected media or credentials.
 try:
  DATA.mkdir(mode=0o700,parents=True,exist_ok=True)
  tmp=CATALOG_STATE.with_suffix(".tmp")
  obj={"version":2,"genres":{genre:{"at":ts,"tracks":tracks}
    for genre,(ts,tracks) in GENRE_CACHE.items()}}
  with tmp.open("w",encoding="utf-8") as f:
   json.dump(obj,f,ensure_ascii=False,separators=(",",":"))
  os.chmod(tmp,0o600);os.replace(tmp,CATALOG_STATE)
 except OSError:pass


def genre_catalog(genre):
 with LOCK:
  cached=GENRE_CACHE.get(genre)
  if cached and time.time()-cached[0]<CATALOG_TTL:return list(cached[1])
  waiting=GENRE_INFLIGHT.get(genre)
  if waiting is None:
   waiting=Event();GENRE_INFLIGHT[genre]=waiting;leader=True
  else:leader=False
 if not leader:
  waiting.wait(timeout=15)
  with LOCK:
   recent=GENRE_CACHE.get(genre)
   return list(recent[1]) if recent else None
 try:
  url=API+"/tracks/trending?"+urlencode({
   "genre":genre,"time":"allTime","limit":100,"offset":0})
  req=urllib.request.Request(url,headers={
   "Accept":"application/json","User-Agent":"TuneRushSolo/2.0"})
  with urllib.request.urlopen(req,timeout=9) as response:
   rows=json.load(response).get("data")
  if not isinstance(rows,list):return None
  keys=[g for g in GENRES if GENRES[g]==genre]
  tracks=[t for item in rows if (t:=track_from(item,keys,[]))]
  with LOCK:
   GENRE_CACHE[genre]=(time.time(),tracks)
   save_catalog()
  return tracks
 except (OSError,ValueError,TypeError):return None
 finally:
  with LOCK:
   GENRE_INFLIGHT.pop(genre,None);waiting.set()


def discover(genres,decades):
 genre_values=list(dict.fromkeys(GENRES[g] for g in genres))
 with ThreadPoolExecutor(max_workers=min(6,len(genre_values))) as workers:
  catalogs=list(workers.map(genre_catalog,genre_values))
 if not any(rows is not None for rows in catalogs):
  raise ValueError("Audius is unavailable. Check S21 internet access.")
 songs={}
 for_rows=zip(genre_values,catalogs)
 for genre,rows in for_rows:
  if rows is None:continue
  for t in rows:
   if decades and (t.get("year") is None or str(t["year"]//10*10) not in decades):
    continue
   songs.setdefault(ident(t),t)
 found=sorted(songs.values(),key=lambda t:(-t["plays"],t["artist"],t["title"]))
 if not found:
  if decades:
   raise ValueError("No tracks with 50,000+ Audius plays match this release era. Try All eras or more genres.")
  raise ValueError("No tracks with 50,000+ Audius plays match these genres. Choose other genres.")
 return found

restore_catalog()

def persist():
 DATA.mkdir(mode=0o700,parents=True,exist_ok=True)
 temp=STATE.with_suffix(".tmp")
 with temp.open("w",encoding="utf-8") as f:json.dump({"version":1,"sessions":SESSIONS},f)
 os.chmod(temp,0o600);os.replace(temp,STATE)

def restore():
 try:
  with STATE.open(encoding="utf-8") as f:state=json.load(f)
  if state.get("version")!=1:return
  for key,s in list(state.get("sessions",{}).items())[:16]:
   if (re.fullmatch("[0-9a-f]{64}",key) and time.time()-s["updated"]<43200
       and (s.get("source") in ("youtube","owned-library") or
            os.environ.get("TUNERUSH_ALLOW_AUDIUS_TESTS")=="1")):
    s["ticket"]=secrets.token_urlsafe(24)
    SESSIONS[key]=s
 except (OSError,ValueError,TypeError,KeyError):pass

def choose(s):
 if s.get("source")=="youtube":
  from youtube_catalog import choose as choose_youtube
  song=choose_youtube(s["pool"],s["used"])
  s["track"]=song;s["used"].append(song["id"])
  s["ticket"]=secrets.token_urlsafe(24)
  # Random beginning for EACH new song, retained for replay/longer clues.
  # The YouTube player itself controls seek/stop, so no audio is extracted.
  s["cueMs"]=1000*(25+secrets.randbelow(56))
 elif s.get("source")=="owned-library":
  from owned_library import select_next
  song=select_next(s["pool"],s["used"])
  s["track"]=song;s["used"].append(song["id"])
  s["ticket"]=secrets.token_urlsafe(24)
  s["cueMs"]=0
 else:
  available=[t for t in s["pool"] if t.get("plays",0)>=POPULAR_MIN_PLAYS and ident(t) not in s["used"]]
  if not available:raise ValueError("No unused songs left in this mix.")
  weights=[max(1,t["plays"])**.5 for t in available]
  song=random.choices(available,weights=weights,k=1)[0]
  s["track"]=song;s["used"].append(ident(song))
  s["ticket"]=secrets.token_urlsafe(24)
  last=song["duration"]*1000-21000
  s["cueMs"]=min(last,max(0,int(song["duration"]*150))) # 15% into the track
 s["phase"]="ready";s["step"]=-1;s["guessedStep"]=-1
 s["titleDone"]=False;s["artistDone"]=False;s["last"]=None

def reveal(s):
 if s["phase"] in ("revealed","finished"):return
 s["phase"]="revealed"
 t=s["track"]
 if not any(h["round"]==s["round"] for h in s["history"]):
  s["history"].append({"round":s["round"],"title":t["title"],"artist":t["artist"],
   "clues":s["step"]+1,"titleCorrect":s["titleDone"],"artistCorrect":s["artistDone"]})

def view(s):
 response={"version":1,"phase":s["phase"],"round":s["round"],"limit":s["limit"],
  "score":s["score"],"step":s["step"],"guessedStep":s["guessedStep"],
  "durations":DURATIONS,"titleDone":s["titleDone"],"artistDone":s["artistDone"],
  "history":s["history"],"last":s["last"],"available":len(s["pool"]),
  "genres":s["genres"],"decades":s["decades"],
  "source":s.get("source","audius-legacy"),
  "minPlays":POPULAR_MIN_PLAYS if s.get("source") not in ("youtube","owned-library") else None}
 if s["phase"] in ("revealed","finished"):
  response["reveal"]={"title":s["track"]["title"],"artist":s["track"]["artist"]}
  if s.get("source")=="youtube":
   response["reveal"]["youtubeViewsAtIndex"]=s["track"]["youtubeViewsAtIndex"]
   response["reveal"]["youtubeUrl"]="https://www.youtube.com/watch?v="+s["track"]["videoId"]
  elif s.get("source")=="owned-library":
   response["reveal"]["rank"]=s["track"]["rank"]
   response["reveal"]["link"]="https://www.deezer.com/track/"+str(s["track"]["deezerId"])
  else:response["reveal"]["plays"]=s["track"]["plays"]
 else:
  response["media"]=("youtube:"+s["track"]["videoId"]
   if s.get("source")=="youtube" else
   "owned:"+s["track"]["fileId"] if s.get("source")=="owned-library"
   else "/api/audio/"+s["ticket"])
  response["cueMs"]=s["cueMs"]
 return response


def new_session(data):
 genres=data.get("genres",["pop","rock"]);decades=data.get("decades",[])
 limit=data.get("limit",10)
 if (not isinstance(genres,list) or not 1<=len(genres)<=len(GENRES) or
     any(type(g)!=str or g not in GENRES for g in genres) or
     not isinstance(decades,list) or len(decades)>8 or
     any(type(d)!=str or not re.fullmatch("19[6-9]0|20[0-2]0",d) for d in decades)):
  raise ValueError("Invalid music filters.")
 if type(limit)!=int or limit not in (5,10,20):
  raise ValueError("Choose 5, 10 or 20 songs.")
 source=data.get("source","youtube")
 if source=="youtube":
  from youtube_catalog import select as select_youtube
  pool=select_youtube(genres,decades,limit)
 elif source=="owned-library":
  from owned_library import select
  pool=select(data.get("library"),genres,decades,limit)
 elif source=="legacy-audius" and os.environ.get("TUNERUSH_ALLOW_AUDIUS_TESTS")=="1":
  # Existing offline regression fixtures only; NEVER available in production.
  pool=discover(genres,decades)
  if len(pool)<limit:raise ValueError("Insufficient test fixtures.")
 else:
  raise ValueError("Audius is retired. Choose YouTube video playback or music you own.")
 with LOCK:
  for k,s in list(SESSIONS.items()):
   if time.time()-s["updated"]>43200:
    SESSIONS.pop(k,None)
    GAME_CACHE.delete(k)
  if len(SESSIONS)>=4:
   completed=sorted(((k,v) for k,v in SESSIONS.items() if v["phase"]=="finished"),key=lambda pair:pair[1]["updated"])
   if completed:
    finished_token=completed[0][0]
    SESSIONS.pop(finished_token,None)
    GAME_CACHE.delete(finished_token)
  if len(SESSIONS)>=16:raise ValueError("S21 already has sixteen active sessions. Finish or resume an existing game.")
  token=secrets.token_hex(32)
  s={"genres":genres,"decades":decades,"limit":limit,"pool":pool,
     "source":source,"catalogVersion":4 if source=="youtube" else 3 if source=="owned-library" else 2,
     "round":1,"score":0.0,"used":[],"history":[],"updated":time.time()}
  choose(s)
  # One GiB shared, at most ten recyclable slots even in a 20-round game.
  if source in ("youtube","owned-library"):
   GAME_CACHE.reserve(token,slots=min(MAX_TRACKS,limit),source=source)
  SESSIONS[token]=s;persist()
  return {"token":token,"state":view(s)}

def operation(s,data,token=None):
 op=data.get("op")
 if type(data.get("round"))!=int or data["round"]!=s["round"]:
  raise ValueError("Stale round: refresh your game.")
 phase=s["phase"]
 if op=="clue":
  if phase not in ("ready","playing") or s["step"]>=6:
   raise ValueError("No clues remain; reveal the song.")
  # A player may freely request the next or any longer clue without
  # submitting a guess. Moving forward forfeits the unused guess for
  # earlier durations, but never changes the score or exposes the answer.
  target=data.get("targetStep",s["step"]+1)
  if type(target)!=int or not s["step"]<target<len(DURATIONS):
   raise ValueError("Choose a clue that is longer than the current one.")
  s["step"]=target;s["phase"]="playing";s["last"]=None
 elif op=="answer":
  if phase!="playing" or s["step"]<0 or s["guessedStep"]==s["step"]:
   raise ValueError("Play a clue first. One guess is allowed per clue.")
  title=str(data.get("title") or "")[:100].strip()
  artist=str(data.get("artist") or "")[:100].strip()
  if not title and not artist:raise ValueError("Enter a title or artist.")
  before=s["score"];results={}
  for field,guess,done in (("title",title,"titleDone"),("artist",artist,"artistDone")):
   if s[done]:results[field]="already-correct"
   elif not guess:results[field]="not-entered"
   elif matches(guess,s["track"][field]):
    s[done]=True;s["score"]=round(s["score"]+.5,1);results[field]="correct"
   else:
    s["score"]=max(0,round(s["score"]-.5,1));results[field]="incorrect"
  s["last"]={**results,"delta":round(s["score"]-before,1)}
  s["guessedStep"]=s["step"]
  if s["titleDone"] and s["artistDone"] or s["step"]==6:reveal(s)
  else:s["phase"]="ready"
 elif op=="reveal":
  if phase not in ("ready","playing"):raise ValueError("Already revealed.")
  reveal(s)
 elif op=="next":
  if phase!="revealed":raise ValueError("Reveal the song first.")
  if s["round"]>=s["limit"]:s["phase"]="finished"
  else:
   # An existing saved game may have been created with the old obscure
   # trending catalog. Upgrade its next-round pool without losing the
   # current game or resetting scores.
   if s.get("source") in ("legacy-audius","audius-legacy") and s.get("catalogVersion")!=2:
    s["pool"]=discover(s["genres"],s["decades"])
    s["catalogVersion"]=2
   try:choose(s);s["round"]+=1
   except ValueError:s["phase"]="finished"
 elif op=="finish":
  if phase!="finished":
   reveal(s);s["phase"]="finished"
 else:raise ValueError("Unknown command.")
 s["updated"]=time.time()
 if token and s.get("source") in ("youtube","owned-library"):
  if s["phase"]=="finished":
   GAME_CACHE.delete(token)
  else:
   GAME_CACHE.touch(token)
 return {"state":view(s)}

def check_token(headers):
 header=headers.get("Authorization","")
 if not header.startswith("Bearer "):return None
 token=header[7:]
 if not re.fullmatch("[0-9a-f]{64}",token):return None
 with LOCK:
  s=next((v for k,v in SESSIONS.items() if hmac.compare_digest(k,token)),None)
  return s if s and time.time()-s["updated"]<43200 else None

class Handler(BaseHTTPRequestHandler):
 protocol_version="HTTP/1.0"
 server_version="TuneRushSolo/1.0"
 def log_message(self,*args):pass # Do not log private media tickets.
 def allowed(self):
  try:
   peer=ipaddress.ip_address(self.client_address[0].split("%",1)[0])
   if isinstance(peer,ipaddress.IPv6Address) and peer.ipv4_mapped:
    peer=peer.ipv4_mapped
   if peer.is_loopback:return True
   if isinstance(peer,ipaddress.IPv4Address):return peer.is_private
   if peer.is_link_local or peer.is_private:return True
   local=ipaddress.ip_address(self.connection.getsockname()[0])
   return peer.version==6 and local.version==6 and (int(peer)>>64)==(int(local)>>64)
  except (ValueError,TypeError,OSError):return False
 def headers_safe(self):
  self.send_header("Cache-Control","no-store")
  self.send_header("X-Content-Type-Options","nosniff")
  self.send_header("X-Frame-Options","DENY")
  self.send_header("Referrer-Policy","no-referrer")
 def json_out(self,status,obj):
  data=json.dumps(obj,ensure_ascii=False,separators=(",",":")).encode()
  self.send_response(status)
  self.send_header("Content-Type","application/json; charset=utf-8")
  self.send_header("Content-Length",str(len(data)))
  self.headers_safe();self.end_headers()
  if self.command!="HEAD":self.wfile.write(data)
 def body(self):
  n=int(self.headers.get("Content-Length",0))
  if not 0<n<=4096:raise ValueError("Invalid request size.")
  data=json.loads(self.rfile.read(n))
  if not isinstance(data,dict):raise ValueError("Invalid JSON object.")
  return data
 def do_POST(self):
  if not self.allowed():return self.json_out(403,{"error":"Local Wi-Fi only."})
  origin=self.headers.get("Origin","")
  if origin and urlsplit(origin).netloc!=self.headers.get("Host",""):
   return self.json_out(403,{"error":"Cross-origin requests are blocked."})
  try:
   data=self.body();p=urlsplit(self.path).path
   if p=="/api/session":return self.json_out(200,new_session(data))
   if p!="/api/action":return self.json_out(404,{"error":"Not found."})
   s=check_token(self.headers)
   if not s:return self.json_out(401,{"error":"Game session expired."})
   with LOCK:
    result=operation(s,data,self.headers.get("Authorization","")[7:]);persist()
   return self.json_out(200,result)
  except (ValueError,TypeError,KeyError) as e:
   return self.json_out(400,{"error":str(e)[:160]})
  except (OSError,RuntimeError) as e:
   return self.json_out(503,{"error":str(e)[:160]})
 def do_HEAD(self):self.get_route()
 def do_GET(self):self.get_route()
 def get_route(self):
  if not self.allowed():return self.json_out(403,{"error":"Local Wi-Fi only."})
  p=urlsplit(self.path).path
  if p=="/api/health":
   return self.json_out(200,{"service":"tunerush-s21-solo","ready":True,"version":1})
  if p=="/api/state":
   s=check_token(self.headers)
   return self.json_out(200,{"state":view(s)}) if s else self.json_out(401,{"error":"Game session expired."})
  if p.startswith("/api/audio/"):
   if os.environ.get("TUNERUSH_ALLOW_AUDIUS_TESTS")!="1":
    return self.json_out(410,{"error":"Audius streaming is retired."})
   ticket=p[len("/api/audio/"):]
   if not re.fullmatch("[A-Za-z0-9_-]{25,40}",ticket):
    return self.json_out(404,{"error":"Music unavailable."})
   with LOCK:
    s=next((x for x in SESSIONS.values() if hmac.compare_digest(x["ticket"],ticket)),None)
    id=s["track"]["id"] if s else None
   return self.proxy_audio(id) if id else self.json_out(404,{"error":"Music expired."})
  if p in ("/","/index.html","/app.js","/style.css"):
   name="index.html" if p=="/" else p.lstrip("/")
   try:content=(ROOT/"web"/name).read_bytes()
   except OSError:return self.json_out(404,{"error":"Page unavailable."})
   self.send_response(200)
   self.send_header("Content-Type",("text/html" if name.endswith(".html") else
    "text/javascript" if name.endswith(".js") else "text/css")+"; charset=utf-8")
   self.send_header("Content-Length",str(len(content)))
   self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'")
   self.headers_safe();self.end_headers()
   if self.command!="HEAD":self.wfile.write(content)
   return
  self.json_out(404,{"error":"Not found."})


 def proxy_audio(self,id):
  req=urllib.request.Request(API+"/tracks/"+id+"/stream",
   headers={"User-Agent":"TuneRushSolo/1.0","Accept":"audio/*"})
  range_header=self.headers.get("Range","")
  if range_header:
   if not re.fullmatch(r"bytes=\d+-\d*",range_header):
    return self.json_out(416,{"error":"Invalid audio range."})
   req.add_header("Range",range_header)
  req.get_method=lambda:self.command
  try:
   with urllib.request.urlopen(req,timeout=15) as upstream:
    if range_header and upstream.status!=206:
     return self.json_out(502,{"error":"Audius did not allow seeking in this stream."})
    self.send_response(upstream.status)
    self.send_header("Content-Type",upstream.headers.get("Content-Type","audio/mpeg"))
    for h in ("Content-Length","Content-Range","Accept-Ranges"):
     if upstream.headers.get(h):self.send_header(h,upstream.headers[h])
    self.headers_safe();self.end_headers()
    if self.command=="HEAD":return
    while True:
     chunk=upstream.read(65536)
     if not chunk:break
     try:self.wfile.write(chunk)
     except (BrokenPipeError,ConnectionResetError):break
  except urllib.error.HTTPError as err:
   self.json_out(502,{"error":"Audius stream failed (HTTP "+str(err.code)+")."})
  except (OSError,TimeoutError):
   self.json_out(503,{"error":"Audius stream temporarily unavailable."})

class DualStackServer(ThreadingHTTPServer):
 address_family=socket.AF_INET6
 def server_bind(self):
  self.socket.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,0)
  super().server_bind()

def _cache_janitor():
 # Remove abandoned temporary recordings every five minutes.
 while True:
  try:GAME_CACHE.sweep()
  except (OSError,ValueError):pass
  time.sleep(300)

def serve(host=HOST,port=PORT):
 DATA.mkdir(mode=0o700,parents=True,exist_ok=True)
 GAME_CACHE.sweep()
 restore()
 Thread(target=_cache_janitor,name="TuneRushAudioJanitor",daemon=True).start()
 server=DualStackServer((host,port),Handler)
 server.daemon_threads=True
 print("Tune Rush Solo listening on port "+str(server.server_port),flush=True)
 try:server.serve_forever()
 finally:server.server_close()

if __name__=="__main__":
 serve()

