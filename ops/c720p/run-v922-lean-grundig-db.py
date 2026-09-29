#!/usr/bin/env python3
import io, json, os, pathlib, sqlite3, subprocess, tempfile, zipfile, re

SER="993e96d0"
PKG="co.leanremote.universalremotecontrol.remotecontrol"

def run(args,timeout=30):
    p=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    return p.returncode,p.stdout or ""

rc,out=run(["adb","-s",SER,"shell","pm","path",PKG],15)
paths=[x.split("package:",1)[1].strip() for x in out.splitlines() if x.startswith("package:")]
if not paths:
    raise SystemExit("LEANREMOTE_APK_NOT_FOUND")
base=next((p for p in paths if p.endswith("/base.apk")),paths[0])
apk="/tmp/v922-lean-base.apk"
rc,pull=run(["adb","-s",SER,"pull",base,apk],40)
if rc!=0: raise SystemExit("APK_PULL_FAILED "+pull[-1000:])

with zipfile.ZipFile(apk) as z:
    raw=z.read("assets/databases/visio.zip")
with zipfile.ZipFile(io.BytesIO(raw)) as z:
    names=z.namelist()
    dbname="visio" if "visio" in names else next(n for n in names if not n.endswith("/"))
    dbbytes=z.read(dbname)
db="/tmp/v922-visio.db"
pathlib.Path(db).write_bytes(dbbytes)

con=sqlite3.connect(db)
con.row_factory=sqlite3.Row
cur=con.cursor()
tables=[r[0] for r in cur.execute("select name from sqlite_master where type='table' order by name")]
print("TABLES="+json.dumps(tables))

hits=[]
for t in tables:
    try:
        cols=[r[1] for r in cur.execute(f'pragma table_info("{t}")')]
        textcols=[]
        for c in cols:
            textcols.append(c)
        if not textcols: continue
        cond=" OR ".join([f'lower(cast("{c}" as text)) like ?' for c in textcols])
        q=f'select * from "{t}" where {cond} limit 100'
        rows=cur.execute(q,["%grundig%"]*len(textcols)).fetchall()
        for row in rows:
            d={k:row[k] for k in row.keys()}
            hits.append({"table":t,"row":d})
    except Exception as e:
        print("SEARCH_ERR",t,repr(e))

print("GRUNDIG_HITS="+json.dumps(hits,default=str,indent=2))

# Collect likely fragment/profile identifiers from all Grundig rows.
frags=set()
for h in hits:
    for k,v in h["row"].items():
        if v is None: continue
        s=str(v)
        if re.search(r'fragment|remote|code|tv|grundig',k,re.I) or re.match(r'^[A-Za-z]{2,}[A-Za-z0-9_-]*\d+$',s):
            if len(s)<120: frags.add(s)

# Add any fragment names in remote table that themselves mention Grundig.
if "remote" in tables:
    cols=[r[1] for r in cur.execute('pragma table_info("remote")')]
    print("REMOTE_COLUMNS="+json.dumps(cols))
    if "fragment" in cols:
        for (frag,) in cur.execute("select distinct fragment from remote where lower(fragment) like '%grund%' order by fragment"):
            frags.add(str(frag))

print("CANDIDATE_FRAGMENTS="+json.dumps(sorted(frags)))

# Print power rows for exact candidate fragments where possible.
power_rows=[]
if "remote" in tables:
    cols=[r[1] for r in cur.execute('pragma table_info("remote")')]
    fragcol="fragment" if "fragment" in cols else None
    btncol="button_fragment" if "button_fragment" in cols else None
    if fragcol and btncol:
        for frag in sorted(frags):
            try:
                rows=cur.execute(
                    "select * from remote where fragment=? and lower(button_fragment) like '%power%' order by button_fragment",
                    (frag,)
                ).fetchall()
                for row in rows:
                    d={k:row[k] for k in row.keys()}
                    frame=str(d.get("main_frame") or "")
                    nums=[x.strip() for x in frame.split(",") if x.strip()]
                    d["main_frame_len"]=len(nums)
                    power_rows.append(d)
            except Exception:
                pass
print("GRUNDIG_POWER_ROWS="+json.dumps(power_rows,default=str,indent=2))
con.close()
print("RESULT=V922_LEAN_GRUNDIG_DB_EXTRACTED")
