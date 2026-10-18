"""Compatibility hook retiring Security's derived 30-fps playback feature.

Original MP4 range serving remains in the existing signed archive/phone relay.
Keep the historical import hook so regenerating the archive entry point cannot
bring conversion workers back or break the separately maintained review API.
"""
import re
import urllib.parse

ROUTE=re.compile(r"/(new|s3)/saved/clip/[A-Za-z0-9._-]+[.]mp4\Z")
RETIRED={"prepare","hub","rgb_prepare","rgb_pack"}

def install(handler_class,phone_rows):
    import quiet_http_disconnect_v1
    quiet_http_disconnect_v1.install(handler_class)
    if not getattr(handler_class,"_smooth_copy_retired_v1",False):
        original=handler_class.go
        def go(handler):
            parsed=urllib.parse.urlsplit(handler.path)
            modes=urllib.parse.parse_qs(parsed.query).get("playback",[])
            if ROUTE.fullmatch(parsed.path) and any(mode in RETIRED for mode in modes):
                return handler.js(410,{"ok":False,"error":"derived_playback_removed",
                    "original_path":parsed.path})
            return original(handler)
        handler_class.go=go
        handler_class._smooth_copy_retired_v1=True
    import s9_visual_review_v36
    s9_visual_review_v36.install(handler_class,external=hasattr(handler_class,"authorized"))
