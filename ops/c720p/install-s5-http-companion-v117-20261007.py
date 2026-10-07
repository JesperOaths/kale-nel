#!/usr/bin/env python3
from pathlib import Path
import datetime, os, shutil, subprocess, textwrap, json, re, time

HOME = Path("/home/jespern")
BASE = HOME / "c720p-home-hub"
APP = BASE / "s5-http-companion"
SRC = APP / "src/com/bruis/s5httpbridge"
BUILD = APP / "build"
BIN = BASE / "bin"
UNITS = HOME / ".config/systemd/user"
STATE = BASE / "state/s5-http-companion.json"
BACK = HOME / "c720p-backups" / ("s5-http-companion-v117-" + datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))
BACK.mkdir(parents=True, exist_ok=True)

for p in [APP, BIN/"c720p-s5-http-companion-recover.py",
          UNITS/"c720p-s5-http-companion-recover.service",
          UNITS/"c720p-s5-http-companion-recover.timer"]:
    if p.exists():
        dst = BACK / (p.name + ".before")
        if p.is_dir():
            shutil.copytree(p, dst)
        else:
            shutil.copy2(p, dst)

SRC.mkdir(parents=True, exist_ok=True)
BUILD.mkdir(parents=True, exist_ok=True)
(APP/"res/values").mkdir(parents=True, exist_ok=True)

manifest = r'''<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.bruis.s5httpbridge">
    <uses-sdk android:minSdkVersion="19" android:targetSdkVersion="28" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <application
        android:label="S5 IR HTTP Companion"
        android:allowBackup="false"
        android:usesCleartextTraffic="true">
        <service android:name=".BridgeService" android:exported="true" />
        <receiver android:name=".BootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.LOCKED_BOOT_COMPLETED" />
                <action android:name="android.net.conn.CONNECTIVITY_CHANGE" />
            </intent-filter>
        </receiver>
    </application>
</manifest>
'''
(APP/"AndroidManifest.xml").write_text(manifest, encoding="utf-8")
(APP/"res/values/strings.xml").write_text(
    '<resources><string name="app_name">S5 IR HTTP Companion</string></resources>\n',
    encoding="utf-8",
)

bridge = r'''package com.bruis.s5httpbridge;

import android.app.*;
import android.content.*;
import android.os.*;
import android.util.Log;
import java.io.*;
import java.net.*;
import java.util.*;

public class BridgeService extends Service {
    private static final String TAG="S5HttpCompanion";
    private static final int PORT=8765;
    private volatile boolean running=false;
    private ServerSocket server;

    @Override public void onCreate() {
        super.onCreate();
        ensureForeground();
        startServer();
    }

    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        ensureForeground();
        startServer();
        return START_STICKY;
    }

    private void ensureForeground() {
        if (Build.VERSION.SDK_INT >= 26) {
            String id="s5_ir_http";
            NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(new NotificationChannel(id,"S5 IR bridge",NotificationManager.IMPORTANCE_MIN));
            Notification n=new Notification.Builder(this,id)
                .setContentTitle("S5 IR bridge")
                .setContentText("LAN bridge ready on port 8765")
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .build();
            startForeground(PORT,n);
        }
    }

    private synchronized void startServer() {
        if (running) return;
        running=true;
        new Thread(new Runnable(){ public void run(){ serve(); } },"S5HttpCompanion8765").start();
    }

    private void serve() {
        try {
            server=new ServerSocket();
            server.setReuseAddress(true);
            server.bind(new InetSocketAddress(PORT));
            Log.i(TAG,"listening on "+PORT);
            while(running) {
                Socket s=server.accept();
                final Socket c=s;
                new Thread(new Runnable(){ public void run(){ handle(c); } },"S5HttpRequest").start();
            }
        } catch(Exception e) {
            if(running) Log.e(TAG,"server stopped",e);
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(5000);
            InetAddress peer=socket.getInetAddress();
            if(peer==null || !(peer.isSiteLocalAddress() || peer.isLoopbackAddress())) {
                respond(socket,403,false,"non_local_client");
                return;
            }
            BufferedReader r=new BufferedReader(new InputStreamReader(socket.getInputStream(),"UTF-8"));
            String first=r.readLine();
            if(first==null){ respond(socket,400,false,"empty_request"); return; }
            String[] bits=first.split(" ");
            if(bits.length<2){ respond(socket,400,false,"bad_request"); return; }
            String path=bits[1];
            int q=path.indexOf('?');
            if(q>=0) path=path.substring(0,q);
            if("/health".equals(path)) {
                boolean receiverInstalled;
                try {
                    getPackageManager().getPackageInfo("com.bruis.s5irbridge",0);
                    receiverInstalled=true;
                } catch(Exception e) { receiverInstalled=false; }
                respond(socket,receiverInstalled?200:503,receiverInstalled,
                    receiverInstalled?"receiver_ready":"receiver_missing");
                return;
            }
            String[] seg=path.split("/");
            if(seg.length==4 && "ir".equals(seg[1])) {
                String device=URLDecoder.decode(seg[2],"UTF-8");
                String command=URLDecoder.decode(seg[3],"UTF-8");
                if("ht-e6500".equals(device)) device="ht_e6500";
                if("grundig-tv".equals(device)) device="grundig_tv";
                if(!safe(device) || !safe(command)) {
                    respond(socket,400,false,"invalid_command");
                    return;
                }
                Intent i=new Intent("com.bruis.s5irbridge.SEND");
                i.setComponent(new ComponentName("com.bruis.s5irbridge","com.bruis.s5irbridge.IrReceiver"));
                i.putExtra("device",device);
                i.putExtra("command",command);
                sendBroadcast(i);
                Log.i(TAG,"forwarded device="+device+" command="+command);
                respond(socket,200,true,"forwarded");
                return;
            }
            respond(socket,404,false,"not_found");
        } catch(Exception e) {
            Log.e(TAG,"request failed",e);
            try { respond(socket,500,false,"request_failed"); } catch(Exception ignored) {}
        } finally {
            try { socket.close(); } catch(Exception ignored) {}
        }
    }

    private boolean safe(String s) {
        return s != null && s.matches("[A-Za-z0-9_.-]{1,64}");
    }

    private void respond(Socket socket,int code,boolean ok,String state) throws Exception {
        String reason=code==200?"OK":code==400?"Bad Request":code==403?"Forbidden":code==404?"Not Found":"Service Unavailable";
        String body="{\"ok\":"+ok+",\"state\":\""+state+"\",\"bridge\":\"s5-http-companion-v117\"}\n";
        byte[] bytes=body.getBytes("UTF-8");
        OutputStream o=socket.getOutputStream();
        String h="HTTP/1.1 "+code+" "+reason+"\r\nContent-Type: application/json\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n";
        o.write(h.getBytes("UTF-8")); o.write(bytes); o.flush();
    }

    @Override public void onDestroy() {
        running=false;
        try { if(server!=null) server.close(); } catch(Exception ignored) {}
        super.onDestroy();
    }

    @Override public android.os.IBinder onBind(Intent intent) { return null; }
}
'''
(SRC/"BridgeService.java").write_text(bridge, encoding="utf-8")

boot = r'''package com.bruis.s5httpbridge;
import android.content.*;
import android.os.*;
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        Intent s=new Intent(context,BridgeService.class);
        try {
            if(Build.VERSION.SDK_INT>=26) context.startForegroundService(s);
            else context.startService(s);
        } catch(Exception ignored) {}
    }
}
'''
(SRC/"BootReceiver.java").write_text(boot, encoding="utf-8")

def which_any(names):
    for n in names:
        p=shutil.which(n)
        if p:return Path(p)
    return None

def find_tool(name):
    p=which_any([name])
    if p:return p
    roots=[HOME/"Android/Sdk/build-tools", Path("/opt/android-sdk/build-tools"), Path("/usr/lib/android-sdk/build-tools")]
    hits=[]
    for root in roots:
        if root.exists():
            hits += list(root.glob("*/"+name))
    return sorted(hits)[-1] if hits else None

def find_android_jar():
    roots=[HOME/"Android/Sdk/platforms", Path("/opt/android-sdk/platforms"), Path("/usr/lib/android-sdk/platforms")]
    hits=[]
    for root in roots:
        if root.exists(): hits += list(root.glob("*/android.jar"))
    if not hits: raise SystemExit("android.jar not found")
    return sorted(hits)[-1]

AAPT=find_tool("aapt")
D8=find_tool("d8")
DX=find_tool("dx")
ZIPALIGN=find_tool("zipalign")
APKSIGNER=find_tool("apksigner")
JAVAC=which_any(["javac"])
KEYTOOL=which_any(["keytool"])
for name,val in [("aapt",AAPT),("javac",JAVAC),("zipalign",ZIPALIGN),("apksigner",APKSIGNER)]:
    if not val: raise SystemExit(name+" not found")
if not D8 and not DX: raise SystemExit("neither d8 nor dx found")
ANDROID_JAR=find_android_jar()

classes=BUILD/"classes"
dexout=BUILD/"dex"
shutil.rmtree(classes,ignore_errors=True);shutil.rmtree(dexout,ignore_errors=True)
classes.mkdir(parents=True);dexout.mkdir(parents=True)
for f in ["unsigned.apk","aligned.apk","s5-http-companion.apk","classes.dex"]:
    try:(BUILD/f).unlink()
    except FileNotFoundError:pass

subprocess.run([str(AAPT),"package","-f","-M",str(APP/"AndroidManifest.xml"),
                "-S",str(APP/"res"),"-I",str(ANDROID_JAR),"-F",str(BUILD/"unsigned.apk")],
               check=True,timeout=60)
subprocess.run([str(JAVAC),"-source","1.7","-target","1.7","-bootclasspath",str(ANDROID_JAR),
                "-d",str(classes),str(SRC/"BridgeService.java"),str(SRC/"BootReceiver.java")],
               check=True,timeout=60)

class_files=[str(p) for p in classes.rglob("*.class")]
if D8:
    subprocess.run([str(D8),"--lib",str(ANDROID_JAR),"--min-api","19","--output",str(dexout)]+class_files,
                   check=True,timeout=60)
    dex=dexout/"classes.dex"
else:
    dex=BUILD/"classes.dex"
    subprocess.run([str(DX),"--dex","--output="+str(dex)]+class_files,check=True,timeout=60)

subprocess.run([str(AAPT),"add",str(BUILD/"unsigned.apk"),str(dex)],check=True,timeout=30,
               cwd=str(BUILD))
# aapt stores the path passed; normalize if needed by rebuilding with zip.
import zipfile
u=BUILD/"unsigned.apk"
with zipfile.ZipFile(u,"r") as z:
    names=z.namelist()
if "classes.dex" not in names:
    tmp=BUILD/"unsigned-fixed.apk"
    with zipfile.ZipFile(u,"r") as zin, zipfile.ZipFile(tmp,"w",zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename.endswith("/classes.dex"): continue
            zout.writestr(item,zin.read(item.filename))
        zout.write(dex,"classes.dex")
    os.replace(tmp,u)

subprocess.run([str(ZIPALIGN),"-f","4",str(u),str(BUILD/"aligned.apk")],check=True,timeout=30)

keystore=HOME/".android/debug.keystore"
keystore.parent.mkdir(parents=True,exist_ok=True)
if not keystore.exists():
    if not KEYTOOL: raise SystemExit("keytool not found for debug keystore")
    subprocess.run([str(KEYTOOL),"-genkeypair","-keystore",str(keystore),"-storepass","android",
                    "-alias","androiddebugkey","-keypass","android","-dname","CN=Android Debug,O=Android,C=US",
                    "-keyalg","RSA","-keysize","2048","-validity","10000"],check=True,timeout=60)

apk=BUILD/"s5-http-companion.apk"
subprocess.run([str(APKSIGNER),"sign","--ks",str(keystore),"--ks-key-alias","androiddebugkey",
                "--ks-pass","pass:android","--key-pass","pass:android","--out",str(apk),str(BUILD/"aligned.apk")],
               check=True,timeout=60)
subprocess.run([str(APKSIGNER),"verify","--verbose",str(apk)],check=True,timeout=30)

recover = r'''#!/usr/bin/env python3
import json, pathlib, subprocess, time, urllib.request
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
APK=BASE/"s5-http-companion/build/s5-http-companion.apk"
STATE=BASE/"state/s5-http-companion.json"
EXPECTED_MODEL="SM-G900F"; EXPECTED_SERIAL="993e96d0"; PKG="com.bruis.s5httpbridge"

def run(a,t=10):
    try:return subprocess.run(a,text=True,capture_output=True,timeout=t)
    except Exception:return None

def http_ok():
    try:
        with urllib.request.urlopen("http://192.168.178.16:8765/health",timeout=2.5) as r:
            d=json.loads(r.read().decode())
            return bool(d.get("ok")),d
    except Exception as e:return False,{"error":type(e).__name__+":"+str(e)[:160]}

def verify(t):
    st=run(["adb","-s",t,"get-state"],4)
    if not st or st.stdout.strip()!="device":return False
    m=run(["adb","-s",t,"shell","getprop","ro.product.model"],4)
    s=run(["adb","-s",t,"shell","getprop","ro.serialno"],4)
    return bool(m and s and m.stdout.strip()==EXPECTED_MODEL and s.stdout.strip()==EXPECTED_SERIAL)

ok,detail=http_ok()
if ok:
    STATE.parent.mkdir(parents=True,exist_ok=True)
    STATE.write_text(json.dumps({"ok":True,"state":"http_ready","detail":detail,"at":time.time()},indent=2)+"\n")
    raise SystemExit(0)

run(["adb","start-server"],5)
targets=[]
for t in ["192.168.178.16:5555",EXPECTED_SERIAL]:
    if ":" in t: run(["adb","connect",t],6)
    if verify(t):targets.append(t)
if not targets:
    STATE.parent.mkdir(parents=True,exist_ok=True)
    STATE.write_text(json.dumps({"ok":False,"state":"waiting_for_s5_adb","at":time.time()},indent=2)+"\n")
    raise SystemExit(0)

t=targets[0]
if not APK.exists(): raise SystemExit("companion APK missing")
ins=run(["adb","-s",t,"install","-r",str(APK)],90)
if not ins or ins.returncode!=0:
    STATE.write_text(json.dumps({"ok":False,"state":"install_failed","stdout":"" if not ins else ins.stdout[-1200:],"stderr":"" if not ins else ins.stderr[-1200:],"at":time.time()},indent=2)+"\n")
    raise SystemExit(1)
run(["adb","-s",t,"shell","am","startservice","-n",PKG+"/.BridgeService"],12)
time.sleep(1.5)
ok,detail=http_ok()
STATE.write_text(json.dumps({"ok":ok,"state":"http_ready" if ok else "installed_but_http_not_ready","target":t,"detail":detail,"at":time.time()},indent=2)+"\n")
raise SystemExit(0 if ok else 2)
'''
rec=BIN/"c720p-s5-http-companion-recover.py"
rec.write_text(recover,encoding="utf-8");rec.chmod(0o755)

svc=UNITS/"c720p-s5-http-companion-recover.service"
svc.write_text("""[Unit]
Description=Recover S5 HTTP IR companion when ADB becomes available
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/c720p-s5-http-companion-recover.py
""",encoding="utf-8")

timer=UNITS/"c720p-s5-http-companion-recover.timer"
timer.write_text("""[Unit]
Description=Retry S5 HTTP IR companion recovery

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=5s
Persistent=true
Unit=c720p-s5-http-companion-recover.service

[Install]
WantedBy=timers.target
""",encoding="utf-8")

subprocess.run(["python3","-m","py_compile",str(rec)],check=True)
subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","enable","--now","c720p-s5-http-companion-recover.timer"],check=True)
subprocess.run(["systemctl","--user","start","c720p-s5-http-companion-recover.service"],check=False)

print(json.dumps({
    "ok":True,
    "version":"v117-http-companion",
    "apk":str(apk),
    "apk_size":apk.stat().st_size,
    "android_jar":str(ANDROID_JAR),
    "aapt":str(AAPT),
    "dexer":str(D8 or DX),
    "apksigner":str(APKSIGNER),
    "backup":str(BACK),
    "timer_active":subprocess.run(["systemctl","--user","is-active","c720p-s5-http-companion-recover.timer"],capture_output=True,text=True).stdout.strip(),
    "state":json.loads(STATE.read_text()) if STATE.exists() else None,
},indent=2))
