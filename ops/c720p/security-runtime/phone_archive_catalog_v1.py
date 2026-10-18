"""Validated private client for the S9's metadata-only incremental SD catalog.

Originals, review decisions and inference stay outside this client. A missing
native endpoint permits the legacy reader; malformed/incomplete responses fail
closed so an unavailable phone cannot replace a populated hub index with zero.
"""
import fcntl
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

VERSION="s9_native_archive_catalog_v1"
BASE="http://127.0.0.1:18808"
CACHE=Path("/home/jespern/c720p-home-hub/state/s9-native-archive-client.json")
NAME=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
DIGEST=re.compile(r"[a-f0-9]{64}\Z")
MAX_BYTES=16*1024*1024

class Unavailable(RuntimeError):pass

def _object(raw):
    value=json.loads(raw)
    if not isinstance(value,dict):raise ValueError("phone_catalog_not_object")
    return value

def _record(value):
    if not isinstance(value,dict):raise ValueError("phone_catalog_invalid_record")
    name=value.get("name");size=value.get("bytes");m=value.get("manifest")
    if not isinstance(name,str) or not NAME.fullmatch(name) or type(size) is not int or not 100000<size<800000000:
        raise ValueError("phone_catalog_invalid_file")
    if not isinstance(m,dict) or len(json.dumps(m).encode())>65536 or m.get("name")!=name or m.get("bytes")!=size:
        raise ValueError("phone_catalog_invalid_manifest")
    if m.get("width")!=3840 or m.get("height")!=2160 or not DIGEST.fullmatch(str(m.get("sha256",""))):
        raise ValueError("phone_catalog_not_verified_4k")
    if not DIGEST.fullmatch(str(value.get("version",""))) or type(value.get("thumbnail")) is not bool:
        raise ValueError("phone_catalog_invalid_version")
    thumb=value.get("thumbnail_version")
    if not isinstance(thumb,str) or not re.fullmatch(r"(?:[0-9]{4,7}:[0-9]{10,16})?",thumb):
        raise ValueError("phone_catalog_invalid_thumbnail")
    return name,value

def _cached(path):
    if not path.is_file() or path.stat().st_size>MAX_BYTES:return None
    try:
        value=_object(path.read_bytes())
        if value.get("schema_version")!=VERSION or not DIGEST.fullmatch(str(value.get("snapshot_id",""))):return None
        records=value.get("records")
        if not isinstance(records,dict) or len(records)>2000:return None
        if any(_record(v)[0]!=k for k,v in records.items()):return None
        return value
    except (ValueError,TypeError,OSError):return None

def _read(args):
    url=BASE+"/archive/catalog?"+urllib.parse.urlencode(args)
    try:
        with urllib.request.urlopen(url,timeout=18) as response:
            data=response.read(2*1024*1024+1)
        if len(data)>2*1024*1024:raise ValueError("phone_catalog_page_too_large")
        return _object(data)
    except urllib.error.HTTPError as error:
        if error.code==409:raise BlockingIOError("phone_catalog_changed_during_paging") from error
        if error.code in (404,503):raise Unavailable("phone_catalog_endpoint_unavailable") from error
        raise
    except (urllib.error.URLError,TimeoutError) as error:
        raise Unavailable("phone_catalog_connection_unavailable") from error

def load_catalog(cache=CACHE):
    cache=Path(cache);cache.parent.mkdir(parents=True,exist_ok=True)
    with cache.with_suffix(".lock").open("a+") as guard:
        fcntl.flock(guard,fcntl.LOCK_EX)
        old=_cached(cache)
        for attempt in range(2):
            try:return _load_pages(cache,old)
            except BlockingIOError:
                if attempt:raise Unavailable("phone_catalog_changing_defer")
        raise AssertionError("unreachable")

def _load_pages(cache,old):
    cursor=0;pin=None;mode=None;seen=set();changed=[];removed=[];total=None
    for page_number in range(51):
        args={"cursor":cursor,"limit":40}
        if old:args["since"]=old["snapshot_id"]
        if pin:args["snapshot"]=pin
        data=_read(args)
        identity=data.get("snapshot_id");current_mode=data.get("mode")
        if data.get("ok") is not True or data.get("schema_version")!=VERSION or not DIGEST.fullmatch(str(identity)):
            raise ValueError("phone_catalog_contract")
        if data.get("read_only") is not True or data.get("video_decode_performed") is not False or data.get("errors")!=[]:
            raise ValueError("phone_catalog_incomplete_or_untrusted")
        if data.get("cursor")!=cursor or type(data.get("cursor")) is not int or current_mode not in ("full","delta","unchanged"):
            raise ValueError("phone_catalog_page_contract")
        if mode is None:
            mode=current_mode;pin=identity;total=data.get("total_records");change_count=data.get("change_count")
            if type(total) is not int or not 0<=total<=2000 or type(change_count) is not int or not 0<=change_count<=2000:
                raise ValueError("phone_catalog_count")
            if mode!="full" and not old:raise ValueError("phone_catalog_missing_base")
            if mode=="unchanged" and identity!=old["snapshot_id"]:raise ValueError("phone_catalog_wrong_base")
        if pin!=identity or mode!=current_mode or total!=data.get("total_records") or change_count!=data.get("change_count"):
            raise ValueError("phone_catalog_mixed_snapshot")
        values=data.get("records");deleted=data.get("removed")
        if not isinstance(values,list) or len(values)>40 or not isinstance(deleted,list):raise ValueError("phone_catalog_page_size")
        if page_number and deleted:raise ValueError("phone_catalog_repeated_tombstones")
        for name in deleted:
            if not isinstance(name,str) or not NAME.fullmatch(name) or name in removed:raise ValueError("phone_catalog_bad_tombstone")
            removed.append(name)
        for record in values:
            name,record=_record(record)
            if name in seen:raise ValueError("phone_catalog_duplicate_record")
            seen.add(name);changed.append((name,record))
        following=data.get("next_cursor")
        if following is None:break
        if type(following) is not int or following!=cursor+len(values) or following<=cursor:
            raise ValueError("phone_catalog_bad_cursor")
        cursor=following
    else:raise ValueError("phone_catalog_too_many_pages")
    if len(changed)!=change_count:raise ValueError("phone_catalog_truncated_changes")
    if mode=="full" and removed:raise ValueError("phone_catalog_full_has_tombstones")
    if mode=="unchanged" and (changed or removed):raise ValueError("phone_catalog_unchanged_has_changes")
    records={} if mode=="full" else dict(old["records"])
    for name in removed:
        if name not in records:raise ValueError("phone_catalog_unknown_tombstone")
        del records[name]
    records.update(changed)
    if len(records)!=total:raise ValueError("phone_catalog_incomplete_snapshot")
    result={"schema_version":VERSION,"snapshot_id":pin,"records":records}
    if result!=old:
        raw=json.dumps(result,separators=(",",":"));
        if len(raw.encode())>MAX_BYTES:raise ValueError("phone_catalog_cache_too_large")
        tmp=cache.with_suffix(".partial");tmp.write_text(raw);os.chmod(tmp,0o600);os.replace(tmp,cache)
    return result

def read_asset(name):
    if not (re.fullmatch(r"motion_[0-9]{13}[.]mp4[.]thumb[.]jpg",name) or
            re.fullmatch(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg",name)):
        raise ValueError("phone_archive_invalid_asset")
    try:
        with urllib.request.urlopen(BASE+"/archive/asset/"+name,timeout=18) as response:
            data=response.read(2200001)
        if not 512<=len(data)<=2200000 or data[:3]!=b"\xff\xd8\xff":raise ValueError("phone_archive_invalid_jpeg")
        return data
    except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError) as error:
        raise Unavailable("phone_archive_asset_unavailable") from error

def cache_thumbnail(entry,destination,previous_version):
    """Retry failed refreshes without discarding the last usable thumbnail."""
    destination=Path(destination)
    if not entry["thumbnail"]:return False,""
    wanted=entry["thumbnail_version"]
    exists=destination.is_file()
    if exists and previous_version==wanted and destination.stat().st_size==int(wanted.split(":")[0]):
        return True,wanted
    try:
        raw=read_asset(entry["name"]+".thumb.jpg")
        destination.parent.mkdir(parents=True,exist_ok=True)
        if not exists or destination.read_bytes()!=raw:
            tmp=destination.with_suffix(".jpg.phone-tmp");tmp.write_bytes(raw);os.replace(tmp,destination)
        return True,wanted
    except Unavailable:
        return exists,previous_version or ""
