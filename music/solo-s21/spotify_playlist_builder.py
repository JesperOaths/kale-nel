#!/usr/bin/env python3
"""Create or extend a Spotify playlist from the Tune Rush 975-song catalog.

Spotify metadata only: never downloads audio. Uses the 2026 Web API endpoints,
and requires an owner-authorized OAuth token with playlist-modify-private.
Default is a no-network dry run.
"""
from __future__ import annotations
import argparse
import csv
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from persistent_music_library import PersistentMusicLibrary, LIBRARY_ROOT
from music_library_sync import WISHLIST

API="https://api.spotify.com/v1"
PLAYLIST_NAME="Tune Rush Game Catalog"
_ID=re.compile(r"^[A-Za-z0-9]{22}$")
_URI=re.compile(r"^spotify:track:[A-Za-z0-9]{22}$")


def norm(value):
    s=unicodedata.normalize("NFKD",str(value or "").casefold())
    s="".join(ch for ch in s if not unicodedata.combining(ch))
    return " ".join(re.findall(r"[a-z0-9]+",s))


class SpotifyApi:
    def __init__(self,token):
        if not isinstance(token,str) or not token.strip():
            raise ValueError("An owner-authorized Spotify OAuth token is required.")
        self.token=token.strip()

    def call(self,verb,path,payload=None,params=None):
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("Unsafe Spotify API path.")
        url=API+path
        if params:url+="?"+urllib.parse.urlencode(params)
        body=json.dumps(payload).encode() if payload is not None else None
        request=urllib.request.Request(url,method=verb,data=body,headers={
            "Authorization":"Bearer "+self.token,
            "Content-Type":"application/json",
            "Accept":"application/json",
            "User-Agent":"TuneRushPlaylistMetadata/1.0"})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(request,timeout=18) as r:
                    data=r.read(1024*1024)
                    return json.loads(data) if data else {}
            except urllib.error.HTTPError as e:
                if e.code==429 and attempt<4:
                    delay=int(e.headers.get("Retry-After","3"))
                    time.sleep(max(1,min(delay,90)))
                    continue
                if e.code in (401,403):
                    raise ValueError("Spotify OAuth token missing, expired, or insufficient permissions.") from e
                raise ValueError("Spotify API error HTTP "+str(e.code)) from e
        raise RuntimeError("Spotify rate limit was not resolved.")

    def find_track(self,title,artist):
        query="track:"+title+" artist:"+artist
        items=self.call("GET","/search",params={"q":query,"type":"track","limit":5})
        candidates=[]
        for entry in items.get("tracks",{}).get("items",[]):
            if not isinstance(entry,dict):continue
            uri=entry.get("uri")
            if not isinstance(uri,str) or not _URI.fullmatch(uri):continue
            names=[norm(a.get("name")) for a in entry.get("artists",[])
                   if isinstance(a,dict)]
            if norm(entry.get("name"))==norm(title) and norm(artist) in names:
                candidates.append(uri)
        return candidates[0] if len(set(candidates))==1 else None

    def playlist_items(self,playlist_id):
        found=set()
        for offset in range(0,20000,50):
            result=self.call("GET","/playlists/"+playlist_id+"/items",
                params={"limit":50,"offset":offset})
            items=result.get("items",[])
            for item in items:
                track=item.get("item") or item.get("track") or {}
                uri=track.get("uri") if isinstance(track,dict) else None
                if isinstance(uri,str) and _URI.fullmatch(uri):found.add(uri)
            if not result.get("next"):break
        return found

    def create_playlist(self):
        result=self.call("POST","/me/playlists",{
            "name":PLAYLIST_NAME,
            "public":False,
            "description":"Mainstream song catalog for Tune Rush. Metadata only; no audio downloads."})
        result_id=result.get("id")
        if not isinstance(result_id,str) or not _ID.fullmatch(result_id):
            raise ValueError("Spotify did not return a valid playlist ID.")
        return result_id


def sync(*,execute=False,token=None,csv_file=WISHLIST,max_search=200):
    target=Path(csv_file)
    if not target.exists():
        raise ValueError("First generate the Tune Rush curated song CSV.")
    with target.open(newline="",encoding="utf-8-sig") as f:
        songs=list(csv.DictReader(f))
    known=[x for x in songs if _URI.fullmatch(x.get("spotify_uri") or "")]
    missing=[x for x in songs if x not in known]
    status={"catalogSongs":len(songs),"knownSpotifyUris":len(known),
        "unresolvedSpotifyUris":len(missing),"maxSearchPerRun":max_search,
        "playlistCreated":False,"added":0,"dryRun":not execute}
    if not execute:return status
    if not token:raise ValueError("Spotify OAuth authorization is required to create the playlist.")
    api=SpotifyApi(token)
    account=api.call("GET","/me")
    if not account.get("id"):raise ValueError("Spotify owner authorization failed.")
    # Never expose the bearer token in source files, logs or the public page.
    state_path=LIBRARY_ROOT/"spotify-playlist.json"
    state=json.loads(state_path.read_text()) if state_path.exists() else {}
    playlist_id=state.get("playlist_id")
    if playlist_id is not None and not _ID.fullmatch(str(playlist_id)):
        raise ValueError("Saved Spotify playlist ID is malformed.")
    uri_map=state.get("matched",{})
    new_searches=0
    for song in missing:
        key=song.get("catalog_id")
        if not key or key in uri_map:continue
        if new_searches>=max_search:break
        matched=api.find_track(song["title"],song["artist"])
        if matched:uri_map[key]=matched
        new_searches+=1
    desired=[]
    for song in songs:
        uri=song.get("spotify_uri") or uri_map.get(song.get("catalog_id"))
        if uri and _URI.fullmatch(uri) and uri not in desired:
            desired.append(uri)
    if not desired:
        raise ValueError("No Spotify IDs could be matched confidently; playlist left unchanged.")
    # Create only when at least one song is resolved. Keep future runs idempotent.
    if not playlist_id:
        playlist_id=api.create_playlist()
        status["playlistCreated"]=True
    existing=api.playlist_items(playlist_id)
    additions=[x for x in desired if x not in existing]
    for index in range(0,len(additions),100):
        api.call("POST","/playlists/"+playlist_id+"/items",
            {"uris":additions[index:index+100]})
        status["added"]+=len(additions[index:index+100])
    state_path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    temp=state_path.with_suffix(".tmp")
    temp.write_text(json.dumps({"playlist_id":playlist_id,
        "matched":uri_map,"updated":int(time.time())},indent=2))
    temp.chmod(0o600);temp.replace(state_path)
    status["playlistUrl"]="https://open.spotify.com/playlist/"+playlist_id
    status["matchedSpotifyUris"]=len(desired)
    status["remainingSearchable"]=max(0,len(missing)-new_searches)
    return status


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--execute",action="store_true",
        help="Requires owner-approved Spotify OAuth; otherwise metadata-only dry run")
    parser.add_argument("--max-search",type=int,default=200)
    options=parser.parse_args()
    print(json.dumps(sync(execute=options.execute,
        token=os.environ.get("TUNERUSH_SPOTIFY_ACCESS_TOKEN"),
        max_search=options.max_search),indent=2))
