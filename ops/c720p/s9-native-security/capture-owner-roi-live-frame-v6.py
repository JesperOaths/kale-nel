#!/usr/bin/env python3
"""Read native S9+ live JPEG and annotate exactly the active MotionGrid 24x14 cells.
No file is published on the web. Final image is returned as base64 via the private
C720P command agent for this one request. Does not change the camera config.
"""
import base64
import json
import math
import struct
import subprocess
import tempfile
import urllib.request
import zlib
from pathlib import Path

ROOT = "http://127.0.0.1:18808"
WIDTH, HEIGHT = 640, 480
GRID_X, GRID_Y = 24, 14
MARKED_X = (0., .17, .36, .52, .67, 1.)
MARKED_Y = (.519, .519, .497, .484, .441, .433)

def top_at(x):
    for i in range(1, len(MARKED_X)):
        if x <= MARKED_X[i]:
            t=(x-MARKED_X[i-1])/(MARKED_X[i]-MARKED_X[i-1])
            return MARKED_Y[i-1]+t*(MARKED_Y[i]-MARKED_Y[i-1])
    return MARKED_Y[-1]

def fetch(endpoint, cap):
    with urllib.request.urlopen(ROOT+endpoint, timeout=12) as response:
        if response.status != 200:
            raise RuntimeError("http_status")
        b=response.read(cap+1)
        if len(b)>cap:raise RuntimeError("oversized_camera_data")
        return b

def chunk(tag, contents):
    return struct.pack(">I",len(contents))+tag+contents+struct.pack(">I",zlib.crc32(tag+contents)&0xffffffff)

def png_rgba(w,h,rgba_bytes):
    raw=b"".join(b"\x00"+rgba_bytes[y*w*4:(y+1)*w*4] for y in range(h))
    header=struct.pack(">IIBBBBB",w,h,8,6,0,0,0)
    return b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",header)+chunk(b"IDAT",zlib.compress(raw,7))+chunk(b"IEND",b"")

def run():
    s=json.loads(fetch("/status",100000))
    if not (s.get("ok") and s.get("snapshot_ready")):raise RuntimeError("camera_not_healthy")
    if s.get("garden_zone")!="near":raise RuntimeError("garden_preset_changed")
    if s.get("garden_roi_mask_version")!="owner_drawn_sloped_garden_v6":raise RuntimeError("v6_mask_not_active")
    if s.get("garden_roi_gates_person_inference") is not True:raise RuntimeError("person_mask_not_live")
    for key,expected in (("garden_roi_top_left_fraction",.519),("garden_roi_top_right_fraction",.433)):
        if abs(float(s.get(key,9))-expected)>.005:raise RuntimeError("unexpected_roi_from_phone")
    jpg=fetch("/shot.jpg",1_000_000)
    if jpg[:3]!=b"\xff\xd8\xff":raise RuntimeError("not_real_camera_jpeg")
    active=[]
    for gy in range(GRID_Y):
        for gx in range(GRID_X):
            x=(gx+.5)/GRID_X;y=(gy+.5)/GRID_Y
            active.append(y>=top_at(x))
    # The green pixels are the *actual sampled cells*; excluded grid cells dark.
    mask=bytearray(WIDTH*HEIGHT*4)
    for y in range(HEIGHT):
        gy=min(GRID_Y-1,int(y*GRID_Y/HEIGHT))
        for x in range(WIDTH):
            gx=min(GRID_X-1,int(x*GRID_X/WIDTH))
            here=active[gy*GRID_X+gx]
            above=gy>0 and active[(gy-1)*GRID_X+gx]
            left=gx>0 and active[gy*GRID_X+gx-1]
            right=gx<GRID_X-1 and active[gy*GRID_X+gx+1]
            border=(here and (not above) and (y==math.ceil(gy*HEIGHT/GRID_Y) or y==math.ceil(gy*HEIGHT/GRID_Y)+1 or y==math.ceil(gy*HEIGHT/GRID_Y)+2))
            # True stair-step mask boundary where accepted cell meets excluded cell.
            if here and not above and (y<math.ceil(gy*HEIGHT/GRID_Y)+4):
                color=(46,255,97,255)
            elif here and not left and x<math.ceil(gx*WIDTH/GRID_X)+3:
                color=(46,255,97,220)
            elif here and not right and x>math.ceil((gx+1)*WIDTH/GRID_X)-4:
                color=(46,255,97,220)
            elif here and (x%max(1,round(WIDTH/GRID_X))==0 or y%max(1,round(HEIGHT/GRID_Y))==0):
                color=(26,250,95,75)
            elif here:
                color=(26,230,85,57)
            else:
                color=(0,0,0,118)
            off=4*(y*WIDTH+x); mask[off:off+4]=bytes(color)
    with tempfile.TemporaryDirectory(prefix="s9-owner-mask-live-") as temp:
        src=Path(temp)/"real-camera.jpg"; layer=Path(temp)/"exact-grid.png"; dest=Path(temp)/"live-roi.webp"
        src.write_bytes(jpg);layer.write_bytes(png_rgba(WIDTH,HEIGHT,mask))
        filters=("scale=640:480,format=rgba[cam];[cam][1:v]overlay=0:0,"
          "drawtext=text='S9+ LIVE  |  MONITORED CELLS IN GREEN':fontcolor=white:fontsize=17:box=1:boxcolor=black@0.74:boxborderw=7:x=14:y=12,"
          "drawtext=text='DARK = NOT MONITORED':fontcolor=white:fontsize=16:box=1:boxcolor=black@0.74:boxborderw=7:x=14:y=48,"
          "drawtext=text='24 x 14 detection grid / V6 marked mask':fontcolor=white:fontsize=13:box=1:boxcolor=black@0.7:boxborderw=5:x=14:y=h-29")
        cp=subprocess.run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y","-i",str(src),"-i",str(layer),
          "-filter_complex",filters,"-frames:v","1","-c:v","libwebp","-quality","56","-compression_level","5",str(dest)],
          capture_output=True,text=True,timeout=35)
        if cp.returncode:raise RuntimeError("ffmpeg_failed "+cp.stderr[-450:])
        picture=dest.read_bytes()
    if len(picture)<4000 or picture[:4]!=b"RIFF":raise RuntimeError("bad_annotated_frame")
    info={"zone":s["garden_zone"],"mask":s["garden_roi_mask_version"],
      "camera":s.get("mode"),"snapshot_age_ms":s.get("snapshot_age_ms"),
      "timestamp_utc":__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
      "active_cells":sum(active),"total_cells":len(active),"width":WIDTH,"height":HEIGHT,
      "captured_jpeg_bytes":len(jpg),"image_bytes":len(picture),
      "left_top":s["garden_roi_top_left_fraction"],"middle_top":s.get("garden_roi_top_middle_fraction"),
      "right_top":s["garden_roi_top_right_fraction"]}
    print("S9_CAMERA_ROI_METADATA="+json.dumps(info,separators=(",",":")),flush=True)
    print("S9_CAMERA_ROI_IMAGE="+base64.b64encode(picture).decode("ascii"),flush=True)

if __name__=="__main__":run()
