"""Observation constraints use detections, never interpolated track lifetimes."""
import math

def observed_times(track):
 points=track.get('trajectory')
 if isinstance(points,list) and points:
  values=[p[0] for p in points if isinstance(p,(list,tuple)) and len(p)==2]
 else:
  # These endpoints are genuine detections in the older extractor too.
  values=[track.get('first_s'),track.get('last_s')]
 return sorted({float(v) for v in values if type(v) in (int,float) and math.isfinite(v) and v>=0})

def simultaneous(a,b):
 if a['clip_key']!=b['clip_key'] or a['id']==b['id']:return False
 first,second=observed_times(a),observed_times(b)
 return any(abs(x-y)<=.02 for x in first for y in second)

def continuity(a,b):
 """A short spatially plausible track break; presence labels are not identities."""
 if a['clip_key']!=b['clip_key'] or simultaneous(a,b):return False
 if a['first_s']>b['first_s']:a,b=b,a
 gap=b['first_s']-a['last_s']
 if not 0<gap<=8 or a.get('frame_size')!=b.get('frame_size'):return False
 first,second=a.get('trajectory'),b.get('trajectory')
 if not first or not second:return False
 x=min(first,key=lambda p:abs(p[0]-a['last_s']))[1];y=min(second,key=lambda p:abs(p[0]-b['first_s']))[1]
 if len(x)!=4 or len(y)!=4:return False
 height=max(1,(x[3]-x[1]+y[3]-y[1])/2)
 distance=math.hypot((x[0]+x[2]-y[0]-y[2])/2,(x[1]+x[3]-y[1]-y[3])/2)/height
 return distance<=min(3,1.5*gap) and min(x[3]-x[1],y[3]-y[1])/height>=.55
