#!/usr/bin/python3
import ctypes,ctypes.util,json,math,os,signal,time
from pathlib import Path
P=Path('/sys/class/backlight/intel_backlight/brightness')
M=Path('/home/jespern/c720p-home-hub/state/frontcam-motion-living-lamp.json')
S=Path('/home/jespern/c720p-home-hub/state/screen-smart-brightness.json')
# These detector releases retain the same confirmed-motion state contract.
# V17 retained the V16 status identifier; later releases publish V18/V19.
MOTION_VERSIONS=frozenset({'frontcam-motion-v16','frontcam-motion-v18','frontcam-motion-v19'})

def motion_sample(record,now):
 if not isinstance(record,dict) or record.get('ok') is not True:
  return False,0.
 version=record.get('version')
 if not isinstance(version,str) or version not in MOTION_VERSIONS:
  return False,0.
 try:
  updated=float(record.get('updated_at',0))
  if not math.isfinite(updated) or abs(now-updated)>7:return False,0.
  triggered=float(record.get('last_trigger_at') or 0)
  if not math.isfinite(triggered):triggered=0.
  if record.get('confirmed_motion') is True:triggered=max(triggered,updated)
  return True,triggered if 0<triggered<=now+1 else 0.
 except (ValueError,TypeError,OverflowError):return False,0.

class Info(ctypes.Structure):
 _fields_=[('window',ctypes.c_ulong),('state',ctypes.c_int),('kind',ctypes.c_int),('since',ctypes.c_ulong),('idle',ctypes.c_ulong),('event_mask',ctypes.c_ulong)]
def run():
 xlib=ctypes.CDLL(ctypes.util.find_library('X11'))
 xss=ctypes.CDLL(ctypes.util.find_library('Xss'))
 xlib.XOpenDisplay.restype=ctypes.c_void_p
 xlib.XOpenDisplay.argtypes=[ctypes.c_char_p]
 xlib.XDefaultRootWindow.restype=ctypes.c_ulong
 xlib.XDefaultRootWindow.argtypes=[ctypes.c_void_p]
 xss.XScreenSaverQueryInfo.restype=ctypes.c_int
 xss.XScreenSaverQueryInfo.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.POINTER(Info)]
 xlib.XCloseDisplay.argtypes=[ctypes.c_void_p]
 d=xlib.XOpenDisplay(b':0')
 if not d:raise RuntimeError('X11 unavailable: refuse to dim')
 root=xlib.XDefaultRootWindow(d)
 maximum=int(Path('/sys/class/backlight/intel_backlight/max_brightness').read_text())
 full=int(P.read_text())
 if not 100<=full<=maximum:raise RuntimeError('invalid backlight range')
 dim=max(40,round(full*.30))
 running=[True]
 def stop(*_):running[0]=False
 signal.signal(signal.SIGTERM,stop)
 signal.signal(signal.SIGINT,stop)
 started=time.monotonic();last_seen=0.;motion_awake=-999999.;mode=None;last_state=0.
 print('START full',full,'idle',dim,'delay',150,flush=True)
 try:
  while running[0]:
   now=time.time();mono=time.monotonic()
   info=Info()
   xgood=bool(xss.XScreenSaverQueryInfo(d,root,ctypes.byref(info)))
   xidle=info.idle/1000. if xgood else 0.
   fresh=False
   try:
    m=json.loads(M.read_text())
    fresh,t=motion_sample(m,now)
    if 0<t<=now+1 and t>last_seen:
     last_seen=t
     if now-t<150:motion_awake=mono-(now-t)
   except (OSError,ValueError,TypeError):pass
   active=(not xgood or xidle<150 or mono-motion_awake<150 or mono-started<5)
   target=full if active else dim
   desired='bright' if active else 'dim'
   if desired!=mode:
    P.write_text(str(target))
    if abs(int(P.read_text())-target)>2:raise RuntimeError('backlight readback failed')
    mode=desired
    print('TRANSITION',mode,'backlight',target,'xidle',round(xidle,1),'camera_fresh',fresh,flush=True)
   if desired!=mode or mono-last_state>=20 or last_state==0:
    record={'ok':True,'mode':mode,'brightness':int(P.read_text()),'full':full,
      'dim':dim,'idle_seconds':round(xidle,1),'camera_fresh':fresh,
      'last_camera_motion_at':last_seen or None,'idle_delay_seconds':150,
      'updated_at':now}
    temp=S.with_suffix('.tmp');temp.write_text(json.dumps(record)+'\n');temp.replace(S);last_state=mono
   time.sleep(.8)
 finally:
  try:
   P.write_text(str(full))
   print('RESTORED',P.read_text().strip(),flush=True)
  except Exception as e:print('RESTORE_FAILED',str(e),flush=True)
  xlib.XCloseDisplay(d)
if __name__=='__main__':run()
