#!/usr/bin/env python3
"""Build, sign and audit an S3 headless-preview v8 APK without installing.

The installed v7 camera stays running. Only separate stage and rollback
directories are touched. Actual device test/install is a separate action.
"""
from pathlib import Path
import hashlib, re, shutil, subprocess, json

HOME=Path('/home/jespern/c720p-home-hub')
ORIG=HOME/'build/s3-onphone'
STAGE=HOME/'build/s3-screen-off-v8'
BACK=HOME/'backups/s3-screen-off-v8'
SERIAL='192.168.178.47:5555'
APP='nl.kalenel.s3motion'
JAVA='src/nl/kalenel/s3motion/MotionActivity.java'
def run(args,timeout=60):
 p=subprocess.run([str(x) for x in args],capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('command_failed:'+str(args[:3])+':'+p.stderr[-800:])
 return p.stdout
def one(s,a,b):
 if s.count(a)!=1:raise RuntimeError('unsupported_s3_v7_source_anchor:'+a[:65])
 return s.replace(a,b,1)
def patch(s):
 s=one(s,'import android.os.SystemClock;','import android.os.SystemClock;\nimport android.os.PowerManager;\nimport android.graphics.SurfaceTexture;')
 s=one(s,'    private Camera camera;','    private Camera camera;\n    private SurfaceTexture offscreenPreview;\n    private PowerManager.WakeLock cameraWakeLock;')
 s=one(s,'        super.onCreate(b);\n        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON\n                |WindowManager.LayoutParams.FLAG_FULLSCREEN);',
 '''        super.onCreate(b);
        // A partial CPU wake lock keeps the on-device detector processing
        // while the display sleeps. Screen brightness is NOT kept awake.
        PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);
        if(pm!=null){
            cameraWakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,
                "nl.kalenel.s3motion:rear_camera_motion");
            cameraWakeLock.setReferenceCounted(false);
            cameraWakeLock.acquire();
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);''')
 s=one(s,'version=7 rear_only=true','version=8 rear_only=true headless_camera=true')
 s=one(s,'    @Override public void surfaceDestroyed(SurfaceHolder h){holderReady=false;stopCamera();}',
 '''    @Override public void surfaceDestroyed(SurfaceHolder h){
        holderReady=false;
        // Display surface is disposable: preview uses its OWN SurfaceTexture.
        Log.i(TAG,"DISPLAY_SURFACE_GONE headless_camera="+(camera!=null));
    }''')
 s=one(s,'        if(holderReady && camera==null)startCamera(surface.getHolder());','        if(camera==null)startCamera(surface.getHolder());')
 s=one(s,'''    @Override public void onPause(){
        if(lightManager!=null)lightManager.unregisterListener(this);
        stopCamera();
        super.onPause();
    }''',
 '''    @Override public void onPause(){
        // Power button must not stop camera, luminance sensing or motion.
        super.onPause();
        Log.i(TAG,"DISPLAY_PAUSED_KEEP_MOTION camera="+(camera!=null));
    }''')
 s=one(s,'    @Override public void onDestroy(){stopCamera();super.onDestroy();}',
 '''    @Override public void onDestroy(){
        if(lightManager!=null)lightManager.unregisterListener(this);
        stopCamera();
        if(cameraWakeLock!=null&&cameraWakeLock.isHeld())cameraWakeLock.release();
        super.onDestroy();
    }''')
 s=one(s,'            camera.setPreviewDisplay(holder);',
 '''            // Independent of the Activity SurfaceView: still produces NV21
            // camera preview callbacks while screen is genuinely off.
            if(offscreenPreview!=null){offscreenPreview.release();offscreenPreview=null;}
            offscreenPreview=new SurfaceTexture(11);
            offscreenPreview.setDefaultBufferSize(cameraWidth,cameraHeight);
            camera.setPreviewTexture(offscreenPreview);''')
 s=one(s,'''            try{c.release();}catch(Exception ignored){}
        }
    }
    @Override public void onPreviewFrame''','''            try{c.release();}catch(Exception ignored){}
        }
        if(offscreenPreview!=null){
            try{offscreenPreview.release();}catch(Exception ignored){}
            offscreenPreview=null;
        }
    }
    @Override public void onPreviewFrame''')
 s=one(s,'                    if(holderReady)startCamera(surface.getHolder());','                    startCamera(surface.getHolder());')
 return s
def main():
 assert (ORIG/JAVA).is_file()
 original=(ORIG/JAVA).read_text()
 if 'version=7 rear_only=true' not in original:raise RuntimeError('expected_v7_baseline')
 for p in (STAGE/'src',STAGE/'classes',STAGE/'dex',BACK):p.mkdir(parents=True,exist_ok=True)
 shutil.copytree(ORIG/'src',STAGE/'src',dirs_exist_ok=True)
 (STAGE/JAVA).write_text(patch(original))
 manifest=(ORIG/'AndroidManifest.xml').read_text()
 manifest=one(manifest,'android:versionCode="7" android:versionName="7.0"',
                      'android:versionCode="8" android:versionName="8.0"')
 (STAGE/'AndroidManifest.xml').write_text(manifest)
 patched=(STAGE/JAVA).read_text()
 for a in ('new SurfaceTexture(11)','camera.setPreviewTexture(offscreenPreview)',
           'DISPLAY_PAUSED_KEEP_MOTION','PowerManager.PARTIAL_WAKE_LOCK',
           'offscreenPreview.release()'):
  if a not in patched:raise RuntimeError('contract_missing:'+a)
 if 'FLAG_KEEP_SCREEN_ON' in patched or 'camera.setPreviewDisplay(holder)' in patched:
  raise RuntimeError('still_depends_on_display')
 jars=sorted(Path('/usr/lib/android-sdk/platforms').glob('*/android.jar'))
 if not jars:raise RuntimeError('Android SDK missing')
 androidjar=jars[-1]
 classes=STAGE/'classes'
 for f in classes.rglob('*.class'):f.unlink()
 java=list((STAGE/'src/nl/kalenel/s3motion').glob('*.java'))
 run(['javac','-source','8','-target','8','-cp',androidjar,'-d',classes]+java)
 dex=STAGE/'dex'
 for f in dex.glob('classes*.dex'):f.unlink()
 run(['d8','--min-api','19','--lib',androidjar,'--output',dex]+list(classes.rglob('*.class')))
 unsigned=STAGE/'s3-motion-v8-unsigned.apk'
 if unsigned.exists():unsigned.unlink()
 run(['aapt','package','-f','-M',STAGE/'AndroidManifest.xml','-I',androidjar,'-F',unsigned])
 run(['aapt','add',unsigned,'classes.dex'],timeout=25) if False else None
 # aapt add expects a relative classes.dex file and a working directory.
 p=subprocess.run(['aapt','add',str(unsigned),'classes.dex'],cwd=str(dex),
                  capture_output=True,text=True,timeout=30)
 if p.returncode:raise RuntimeError('aapt_add_failed:'+p.stderr[-400:])
 path=run(['adb','-s',SERIAL,'shell','pm','path',APP]).strip()
 installed=path.partition('package:')[2].strip()
 if not installed.startswith('/data/app/') or not installed.endswith('.apk'):
  raise RuntimeError('unexpected_original_installed_apk_path')
 backup=BACK/'s3-motion-v7-installed-20261011.apk'
 if not backup.is_file():run(['adb','-s',SERIAL,'pull',installed,backup],timeout=65)
 if backup.stat().st_size<10000:raise RuntimeError('original_apk_backup_missing')
 key=HOME/'state/s3-motion-signing.keystore'
 password=HOME/'state/s3-motion-signing-password'
 if not key.is_file() or not password.is_file():raise RuntimeError('previous_signer_unavailable')
 output=run(['keytool','-list','-v','-keystore',key,'-storepass',password.read_text().strip()],timeout=30)
 match=re.search(r'(?im)^Alias name:\s*([^\s]+)',output)
 if not match:raise RuntimeError('key_alias_unavailable')
 apk=STAGE/'s3-motion-v8-signed.apk'
 run(['apksigner','sign','--ks',key,'--ks-key-alias',match.group(1),
      '--ks-pass','file:'+str(password),'--out',apk,unsigned],timeout=50)
 def cert(path):
  txt=run(['apksigner','verify','--print-certs',path],timeout=30)
  m=re.search('Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})',txt)
  if not m:raise RuntimeError('apk_certificate_unavailable')
  return m.group(1)
 if cert(apk)!=cert(backup):raise RuntimeError('new_APK_signer_differs_from_installed')
 print('S3_V8_HEADLESS_SIGNED_DRYRUN_OK',json.dumps({
  'original_apk_rollback':str(backup),'stage_apk':str(apk),
  'signed_bytes':apk.stat().st_size,'signer_matches_installed':True,
  'source_hash':hashlib.sha256((STAGE/JAVA).read_bytes()).hexdigest()[:16],
  'on_phone_installed':False,'screen_off_enabled':False}))
if __name__=='__main__':main()
