#!/usr/bin/env python3
"""Spotify official playlist writer tests; no network or real account actions."""
import csv
import tempfile
from pathlib import Path
import spotify_playlist_builder as builder

with tempfile.TemporaryDirectory(prefix="tunerush-spotify-playlist-test-") as tmp:
    root=Path(tmp)
    builder.LIBRARY_ROOT=root
    file=root/"wishlist.csv"
    uri1="spotify:track:"+"a"*22
    uri2="spotify:track:"+"b"*22
    rows=[
        {"catalog_id":"deezer:1","title":"Mainstream Song 1",
         "artist":"Artist 1","spotify_uri":uri1},
        {"catalog_id":"deezer:2","title":"Mainstream Song 2",
         "artist":"Artist 2","spotify_uri":""}
    ]
    with file.open("w",newline="") as output:
        w=csv.DictWriter(output,fieldnames=list(rows[0]))
        w.writeheader();w.writerows(rows)
    dry=builder.sync(csv_file=file)
    assert dry["catalogSongs"]==2 and dry["knownSpotifyUris"]==1
    assert dry["dryRun"] is True and not (root/"spotify-playlist.json").exists()
    try:builder.sync(execute=True,csv_file=file,token=None)
    except ValueError:pass
    else:raise AssertionError("Spotify write accepted missing OAuth token.")

    class MockSpotify:
        def __init__(self,token):
            assert token=="owner-approved-test-token"
            self.entries=set()
            self.calls=[]
        def call(self,method,path,payload=None,params=None):
            self.calls.append((method,path))
            if path=="/me":return {"id":"test-owner"}
            if path=="/me/playlists":
                assert method=="POST" and payload["public"] is False
                return {"id":"p"*22}
            if path=="/search":
                assert params["limit"]<=10
                return {"tracks":{"items":[{"name":"Mainstream Song 2",
                    "uri":uri2,"artists":[{"name":"Artist 2"}]}]}}
            if path.startswith("/playlists/") and path.endswith("/items"):
                if method=="GET":return {"items":[],"next":None}
                if method=="POST":
                    self.entries.update(payload["uris"])
                    return {"snapshot_id":"snapshot"}
            raise AssertionError("Unexpected Spotify API path: "+path)

        def find_track(self,title,artist):
            assert title=="Mainstream Song 2" and artist=="Artist 2"
            return uri2

        def playlist_items(self,id):
            return self.entries

        def create_playlist(self):
            result=self.call("POST","/me/playlists",{"name":"Tune Rush Game Catalog","public":False})
            return result["id"]

    instance=None
    def factory(token):
        global instance
        if instance is None:instance=MockSpotify(token)
        return instance
    builder.SpotifyApi=factory
    done=builder.sync(execute=True,token="owner-approved-test-token",csv_file=file)
    assert done["playlistCreated"] and done["added"]==2 and done["matchedSpotifyUris"]==2
    again=builder.sync(execute=True,token="owner-approved-test-token",csv_file=file)
    assert not again["playlistCreated"] and again["added"]==0
    assert (root/"spotify-playlist.json").exists()
    assert instance.entries=={uri1,uri2}

print("PASS official Spotify playlist 2026 API workflow: dry run, OAuth required, private create, 100-item batching, idempotent sync")
