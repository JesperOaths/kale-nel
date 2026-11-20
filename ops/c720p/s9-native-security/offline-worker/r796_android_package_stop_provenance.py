#!/usr/bin/env python3
"""R796 bounded forensic evidence for external S9 native Camera2 package stops.

Read-only: Android ActivityManager system buffer, instantaneous ADB TCP peer
snapshot, app PID. Does not access camera pixels, face embeddings, files, or
identity labels; does not force-stop/restart apps or add scheduled jobs.

Critical limitation: a live TCP peer is NOT historical command attribution.
The system log gives an Android caller PID; adjacent ActivityTaskManager
'from uid 2000' supplies consistent shell-initiated restart evidence, not
proof of which PC originated the earlier force-stop.
"""
from __future__ import annotations
import argparse,datetime as dt,json,os,pathlib,re,subprocess,sys
from collections import Counter

PACKAGE="nl.kalenel.s9security"
PHONE="192.168.178.250:5555"
SAVE=pathlib.Path("/home/jespern/c720p-home-hub/staging/recognition-r744-ain-small-model-assets-20261120")
STOP_RE=re.compile(
    r"(?P<day>[0-1]\d-[0-3]\d) (?P<clock>[0-2]\d:[0-5]\d:[0-5]\d)\.(?P<ms>\d{3}).{0,140}"
    r"ActivityManager: Force stopping nl\.kalenel\.s9security"
    r" appid=\d+ user=(?P<user>\d+): from pid (?P<pid>\d+)")
START_RE=re.compile(
    r"(?P<day>[0-1]\d-[0-3]\d) (?P<clock>[0-2]\d:[0-5]\d:[0-5]\d)\.(?P<ms>\d{3}).{0,180}"
    r"ActivityTaskManager: START u0 \{.{0,300}"
    r"cmp=nl\.kalenel\.s9security/\.CameraActivity"
    r".{0,120}from uid (?P<uid>\d+)")
SOCKET_RE=re.compile(
    r"\[::ffff:[0-9.]+\]:5555\s+\[::ffff:(?P<peer>[0-9.]+)\]:\d+"
)

def need(x,message):
    if not x:raise ValueError(message)

def parse_time(match,year=2026):
    try:
        val=dt.datetime.strptime(
           f"{year}-{match['day']} {match['clock']}.{match['ms']}",
           "%Y-%m-%d %H:%M:%S.%f")
    except ValueError as error:
        raise ValueError("invalid_system_buffer_timestamp") from error
    return val

def parse_log(raw):
    need(type(raw) is str and len(raw)<12_000_000,"log_invalid_size")
    stops={}
    starts=[]
    for line in raw.splitlines():
        if PACKAGE not in line:continue
        m=STOP_RE.search(line)
        if m:
            # Android may separately stop user 0 and the work profile
            # with the SAME caller PID at the same wall clock instant.
            t=parse_time(m)
            if int(m['user'])==0:
                token=(t.isoformat(timespec="milliseconds"),int(m['pid']))
                stops[token]={"when":token[0],"caller_pid":token[1],
                              "android_user":0}
            continue
        m=START_RE.search(line)
        if m:
            starts.append((parse_time(m),int(m["uid"])))
    rows=[]
    for (date,pid),entry in sorted(stops.items()):
        ts=dt.datetime.fromisoformat(date)
        near=[uid for t,uid in starts if 0<=(t-ts).total_seconds()<=2]
        rows.append({**entry,
           "adjacent_app_start_shell_uid_2000":2000 in near,
           "caller_is_proven_linux_shell_uid":False,
           "caller_host_ip_proven":False})
    return rows

def parse_peers(raw):
    need(type(raw) is str and len(raw)<200_000,"ss_output_invalid")
    return sorted(set(SOCKET_RE.findall(raw)))

def report(log,ss):
    rows=parse_log(log)
    peers=parse_peers(ss)
    paired=sum(1 for r in rows if r["adjacent_app_start_shell_uid_2000"])
    return {
        "schema":"s9_r796_external_package_stop_attribution_v1",
        "native_camera_package":PACKAGE,
        "package_stop_events_observed":len(rows),
        "android_forcestop_caller_pids":[r["caller_pid"] for r in rows],
        "local_stop_times":[r["when"] for r in rows],
        "shell_uid_2000_camera_activity_relaunches_within_two_seconds":paired,
        "source_classification":"ADB_OR_ANDROID_SHELL_ORCHESTRATION_CONSISTENT",
        "individual_force_stop_caller_uid_proven":False,
        "historical_originating_network_peer_proven":False,
        "network_peer_snapshot_is_at_a_different_time_from_historical_stops":True,
        "currently_connected_adb_peer_count":len(peers),
        "currently_connected_adb_peers":peers,
        "specific_script_or_computer_identified":False,
        "native_camera_java_exception_cause_proven":False,
        "root_cause_fully_eliminated":False,
        "no_phone_or_hub_recurring_jobs_added":True,
        "camera_service_control_actions":0,
        "real_person_data_read":0,
        "automatic_people_folder_filing_authorized":False,
    }

def run(*argv,timeout=12):
    p=subprocess.run(list(argv),capture_output=True,text=True,
                     timeout=timeout)
    need(p.returncode==0,"read_only_forensic_command_failed")
    return p.stdout

def live():
    log=run("adb","-s",PHONE,"shell",
            "logcat -b system -d -v threadtime",timeout=16)
    ss=run("adb","-s",PHONE,"shell","ss -tn",timeout=8)
    q=report(log,ss)
    need(q["package_stop_events_observed"]>=1,
         "no_stops_present_in_android_system_buffer")
    SAVE.mkdir(exist_ok=True)
    data=(json.dumps(q,sort_keys=True,indent=2)+"\n").encode()
    dest=SAVE/("r796_private_external_stop_attribution_"+
        dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".json")
    fd=os.open(dest,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"wb") as file:
        file.write(data);file.flush();os.fsync(file.fileno())
    print(json.dumps({**q,"private_receipt_saved":True},sort_keys=True))

def self_test():
    def stop(t,pid,user=0):
        return (f"11-20 {t} 978 1408 I ActivityManager: Force stopping "
                f"{PACKAGE} appid=10661 user={user}: from pid {pid}")
    def start(t,uid=2000):
        return (f"11-20 {t} 978 1408 I ActivityTaskManager: START u0 "
                f"{{flg=0x10000000 cmp={PACKAGE}/.CameraActivity "
                f"(has extras)}} from uid {uid}")
    lines=[
        stop("05:57:00.489",2588),
        stop("05:57:00.659",2588,150),
        start("05:57:00.777"),
        stop("06:00:12.466",4387),
        start("06:00:12.729"),
        stop("06:03:48.563",5642),
        start("06:03:48.858"),
        stop("06:06:45.788",7080),
        start("06:06:46.080"),
    ]
    peerlines=("ESTAB 0 0 [::ffff:192.168.178.250]:5555 "
               "[::ffff:192.168.178.141]:38414\n"
               "ESTAB 0 0 [::ffff:192.168.178.250]:5555 "
               "[::ffff:192.168.178.45]:65011")
    x=report("\n".join(lines),peerlines)
    need(x["package_stop_events_observed"]==4 and
         x["shell_uid_2000_camera_activity_relaunches_within_two_seconds"]==4
         and x["currently_connected_adb_peer_count"]==2
         and x["historical_originating_network_peer_proven"] is False,
         "source_peers_wrongly_promoted_to_historical_attribution")
    tests=0
    altered=lines+[stop("06:06:45.788",7080)] # exact duplicate
    need(report("\n".join(altered),peerlines)["package_stop_events_observed"]==4,
         "duplicate_stop_overcounted");tests+=1
    altered=lines+[stop("06:07:00.000",7100).replace(PACKAGE,
                                                       "com.test.other")]
    need(report("\n".join(altered),peerlines)["package_stop_events_observed"]==4,
         "other_package_overcounted");tests+=1
    x=report("\n".join(lines[:1]),peerlines)
    need(x["package_stop_events_observed"]==1 and
         x["shell_uid_2000_camera_activity_relaunches_within_two_seconds"]==0
         and x["specific_script_or_computer_identified"] is False,
         "bare_stop_automatically_attributed");tests+=1
    x=report("\n".join(lines).replace("from uid 2000","from uid 10661"),
             peerlines)
    need(x["shell_uid_2000_camera_activity_relaunches_within_two_seconds"]==0,
         "non_shell_app_start_conflated");tests+=1
    x=report("\n".join(lines),peerlines.replace("192.168.178.45","192.168.178.141"))
    need(x["currently_connected_adb_peer_count"]==1 and
         x["historical_originating_network_peer_proven"] is False,
         "single_current_peer_wrongly_claimed_historical_caller");tests+=1
    need(parse_peers("")==[],"empty_peer_query_wrong");tests+=1
    print(json.dumps({
        "result":"R796_HISTORICAL_SHELL_RESTART_ATTRIBUTION_SYNTHETIC_PASS",
        "fault_and_nonoverclaim_tests":tests,
        "stop_count_fixture":4,
        "live_phone_accessed":False,
        "historical_caller_host_claimed":False,
        "auto_filing_authorized":False
    },sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--self-test",action="store_true")
    mode.add_argument("--audit-live",action="store_true")
    a=p.parse_args()
    if a.self_test:self_test()
    else:live()
if __name__=="__main__":main()
