#!/usr/bin/env python3
"""Metadata-only Deezer mainstream-hit catalog builder.

Uses public curated/editorial playlists, filters Deezer rank >= 600k.
No audio or expiring preview URLs are saved or redistributed.
Do not publish audio playback until provider approval is secured.
"""
import argparse
import concurrent.futures
import datetime
import json
import re
import unicodedata
import urllib.request
from collections import Counter
from pathlib import Path

API = "https://api.deezer.com"
MIN_RANK = 600000
# Playlist ID, genre(s), decade(s), attribution.
PLAYLISTS = [
 (620264073,("pop",),("1960",),"60s Hits"),
 (1437011185,("rock",),("1960",),"60s Rock"),
 (1470022445,("pop",),("1970",),"70s Hits"),
 (8877326262,("pop",),("1970",),"70s Happy Hits"),
 (2015058202,("disco","dance"),("1970","1980"),"Disco Essentials"),
 (867825522,("pop",),("1980",),"80s Hits"),
 (1413309725,("rock",),("1980",),"80s Pop Rock"),
 (8311303422,("pop",),("1980",),"80s NL Hits"),
 (878989033,("pop","rock"),("1990",),"90s Hits"),
 (2322259622,("pop","dance"),("1990",),"90s Party Hits"),
 (4135981802,("dance","electronic"),("1990",),"90s Dance"),
 (248297032,("pop","rock"),("2000",),"00s Hits"),
 (1977689462,("pop","dance"),("2000",),"00s Party Hits"),
 (1419215845,("rock",),("2000",),"2000s Rock"),
 (2021626162,("rnb",),("2000",),"2000s R&B"),
 (14917741483,("pop",),("2010",),"10s Hits"),
 (8282573142,("pop",),("2010",),"10s Pop"),
 (7662551722,("hiphop",),("2010",),"10s Rap"),
 (13650084141,("pop",),("2020",),"20s Hits"),
 (12547421383,("hiphop",),("2020",),"2020s Rap"),
 (752286631,("rock",),(),"Rock Hits"),
 (11242423484,("rock",),(),"Rock Super Hits"),
 (1976915302,("hiphop",),(),"East Coast Essentials"),
 (706093725,("dance","electronic"),(),"Global Dance Hits"),
 (1902101402,("electronic",),(),"Electronic Hits"),
 (12566903723,("disco","dance"),(),"Disco Super Hits"),
 (1999466402,("rnb",),(),"R&B Hits"),
 (1388965575,("metal",),(),"Metal Hits"),
 (735488796,("indie",),(),"Indie Supreme"),
 (8311306722,("pop",),("2010",),"10s NL Hits"),
]
REJECT = re.compile(
 r"\b(karaoke|tribute|re-recorded|cover version|instrumental version|sped up|"
 r"nightcore|backing track|originally performed by|live at|live in concert)\b",re.I
)

def norm(value):
 s=unicodedata.normalize("NFKD",str(value)).casefold()
 s="".join(c for c in s if not unicodedata.combining(c))
 return " ".join(re.findall("[a-z0-9]+",s))

def get_playlist(spec):
 pid,genres,eras,name=spec
 req=urllib.request.Request(
  API+"/playlist/"+str(pid)+"/tracks?limit=100",
  headers={"Accept":"application/json","User-Agent":"TuneRushCatalogEvaluation/1.0"})
 with urllib.request.urlopen(req,timeout=12) as response:
  data=json.load(response)
 if not isinstance(data,dict) or not isinstance(data.get("data"),list):
  raise ValueError("Unexpected playlist result")
 return spec,data["data"]

def parse(raw):
 if not isinstance(raw,dict):return None
 try:
  id=int(raw.get("id") or 0)
  title=str(raw.get("title") or "").strip()[:140]
  artist=str((raw.get("artist") or {}).get("name") or "").strip()[:110]
  rank=int(raw.get("rank") or 0)
  duration=int(raw.get("duration") or 0)
 except (ValueError,TypeError):return None
 if (id<=0 or rank<MIN_RANK or not title or not artist or
     not 30<=duration<=7200 or REJECT.search(title+" "+artist) or
     not str(raw.get("preview") or "").startswith("https://")):return None
 return {"id":id,"title":title,"artist":artist,"rank":rank,
         "duration":duration,"genres":[],"decades":[],"sources":[],
         "link":"https://www.deezer.com/track/"+str(id)}

def build():
 catalog={}
 errors=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
  pending={executor.submit(get_playlist,s):s for s in PLAYLISTS}
  for future in concurrent.futures.as_completed(pending):
   spec=pending[future]
   try:(_,tags,eras,name),items=future.result()
   except Exception as e:
    errors.append({"id":spec[0],"reason":type(e).__name__})
    continue
   for raw in items:
    track=parse(raw)
    if track is None:continue
    key=norm(track["artist"])+"|"+norm(track["title"])
    dest=catalog.setdefault(key,track)
    if track["rank"]>dest["rank"]:
     for field in ("id","rank","duration","link"):dest[field]=track[field]
    dest["genres"]=sorted(set(dest["genres"]).union(tags))
    dest["decades"]=sorted(set(dest["decades"]).union(eras))
    dest["sources"]=sorted(set(dest["sources"]).union((name,)))
 tracks=sorted(catalog.values(),key=lambda t:(-t["rank"],t["artist"].casefold()))
 return {"version":1,"provider":"deezer","status":"staging-metadata-only",
         "generatedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
         "minRank":MIN_RANK,
         "rankMeaning":"Relative Deezer popularity index, NOT streams",
         "decadeMeaning":"Curated playlist tag, not confirmed recording year",
         "previewURLStored":False,"licenseApproved":False,
         "counts":{"tracks":len(tracks),
                   "genres":dict(sorted(Counter(g for t in tracks for g in t["genres"]).items())),
                   "decades":dict(sorted(Counter(d for t in tracks for d in t["decades"]).items())),
                   "failedSources":errors},
         "tracks":tracks}

def candidates(data,genres,decades,limit=10):
 if data.get("provider")!="deezer" or data.get("version")!=1:
  raise ValueError("Invalid metadata catalog")
 if limit not in (5,10,20) or not genres:raise ValueError("Invalid game filters")
 hits=[t for t in data["tracks"] if
       any(g in t["genres"] for g in genres)
       and (not decades or any(d in t["decades"] for d in decades))
       and t["rank"]>=MIN_RANK]
 if len(hits)<limit:raise ValueError("Not enough well-known songs in this genre/era. Expand filters.")
 return hits

if __name__=="__main__":
 cli=argparse.ArgumentParser()
 cli.add_argument("--output",default="deezer-hit-index.json")
 args=cli.parse_args()
 output=Path(args.output)
 data=build()
 if len(data["tracks"])<100:raise SystemExit("Unable to build a trustworthy mainstream catalog")
 output.parent.mkdir(parents=True,exist_ok=True)
 tmp=output.with_suffix(".tmp")
 tmp.write_text(json.dumps(data,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
 tmp.replace(output)
 print("TRACKS",data["counts"]["tracks"])
 print("DECADES",data["counts"]["decades"])
 print("GENRES",data["counts"]["genres"])
 print("FAILED",data["counts"]["failedSources"])
 for name in ("Africa","Sweet Dreams","Gangsta's Paradise","Take on Me"):
  track=next((t for t in data["tracks"] if name.casefold() in t["title"].casefold()),None)
  if track:print("EXAMPLE",track["artist"],"-",track["title"],"RANK",track["rank"])
