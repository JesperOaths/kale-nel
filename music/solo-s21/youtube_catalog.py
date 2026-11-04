"""Mainstream Tune Rush catalog: curated hits with verified indexed YouTube videos.

Contains metadata and YouTube identifiers only. No audio/video downloads,
proxying, ripping or hidden/background playback. The browser must use the
visible official YouTube IFrame Player API.
"""
from pathlib import Path
import json
import random
import re

BASE=Path.home()/"tune-rush-solo"/"staging"/"mainstream"
CATALOG_PATH=BASE/"catalog.json"
VIDEOS_PATH=BASE/"youtube-verified-ids.json"
VIDEO_ID=re.compile(r"^[A-Za-z0-9_-]{11}$")
MIN_HISTORICAL_VIEWS=10_000_000
MIN_DEEZER_RANK=600_000

def pool(catalog_path=CATALOG_PATH,videos_path=VIDEOS_PATH):
 try:
  catalog=json.loads(Path(catalog_path).read_text(encoding="utf-8"))
  video_index=json.loads(Path(videos_path).read_text(encoding="utf-8"))
 except (OSError,ValueError) as err:
  raise ValueError("Mainstream YouTube catalog is not installed on the S21.") from err
 if (catalog.get("version")!=1 or catalog.get("provider")!="deezer"
    or video_index.get("version")!=1 or "youtube" not in video_index.get("source","").lower()):
  raise ValueError("Mainstream YouTube metadata format is invalid.")
 ids={}
 for item in video_index.get("matches",[]):
  if not isinstance(item,list) or len(item)!=3:continue
  track_id,video_id,views=item
  if (type(track_id)!=int or type(views)!=int or views<MIN_HISTORICAL_VIEWS
       or not isinstance(video_id,str) or not VIDEO_ID.fullmatch(video_id)):continue
  ids[track_id]=(video_id,views)
 seen=set()
 accepted=[]
 for t in catalog.get("tracks",[]):
  try:track_id=int(t["id"]);rank=int(t["rank"])
  except (KeyError,TypeError,ValueError):continue
  if rank<MIN_DEEZER_RANK or track_id not in ids:continue
  video_id,views=ids[track_id]
  if video_id in seen:continue
  seen.add(video_id)
  accepted.append({
   "id":"yt_"+video_id, "videoId":video_id,
   "artist":str(t["artist"])[:100],
   "title":str(t["title"])[:100],
   "rank":rank,"youtubeViewsAtIndex":views,
   "genres":list(t.get("genres",[])),
   "decades":list(t.get("decades",[])),
   "duration":210,  # Upper bound is determined by the embedded YouTube player.
  })
 return accepted

def select(genres,decades,limit,*,catalog=None):
 if not isinstance(genres,list) or not genres:
  raise ValueError("Select at least one music genre.")
 if not isinstance(decades,list):raise ValueError("Invalid era filter.")
 if type(limit)!=int or limit not in (5,10,20):
  raise ValueError("Choose 5, 10 or 20 songs.")
 available=pool() if catalog is None else catalog
 candidates=[t for t in available if any(g in t["genres"] for g in genres)
   and (not decades or any(d in t["decades"] for d in decades))]
 if len(candidates)<limit:
  raise ValueError(
   f"Only {len(candidates)} verified popular YouTube songs match this mix. "
   "Choose more genres, All eras, or a shorter game."
  )
 return candidates

def choose(tracks,used):
 choices=[t for t in tracks if t["id"] not in used]
 if not choices:raise ValueError("No unused verified YouTube songs remain.")
 # Favor widely viewed videos, while preserving variety across the setlist.
 weights=[max(1,t["youtubeViewsAtIndex"])**0.35 for t in choices]
 return random.choices(choices,weights=weights,k=1)[0]
