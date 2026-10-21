"""Bounded same-process loopback HTTP check of the running V369 reader.

Only callable from the private 8795 threaded server. No cache, model, phone
read or fallback to imported module source; refuse old in-memory handlers.
"""
import urllib.error
import urllib.request

URL = 'http://127.0.0.1:8795/new/api/evidence-quality'
LIMIT = 6_000_000

def fetch_live_http(path, opener=urllib.request.urlopen):
    if path != '/new/api/evidence-quality':
        raise ValueError('fixed_v369_path_only')
    req = urllib.request.Request(URL, headers={'Cache-Control':'no-store'}, method='GET')
    try:
        with opener(req, timeout=5) as result:
            declared = result.headers.get('Content-Length')
            if declared is not None and (not declared.isdecimal() or int(declared)>LIMIT):
                raise ValueError('oversized_v369_document')
            raw = result.read(LIMIT+1)
            if len(raw)>LIMIT:raise ValueError('oversized_v369_document')
            return result.status,raw
    except urllib.error.HTTPError as exc:
        return exc.code,b''
