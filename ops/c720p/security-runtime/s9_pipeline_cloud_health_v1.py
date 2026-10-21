"""Aggregate existing private pipeline metadata for the existing health sink.

No network/process/camera calls, media reads, model execution or state writes.
Never export recording/person identifiers, raw review contents or vectors.
"""
import datetime as dt
import json
import os
from pathlib import Path
import stat

STATE=Path('/home/jespern/c720p-home-hub/state')
SCHEMA='security_pipeline_cloud_health_v1'
STATES=('pending','processing','completed','blocked','rejected','dead_letter')


class Invalid(ValueError):pass


def count(v):
    if type(v) is not int or not 0<=v<=1000000:raise Invalid('count')
    return v


def pairs(items):
    result={}
    for k,v in items:
        if k in result:raise Invalid('duplicate_key')
        result[k]=v
    return result


def read(root,relative,limit):
    path=Path(root)
    if path.is_symlink() or not path.is_dir():raise Invalid('root')
    for part in relative.split('/'):
        path=path/part
        if path.is_symlink():raise Invalid('symlink')
    fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)|getattr(os,'O_NONBLOCK',0))
    with os.fdopen(fd,'rb') as f:
        a=os.fstat(f.fileno())
        if (not stat.S_ISREG(a.st_mode) or not 2<a.st_size<=limit
                or (os.name!='nt' and a.st_mode&0o022)):raise Invalid('metadata')
        raw=f.read(limit+1);b=os.fstat(f.fileno())
        if len(raw)>limit or (a.st_size,a.st_mtime_ns)!=(b.st_size,b.st_mtime_ns):
            raise Invalid('changed')
    d=json.loads(raw,object_pairs_hook=pairs,
        parse_constant=lambda _:(_ for _ in ()).throw(Invalid('nonfinite')))
    if not isinstance(d,dict):raise Invalid('object')
    return d


def rescan(root):
    d=read(root,'s9-priority-rescan-v304/queue.json',4000000)
    if d.get('schema')!='s9_priority_rescan_feedback_v304':raise Invalid('schema')
    rows=d.get('rows')
    if not isinstance(rows,list) or len(rows)>10000:raise Invalid('rows')
    result={'state':'reported','revision':count(d.get('revision')),
            'tracked':len(rows),**dict.fromkeys(STATES,0),
            'worker_activity_verified':None,'results_current_source_verified':None}
    for r in rows:
        if not isinstance(r,dict) or r.get('status') not in STATES:raise Invalid('row')
        result[r['status']]+=1
    return result


def manual(root):
    d=read(root,'s9-manual-recording-links-v1.json',500000)
    if d.get('version')!=1 or type(d.get('version')) is not int:raise Invalid('schema')
    rows=d.get('items')
    if not isinstance(rows,dict) or len(rows)>10000:raise Invalid('rows')
    bound=0
    for r in rows.values():
        if not isinstance(r,dict):raise Invalid('row')
        b=r.get('media_binding')
        if isinstance(b,dict) and b.get('status')=='bound_at_decision':bound+=1
    return {'state':'reported','revision':count(d.get('revision')),'decisions':len(rows),
            'reported_bound_at_decision':bound,'without_reported_binding':len(rows)-bound,
            'current_source_binding_verified':None,'live_write_binding_verified':None}


def s3(root,now):
    d=read(root,'s3-motion-health.json',32768)
    v=d.get('checked_at_utc')
    if not isinstance(v,str) or len(v)>64:raise Invalid('clock')
    when=dt.datetime.fromisoformat(v.replace('Z','+00:00'))
    if when.tzinfo is None:raise Invalid('clock')
    age=(now-when).total_seconds()
    if age < -180:raise Invalid('future')
    result={'state':'current' if age<=1800 else 'stale','age_seconds':max(0,round(age))}
    for k in ('healthy','motion_analysis_active','motion_health_verified','privacy_adb_port_closed_recently'):
        value=d.get(k)
        if value is not None and type(value) is not bool:raise Invalid('boolean')
        result[k]=value
    if result['motion_health_verified'] is not True:
        result['healthy']=None;result['motion_analysis_active']=None
    return result


def build(root=STATE,now=None):
    import s9_security_component_health_v1 as existing
    now=now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:raise ValueError('aware_time_required')
    now=now.astimezone(dt.timezone.utc)
    report={'schema_version':SCHEMA,'observed_at_utc':now.isoformat(),
            'components':existing.build(root=root,now=now)['components']}
    for name,fn in (('rescan',rescan),('manual_binding',manual),('s3',lambda p:s3(p,now))):
        try:report[name]=fn(root)
        except (OSError,ValueError,TypeError,KeyError,OverflowError,RecursionError):
            report[name]={'state':'unavailable'}
    warnings=[]
    if any(c['status']!='current' for c in report['components'].values()):warnings.append('component_report_stale_or_unavailable')
    i=report['components']['infrastructure']
    if i.get('root_available_bytes') is not None and i['root_available_bytes']<2*1024**3:warnings.append('hub_storage_low')
    if i.get('ntp_synchronized') is False:warnings.append('hub_clock_unsynchronized')
    for name in ('rescan','manual_binding','s3'):
        if report[name]['state'] in ('unavailable','stale'):warnings.append(name+'_report_unavailable_or_stale')
    if report['rescan'].get('blocked',0):warnings.append('rescan_work_blocked')
    if report['rescan'].get('dead_letter',0):warnings.append('rescan_work_failed')
    if report['manual_binding'].get('without_reported_binding',0):warnings.append('manual_decisions_without_binding')
    if report['s3'].get('motion_health_verified') is not True:warnings.append('s3_motion_unverified')
    report.update(status='warning' if warnings else 'reports_loaded',warnings=warnings,
        all_pipeline_paths_verified=False,read_only=True,workers_started=False,
        media_read=False,manual_reviews_modified=False)
    return report


def patch_publisher(source):
    anchor='def main():\n'
    field="      'person_detection':person_summary(),"
    if source.count(anchor)!=1 or source.count(field)!=1 or 'security_pipeline_summary' in source:
        raise ValueError('unexpected_health_publisher')
    helper=('def security_pipeline_summary():\n'
        '    try:\n'
        '        from s9_pipeline_cloud_health_v1 import build\n'
        '        return build()\n'
        '    except Exception:\n'
        '        return {"schema_version":"security_pipeline_cloud_health_v1",\n'
        '                "status":"unavailable","all_pipeline_paths_verified":False}\n\n')
    return source.replace(anchor,helper+anchor,1).replace(field,
        "      'security_pipeline':security_pipeline_summary(),\n"+field,1)
