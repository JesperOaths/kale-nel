#!/usr/bin/env python3
"""Add fixed authenticated native H264 live playback to the LAN relay."""
import argparse, datetime, os, shutil
from pathlib import Path

MARKER = 'S9_SMOOTH_LIVE_RELAY_V1'
METHOD = ''' def smooth_live(self,head=False):
  # S9_SMOOTH_LIVE_RELAY_V1: authentication is checked by go() first.
  # Fixed loopback destination: no browser-controlled upstream URL or source.
  req=urllib.request.Request('http://127.0.0.1:1985/api/stream.mp4?src=s9',
    headers={'User-Agent':'C720P Chrome/154'},method='HEAD' if head else 'GET')
  try:r=urllib.request.urlopen(req,timeout=15)
  except Exception:return self.empty(503)
  self.send_response(r.status);self.cors()
  self.send_header('Content-Type',r.headers.get('Content-Type','video/mp4'))
  self.send_header('Cache-Control','private,no-store')
  self.send_header('X-Content-Type-Options','nosniff')
  self.send_header('Connection','close');self.end_headers()
  self.close_connection=True
  try:
   if not head:
    while True:
     chunk=r.read1(8192)
     if not chunk:break
     self.wfile.write(chunk);self.wfile.flush()
  except (BrokenPipeError,ConnectionResetError,TimeoutError):pass
  finally:r.close()
'''

def patch(source):
    if MARKER in source:
        if source.count(MARKER)!=1 or "if path=='/new/live.mp4'" not in source:
            raise ValueError('partial_smooth_live_patch')
        return source
    anchor=' def do_HEAD(self): self.go(True)'
    if source.count(anchor)!=1:raise ValueError('relay_method_anchor_changed')
    source=source.replace(anchor,METHOD+anchor)
    anchor="  if path=='/phone-batteries.json':"
    if source.count(anchor)!=1:raise ValueError('relay_route_anchor_changed')
    source=source.replace(anchor,"  if path=='/new/live.mp4':return self.smooth_live(head)\n"+anchor)
    anchor="  url=f'http://127.0.0.1:8795/{cam}{subpath}';req="
    if source.count(anchor)!=1:raise ValueError('relay_archive_anchor_changed')
    source=source.replace(anchor,"  q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)\n"
      "  playback=(q.get('playback') or [''])[0]\n"
      "  suffix=('?playback='+playback) if playback in ('prepare','hub') else ''\n"
      "  url=f'http://127.0.0.1:8795/{cam}{subpath}{suffix}';req=")
    compile(source,'patched-relay','exec')
    return source

def main():
    a=argparse.ArgumentParser();a.add_argument('--path',type=Path,
        default=Path('/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py'))
    a.add_argument('--dry-run',action='store_true');args=a.parse_args()
    before=args.path.read_text();after=patch(before)
    if args.dry_run:print('SMOOTH_RELAY_DRY_RUN',before!=after);return
    if before==after:print('SMOOTH_RELAY_ALREADY_ACTIVE');return
    backup=Path('/home/jespern/c720p-home-hub/backups')/('smooth-video-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(mode=0o700,parents=True,exist_ok=False)
    shutil.copy2(args.path,backup/args.path.name)
    stage=args.path.with_suffix('.smooth-stage');stage.write_text(after)
    os.chmod(stage,args.path.stat().st_mode & 0o777);os.replace(stage,args.path)
    print('SMOOTH_RELAY_INSTALLED',str(backup))

if __name__=='__main__':main()
