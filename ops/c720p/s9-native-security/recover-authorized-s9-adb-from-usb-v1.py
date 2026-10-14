#!/usr/bin/env python3
"""Restore authorized S9+ wireless ADB, with a USB fallback.

Runs locally on C720P from the existing bridge service. Never selects S3/S5
or arbitrary devices; requires exact Samsung SM-G965F model for USB recovery.
No camera APK operations, shell modifications or media changes.
"""
import re,subprocess,sys,time

HOST="192.168.178.250:5555"
ADB="/usr/bin/adb"
MODEL="SM-G965F"

def call(*args,timeout=12):
 p=subprocess.run([ADB,*args],capture_output=True,text=True,timeout=timeout)
 return p.returncode,p.stdout.strip(),p.stderr.strip()

def live():
 rc,out,err=call("-s",HOST,"get-state",timeout=9)
 return rc==0 and out=="device"

def connect():
 call("connect",HOST,timeout=10)
 return live()

def forward():
 rc,out,err=call("-s",HOST,"forward","tcp:18808","tcp:8808",timeout=9)
 if rc:return False
 return True

def main():
 if connect() and forward():
  print("S9_ADB_WIFI_RESTORED",HOST,flush=True)
  return 0

 rc,devices,err=call("devices","-l",timeout=8)
 if rc:
  print("S9_NO_ADB_DEVICE_LIST",err[-130:],flush=True)
  return 1

 authorized_usb=[]
 for line in devices.splitlines()[1:]:
  parts=line.split()
  if len(parts)<2 or parts[1]!="device" or ":" in parts[0]:
   continue
  serial=parts[0]
  # USB transport MUST identify as the user's exact S9+.
  check,model,_=call("-s",serial,"shell","getprop","ro.product.model",timeout=9)
  if check==0 and model.strip()==MODEL:
   authorized_usb.append(serial)

 if len(authorized_usb)!=1:
  print("S9_USB_NOT_CONNECTED_OR_UNAUTHORIZED",len(authorized_usb),flush=True)
  return 1

 serial=authorized_usb[0]
 rc,out,err=call("-s",serial,"tcpip","5555",timeout=14)
 if rc or "restarting" not in out.lower():
  print("S9_USB_TCPIP_SWITCH_FAILED",out[-120:],err[-120:],flush=True)
  return 1
 for i in range(8):
  time.sleep(1)
  if connect() and forward():
   print("S9_ADB_AUTHORIZED_USB_TO_WIFI_RECOVERED",HOST,flush=True)
   return 0
 print("S9_USB_AUTHORIZED_BUT_WIFI_ADB_UNREACHABLE",HOST,flush=True)
 return 1

if __name__=="__main__":
 sys.exit(main())
