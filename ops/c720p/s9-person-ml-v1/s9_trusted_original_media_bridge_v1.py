"""Trusted revision-pinned SD/Drive byte-range delegate for manual original review.

Run only inside the private threaded 8795 archive server, behind the signed
8794 relay. The V252 attestor pins full ORIGINAL SHA and revision before open;
this delegate moves bounded bytes from the EXISTING private original endpoints,
checks complete Content-Range and source revision, then reports delivery.
This is server evidence of byte delivery, NOT proof that the person watched it.
There are no writes to media or manual reviews.
"""
from urllib.parse import quote
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
import re

LIMIT=4*1024*1024
SD=re.compile(r'motion_[0-9]{13}[.]mp4$')
DRIVE=re.compile(r'[A-Za-z0-9._-]{1,180}[.]mp4$')
RANGE=re.compile(r'bytes=([0-9]+)-([0-9]*)$')
BASE='http://127.0.0.1:8795'
class Unavailable(RuntimeError):pass

def resolve_original(source,name):
    """Source-only identity, never a viewer-supplied hash or Drive path."""
    import s9_sd_proxy_extension as archive
    import s9_manual_recording_links as registry
    import s9_manual_original_byte_attestor_v252 as attested
    if source not in ('sd','drive') or not isinstance(name,str) or not (
        SD.fullmatch(name) if source=='sd' else DRIVE.fullmatch(name) and '..' not in name):
        raise Unavailable('invalid_original_name')
    if not registry.source_known(source,name,archive.rows()):
        raise Unavailable('original_not_verified_in_archive')
    rev=attested.IndependentOriginalAttestor().current_revision(source,name)
    if not isinstance(rev,dict) or not isinstance(rev.get('source_identity'),str):
        raise Unavailable('original_revision_unavailable')
    return rev['source_identity']

def requested_range(range_value,size):
    """Never stream an unlimited original through a review-open request."""
    if type(size) is not int or not 10000<=size<=4*1024*1024*1024:
        raise Unavailable('original_size_unavailable')
    if not range_value: return 0,min(size-1,LIMIT-1)
    m=RANGE.fullmatch(range_value.strip())
    if not m:raise Unavailable('unsupported_range')
    start=int(m.group(1))
    if start>=size:raise Unavailable('range_outside_original')
    end=int(m.group(2)) if m.group(2) else size-1
    if end<start:raise Unavailable('reversed_range')
    return start,min(end,size-1,start+LIMIT-1)

def serve_pinned_original(handler,source,name,nonce,pinned,after_transfer):
    """Only original_review_http_hooks can call with trusted pinned input."""
    if source not in ('sd','drive') or not isinstance(name,str) or not isinstance(pinned,dict):
        raise Unavailable('untrusted_source')
    if not callable(after_transfer) or not isinstance(pinned.get('original_sha256'),str):
        raise Unavailable('missing_original_attestation')
    size=pinned.get('size_bytes')
    try:
        start,end=requested_range(handler.headers.get('Range',''),size)
        path=('/new/saved/clip/' if source=='sd' else '/new/drive/saved/clip/')+quote(name)
        request=Request(BASE+path,headers={'Range':f'bytes={start}-{end}'},method='GET')
        with urlopen(request,timeout=20) as upstream:
            length=end-start+1
            if (upstream.status!=206 or
                upstream.headers.get('Content-Range')!=f'bytes {start}-{end}/{size}' or
                upstream.headers.get('Content-Length')!=str(length) or
                'video/' not in upstream.headers.get('Content-Type','')):
                raise Unavailable('upstream_original_range_mismatch')
            handler.send_response(206)
            handler.send_header('Content-Type','video/mp4')
            handler.send_header('Content-Length',str(length))
            handler.send_header('Content-Range',f'bytes {start}-{end}/{size}')
            handler.send_header('Accept-Ranges','bytes')
            handler.send_header('Cache-Control','private, no-store')
            handler.send_header('X-Content-Type-Options','nosniff')
            handler.end_headers()
            transferred=0
            while transferred<length:
                data=upstream.read(min(65536,length-transferred))
                if not data:raise Unavailable('incomplete_original_stream')
                handler.wfile.write(data)
                transferred+=len(data)
            handler.wfile.flush()
        # A completed bounded Range is NOT a full-original digest. The
        # full-original digest is the independently verified V252 proof.
        after_transfer({'status':206,'transferred_bytes':transferred,
            'response_original_sha256':pinned['original_sha256'],
            'source_revision':pinned['source_revision'],
            'source_identity':pinned['source_identity']})
    except (HTTPError,URLError,TimeoutError,ValueError,TypeError,Unavailable) as exc:
        # If headers were already sent, the review ticket remains unavailable.
        # Do not forge a 200 or claim that the browser loaded verified media.
        raise Unavailable('pinned_original_delivery_refused') from exc
