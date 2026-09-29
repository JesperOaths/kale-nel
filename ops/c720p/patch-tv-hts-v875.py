#!/usr/bin/env python3
from pathlib import Path
import shutil,time,subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
HELPER=BASE/"bin/c720p-bluetooth-helper-server.py"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v875-hts-eight-source-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(HELPER,BACK/"c720p-bluetooth-helper-server.py.before")

s=HELPER.read_text(encoding="utf-8")

new_prepare=r'''def prepare_hts_bluetooth(steps):
    """Recover HT-E6500 Bluetooth without turning an awake/hidden receiver off.

    Important hardware fact from the verified 2026-09-26 cold-start:
    the receiver can be awake while network/BlueZ power evidence is unknown,
    and BT was reached on FUNCTION press 8. Therefore a full eight-source
    ring is mandatory before the one allowed power toggle.
    """
    before = bt_connected_info()
    steps.append({'stage':'hts_bluetooth','check':'initial_bluetooth_connection','result':before})
    if before.get('connected'):
        return {
            'hts_power':'confirmed_on_by_active_bluetooth',
            'hts_input':'confirmed_bluetooth_by_active_connection',
            'skipped_ir':True,
            'evidence':before,
        }

    power = get_json('/ht-e6500/power-state', timeout=8)
    steps.append({'stage':'hts_power','check':'initial_power_state','result':power})

    mac='8C:C8:CD:8B:06:3B'
    def visible_now():
        q=run(['bash','-lc',
            "bluetoothctl devices | grep -iE 'SamsungHTS|8C:C8:CD:8B:06:3B' || true"], timeout=2)
        return bool((q.get('stdout') or '').strip()), q

    scan_proc=None
    try:
        scan_proc=subprocess.Popen(
            ['timeout','80','bluetoothctl','scan','bredr'],
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        steps.append({'stage':'acer_bluetooth_audio','action':'prearm_bredr_discovery_before_power_decision',
                      'result':{'ok':True,'pid':scan_proc.pid}})
    except Exception as exc:
        steps.append({'stage':'acer_bluetooth_audio','action':'prearm_bredr_discovery_before_power_decision',
                      'result':{'ok':False,'error':repr(exc)}})

    def sweep(label):
        checks=[]
        # Current source may already be BT. Give active discovery a short chance.
        for _ in range(3):
            time.sleep(0.25)
            vis,q=visible_now()
            checks.append({'cycle':0,'phase':'initial','visible':vis,'probe':q})
            if vis:
                return True,0,checks
        # Full source ring: the verified cold-start required press 8.
        for cycle in range(1,9):
            fn=post_json('/ht-e6500/function-fast', timeout=5)
            checks.append({'cycle':cycle,'phase':'function','result':fn})
            if not fn.get('ok'):
                return False,None,checks
            deadline=time.monotonic()+2.55
            while time.monotonic()<deadline:
                time.sleep(0.25)
                vis,q=visible_now()
                if vis:
                    checks.append({'cycle':cycle,'phase':'visible','probe':q})
                    return True,cycle,checks
        return False,None,checks

    # UNKNOWN is not OFF. First sweep every source while leaving power alone.
    if str(power.get('state') or '').lower() != 'on':
        vis,cycle,checks=sweep('prepower')
        steps.append({'stage':'hts_bluetooth','action':'full_eight_source_sweep_before_power_toggle',
                      'result':{'ok':vis,'visible':vis,'visible_cycle':cycle,'cycles':checks}})
        if vis:
            return {
                'hts_power':'existing_on_inferred_from_bt_visibility',
                'hts_input':'bluetooth_ready_visible',
                'power_toggle_sent':False,
                'visible_cycle':cycle,
                'evidence':power,
            }

        # Only after a complete 8-source ring produced no evidence may we emit
        # the one and only power toggle for this run.
        toggle=post_json('/ht-e6500/power', timeout=10)
        steps.append({'stage':'hts_power','action':'single_power_toggle_after_complete_source_ring',
                      'result':toggle})
        if not toggle.get('ok'):
            if scan_proc:
                try: scan_proc.terminate()
                except Exception: pass
            return {
                'hts_power':'failed','hts_input':'failed',
                'failure':'HTS_POWER_COMMAND_FAILED','evidence':toggle,
            }

        # Give the receiver enough time to boot before source navigation.
        boot_checks=[]
        boot_deadline=time.monotonic()+7.0
        while time.monotonic()<boot_deadline:
            time.sleep(0.5)
            vis,q=visible_now()
            boot_checks.append({'visible':vis,'probe':q})
            if vis:
                steps.append({'stage':'hts_power','action':'post_power_boot_visibility',
                              'result':{'ok':True,'checks':boot_checks}})
                return {
                    'hts_power':'confirmed_on_by_bt_visibility',
                    'hts_input':'bluetooth_ready_visible',
                    'power_toggle_sent':True,
                    'evidence':power,
                }
        steps.append({'stage':'hts_power','action':'post_power_boot_visibility',
                      'result':{'ok':False,'checks':boot_checks}})

    # Whether power was already known-on or was just toggled on, sweep one full
    # ring and stop at the first actual Bluetooth advertisement.
    vis,cycle,checks=sweep('postpower')
    steps.append({'stage':'hts_bluetooth','action':'full_eight_source_sweep_to_bt',
                  'result':{'ok':vis,'visible':vis,'visible_cycle':cycle,'cycles':checks}})
    if vis:
        return {
            'hts_power':'on_or_commanded_on',
            'hts_input':'bluetooth_ready_visible',
            'visible_cycle':cycle,
            'single_power_toggle_limit':True,
            'evidence':power,
        }

    if scan_proc:
        try: scan_proc.terminate()
        except Exception: pass
    return {
        'hts_power':'commanded_or_existing_on_unverified',
        'hts_input':'adaptive_source_search_required',
        'single_power_toggle_limit':True,
        'evidence':power,
    }


'''
a=s.index("def prepare_hts_bluetooth(steps):")
b=s.index("def _quick_bt_connect",a)
s=s[:a]+new_prepare+s[b:]
HELPER.write_text(s,encoding="utf-8")
subprocess.run(["python3","-m","py_compile",str(HELPER)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],check=True)
time.sleep(1)
print("BACKUP="+str(BACK))
print("HELPER_ACTIVE="+subprocess.run(["systemctl","--user","is-active","c720p-bluetooth-helper.service"],text=True,capture_output=True).stdout.strip())
print("RESULT=V875_EIGHT_SOURCE_POWER_GUARD_PATCHED")
