#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, subprocess, re, os

HOME=Path("/home/jespern")
APP=HOME/"s5-ir-bridge-manual"
SRC=APP/"src/com/bruis/s5irbridge"
MAN=APP/"AndroidManifest.xml"
MAIN=SRC/"MainActivity.java"
BUILD_SCRIPT=HOME/"build_install_s5_ir_bridge.sh"
OLD=HOME/"c720p-backups/s5-ir-http-20260926-060944"
REDISCOVER=HOME/"c720p-home-hub/bin/c720p-s5-rediscover.py"
ART=HOME/"c720p-home-hub/artifacts/s5-ir-bridge-http-persistent-v115.apk"
BACK=HOME/"c720p-backups"/("s5-http-persistent-v115-"+datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))
BACK.mkdir(parents=True,exist_ok=False)

for p in (MAN,MAIN,BUILD_SCRIPT,REDISCOVER):
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))
for name in ("BootReceiver.java","IrHttpService.java"):
    p=SRC/name
    if p.exists(): shutil.copy2(p,BACK/(name+".before"))

boot=(OLD/"src/com/bruis/s5irbridge/BootReceiver.java").read_text()
http=(OLD/"src/com/bruis/s5irbridge/IrHttpService.java").read_text()
(SRC/"BootReceiver.java").write_text(boot)
(SRC/"IrHttpService.java").write_text(http)

m=MAN.read_text()
if "android.permission.INTERNET" not in m:
    m=m.replace('<uses-permission android:name="android.permission.TRANSMIT_IR" />',
                '<uses-permission android:name="android.permission.TRANSMIT_IR" />\n'
                '    <uses-permission android:name="android.permission.INTERNET" />\n'
                '    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />',1)
if 'android:name=".IrHttpService"' not in m:
    block='''        <service android:name=".IrHttpService" android:exported="false" />
        <receiver android:name=".BootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
            </intent-filter>
        </receiver>
'''
    m=m.replace("    </application>",block+"    </application>",1)
MAN.write_text(m)

s=MAIN.read_text()
if "import android.os.Build;" not in s:
    s=s.replace("import android.os.Bundle;","import android.os.Bundle;\nimport android.os.Build;",1)
marker="C720P_HTTP_BOOT_PERSISTENCE_V115"
if marker not in s:
    anchor="        super.onCreate(state);\n"
    insert=anchor+f'''        // {marker}
        Intent httpService = new Intent(this, IrHttpService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(httpService);
        else startService(httpService);
'''
    if anchor not in s: raise SystemExit("MainActivity onCreate anchor missing")
    s=s.replace(anchor,insert,1)
MAIN.write_text(s)

# Make future generated builds retain the HTTP/boot layer too.
bs=BUILD_SCRIPT.read_text()
if "android.permission.INTERNET" not in bs:
    bs=bs.replace('    <uses-permission android:name="android.permission.TRANSMIT_IR" />',
                  '    <uses-permission android:name="android.permission.TRANSMIT_IR" />\n'
                  '    <uses-permission android:name="android.permission.INTERNET" />\n'
                  '    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />',1)
if 'android:name=".IrHttpService"' not in bs:
    block='''        <service android:name=".IrHttpService" android:exported="false" />
        <receiver android:name=".BootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
            </intent-filter>
        </receiver>
'''
    bs=bs.replace("    </application>\n</manifest>",block+"    </application>\n</manifest>",1)
if "import android.os.Build;" not in bs:
    bs=bs.replace("import android.os.Bundle;","import android.os.Bundle;\nimport android.os.Build;",1)
if marker not in bs:
    anchor="        super.onCreate(state);\n"
    insert=anchor+f'''        // {marker}
        Intent httpService = new Intent(this, IrHttpService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(httpService);
        else startService(httpService);
'''
    if anchor not in bs: raise SystemExit("build-script MainActivity anchor missing")
    bs=bs.replace(anchor,insert,1)
if "cat > src/com/bruis/s5irbridge/IrHttpService.java" not in bs:
    anchor='echo\necho "=== Locating Android SDK pieces ==="\n'
    generated=(
        "cat > src/com/bruis/s5irbridge/BootReceiver.java <<'JAVA_BOOT_V115'\n"+
        boot+"\nJAVA_BOOT_V115\n\n"+
        "cat > src/com/bruis/s5irbridge/IrHttpService.java <<'JAVA_HTTP_V115'\n"+
        http+"\nJAVA_HTTP_V115\n\n"
    )
    if anchor not in bs: raise SystemExit("build toolchain anchor missing")
    bs=bs.replace(anchor,generated+anchor,1)
BUILD_SCRIPT.write_text(bs)

# Extend USB recovery so the resilient APK is installed and service started on the exact trusted S5.
rs=REDISCOVER.read_text()
if "C720P_S5_HTTP_APK_AUTOINSTALL_V115" not in rs:
    anchor="def usb_to_network(prefix):\n"
    if anchor not in rs: raise SystemExit("usb_to_network missing")
    # Inject after exact identity validation, before network ADB conversion.
    needle=" if not (package_ok and model==EXPECTED_MODEL and serial==EXPECTED_SERIAL):\n  return {'ok':False,'present':True,'model':model,'serial':serial,'package_ok':package_ok}\n"
    repl=needle+''' # C720P_S5_HTTP_APK_AUTOINSTALL_V115
 apk=Path('/home/jespern/c720p-home-hub/artifacts/s5-ir-bridge-http-persistent-v115.apk')
 install=None
 service=None
 if apk.exists():
  install=run(['adb','-s',EXPECTED_SERIAL,'install','-r',str(apk)],45)
  service=run(['adb','-s',EXPECTED_SERIAL,'shell','am','startservice','-n','com.bruis.s5irbridge/.IrHttpService'],10)
'''
    if needle not in rs: raise SystemExit("usb identity anchor missing")
    rs=rs.replace(needle,repl,1)
    # Ensure every authenticated network recovery also tries to keep the HTTP bridge alive.
    needle2="  ['adb','-s',target,'shell','setprop','service.adb.tcp.port','5555'],\n"
    if needle2 in rs:
        rs=rs.replace(needle2,needle2+"  ['adb','-s',target,'shell','am','startservice','-n','com.bruis.s5irbridge/.IrHttpService'],\n",1)
REDISCOVER.write_text(rs)

# Build current sources without installing to an unavailable phone.
android_jars=sorted(list(Path("/usr/lib/android-sdk").glob("platforms/*/android.jar"))+
                    list(Path("/opt/android-sdk").glob("platforms/*/android.jar"))+
                    list((HOME/"Android/Sdk").glob("platforms/*/android.jar")))
if not android_jars: raise SystemExit("android.jar missing")
android_jar=str(android_jars[-1])

def tool(name):
    p=shutil.which(name)
    if p:return p
    roots=[Path("/usr/lib/android-sdk"),Path("/opt/android-sdk"),HOME/"Android/Sdk"]
    hits=[]
    for root in roots:
        if root.exists(): hits.extend(root.rglob(name))
    return str(sorted(hits,key=lambda x:str(x))[-1]) if hits else ""

aapt=tool("aapt");d8=tool("d8");dx=tool("dx");zipalign=tool("zipalign");apksigner=tool("apksigner")
if not aapt or not (d8 or dx): raise SystemExit("Android build tools incomplete")

build=APP/"build"
shutil.rmtree(build,ignore_errors=True)
(build/"classes").mkdir(parents=True)
(build/"dex").mkdir(parents=True)

java=[str(x) for x in SRC.glob("*.java")]
subprocess.run(["javac","-source","1.8","-target","1.8","-bootclasspath",android_jar,"-d",str(build/"classes"),*java],check=True)
if d8:
    subprocess.run(["jar","cf",str(build/"classes.jar"),"-C",str(build/"classes"),"."],check=True)
    subprocess.run([d8,"--min-api","19","--lib",android_jar,"--output",str(build/"dex"),str(build/"classes.jar")],check=True)
else:
    subprocess.run([dx,"--dex","--output="+str(build/"dex/classes.dex"),str(build/"classes")],check=True)
subprocess.run([aapt,"package","-f","-M",str(MAN),"-S",str(APP/"res"),"-I",android_jar,"-F",str(build/"unsigned.apk")],check=True)
subprocess.run(["jar","uf",str(build/"unsigned.apk"),"-C",str(build/"dex"),"classes.dex"],check=True)
aligned=build/"aligned.apk"
if zipalign: subprocess.run([zipalign,"-f","4",str(build/"unsigned.apk"),str(aligned)],check=True)
else: shutil.copy2(build/"unsigned.apk",aligned)

ks=HOME/".android/s5-ir-bridge-debug.keystore"
if not ks.exists(): raise SystemExit("existing signing keystore missing")
final=build/"s5-ir-bridge.apk"
if apksigner:
    subprocess.run([apksigner,"sign","--ks",str(ks),"--ks-pass","pass:android","--key-pass","pass:android","--out",str(final),str(aligned)],check=True)
    subprocess.run([apksigner,"verify","--verbose",str(final)],check=True)
else:
    shutil.copy2(aligned,final)
    subprocess.run(["jarsigner","-keystore",str(ks),"-storepass","android","-keypass","android",str(final),"androiddebugkey"],check=True)

ART.parent.mkdir(parents=True,exist_ok=True)
shutil.copy2(final,ART)
subprocess.run(["python3","-m","py_compile",str(REDISCOVER)],check=True)

# Static proof that the APK really contains the new classes and manifest contract.
badging=subprocess.run([aapt,"dump","badging",str(ART)],text=True,capture_output=True,check=True).stdout
dex=subprocess.run(["unzip","-p",str(ART),"classes.dex"],capture_output=True,check=True).stdout
assert b"IrHttpService" in dex and b"BootReceiver" in dex
assert "uses-permission: name='android.permission.INTERNET'" in badging
assert "uses-permission: name='android.permission.RECEIVE_BOOT_COMPLETED'" in badging

print("S5_HTTP_PERSISTENT_APK_V115=OK")
print("APK="+str(ART))
print("APK_SIZE="+str(ART.stat().st_size))
print("BACKUP="+str(BACK))
print("BUILD_SCRIPT_PERSISTENT="+str(marker in BUILD_SCRIPT.read_text()))
print("USB_AUTOINSTALL="+str("C720P_S5_HTTP_APK_AUTOINSTALL_V115" in REDISCOVER.read_text()))
