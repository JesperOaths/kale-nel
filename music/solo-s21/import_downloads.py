"""Finalize a checksum-verified S21 Downloads transfer, without session eviction.

Input is a private operator manifest containing copied paths, SHA-256 checks
and curated playlist metadata. This script never downloads music.
"""
import argparse,hashlib,json,os,re,sqlite3,time,unicodedata
from pathlib import Path
from persistent_music_library import PersistentMusicLibrary,LIBRARY_BYTES,RESERVED_FREE_BYTES
from permanent_audio import inspect_mp3
import shutil

def norm(s):
    s=unicodedata.normalize('NFKD',str(s or '').replace('&',' and ').replace('Я','R')).casefold()
    return ''.join(c for c in s if c.isalnum() and not unicodedata.combining(c))

def core(s):
    s=re.sub(r'[\[(]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^)\]]*[)\]]','',str(s),flags=re.I)
    s=re.sub(r'\b(?:19|20)\d{2}\s+remaster(?:ed)?\b|\bremaster(?:ed)?(?:\s+(?:19|20)\d{2})?\b','',s,flags=re.I)
    s=re.sub(r'\b(?:feat\.?|ft\.?|featuring)\s+.*$','',s,flags=re.I)
    return norm(s)

EXTRA_TAGS=[(['pop','rock'],'1980'),(['pop','dance'],'1980'),(['rock','indie'],'1990'),
 (['pop','rock'],'1990'),(['pop','rock'],'1980'),(['pop','rock'],'1980'),(['dance','pop'],'1990'),
 (['dance','electronic'],'1980'),(['dance','electronic'],'1980'),(['dance','pop'],'1990'),
 (['dance','electronic'],'1990'),(['rock'],'1970'),(['pop','rock'],'1960'),(['pop','dance'],'1980'),
 (['pop','rnb'],'1980'),(['rock','pop'],'1970'),(['pop'],'1960'),(['rock'],'1980'),
 (['pop','rnb'],'2010'),(['pop','indie'],'2010'),(['indie','rock'],'2010'),(['indie','pop'],'2010'),
 (['pop'],'1980'),(['rnb','hiphop'],'1990'),(['rnb','pop'],'1990')]

def run(manifest_path):
    manifest=json.loads(Path(manifest_path).read_text())
    rows=manifest['files'];targets=manifest['targets'];curated=manifest['curated']['tracks']
    lib=PersistentMusicLibrary()
    report_path=lib.root/'downloads-import-20261104.json'
    progress_path=lib.root/'downloads-import-progress.json'
    backup=lib.root/'library.before-downloads-20261104.sqlite3'
    if not backup.exists():
        with sqlite3.connect(lib.database) as source,sqlite3.connect(backup) as target:source.backup(target)
        backup.chmod(0o600)
    incoming=(lib.root/'incoming-downloads-20261104').resolve()
    results=[];by_uri={};started=time.time()
    unique_sizes={}
    for row in rows:
        source=Path(row['privateSource'])
        if not source.resolve().is_relative_to(incoming) or source.is_symlink():raise ValueError('Unsafe import path')
        sha=row['sha256']
        if not re.fullmatch('[0-9a-f]{64}',sha):raise ValueError('Invalid checksum')
        target=lib.tracks/(sha+'.mp3')
        p=source if source.exists() else target
        unique_sizes[sha]=p.stat().st_size
    if sum(unique_sizes.values())>LIBRARY_BYTES:raise ValueError('Audio exceeds permanent library capacity')
    if shutil.disk_usage(lib.root).free<RESERVED_FREE_BYTES:raise ValueError('Phone storage reserve is insufficient')
    for number,row in enumerate(rows,1):
        source=Path(row['privateSource']);sha=row['sha256'];target=lib.tracks/(sha+'.mp3')
        p=source if source.exists() else target
        # Recheck at the final move boundary; retained files are bit-identical.
        digest=hashlib.sha256()
        with p.open('rb') as f:
            for b in iter(lambda:f.read(1024*1024),b''):digest.update(b)
        if digest.hexdigest()!=sha:raise ValueError('Staged recording checksum differs')
        info=inspect_mp3(p)
        if source.exists():
            if target.exists():source.unlink()
            else:source.replace(target);target.chmod(0o600)
        with lib._locked(),lib._db() as db:
            db.execute('''INSERT INTO recordings(sha256,filename,bytes,extension,title,artist,spotify_uri,imported_at)
                VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(sha256) DO NOTHING''',
                (sha,target.name,target.stat().st_size,'.mp3',row['target']['title'],row['target']['artists'][0],row['target']['uri'],int(time.time())))
        result={'source':row['path'],'sha256':sha,'bytes':target.stat().st_size,
                'spotifyUri':row['target']['uri'],'durationMs':round(info['duration']*1000),
                'bitrateKbps':info['bitrate'],'verified':True}
        results.append(result)
        old=by_uri.get(result['spotifyUri'])
        # Prefer the playlist copy and the highest bitrate; preserve all other
        # distinct file contents without repeating that song in the game pool.
        quality=(int('Tune_Rush_' in row['path']),info['bitrate'],target.stat().st_size)
        if old is None or quality>old[0]:by_uri[result['spotifyUri']]=(quality,result)
        if number%20==0:progress_path.write_text(json.dumps({'processed':number,'total':len(rows),'elapsed':round(time.time()-started,1)}))
    entries=[]
    for t in targets:
        artists={norm(a) for a in t['artists']}
        alias={'alicedeejay':'alicedj','bobseger':'bobsegerandthesilverbulletband'}
        artists|={alias[a] for a in list(artists) if a in alias}
        candidates=[c for c in curated if core(c['title'])==core(t['title']) and norm(c['artist']) in artists]
        if not candidates:
            family=lambda title:norm(title.split(' - ',1)[0].split('(',1)[0])
            candidates=[c for c in curated if family(c['title'])==family(t['title']) and norm(c['artist']) in artists]
        if candidates:c=max(candidates,key=lambda c:int(c.get('rank',0)));genres=c['genres'];decades=c['decades'];rank=c['rank']
        elif t['playlist']==10 and t['position']>=76:
            genres,decade=EXTRA_TAGS[t['position']-76];decades=[decade];rank=800000
        else:genres=['pop'];decades=[];rank=800000
        chosen=by_uri.get(t['uri']);record=chosen[1] if chosen else None
        entries.append({**t,'artist':t['artists'][0],'genres':genres,'decades':decades,'rank':rank,
            'sha256':record['sha256'] if record else None,'actualDurationMs':record['durationMs'] if record else None})
    with lib._locked(),lib._db() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS tunerush_playable_catalog(
            spotify_uri TEXT PRIMARY KEY,title TEXT NOT NULL,artist TEXT NOT NULL,
            genres_json TEXT NOT NULL,decades_json TEXT NOT NULL,rank INTEGER NOT NULL,
            sha256 TEXT REFERENCES recordings(sha256),duration_ms INTEGER,playlist INTEGER,position INTEGER)''')
        for e in entries:
            db.execute('''INSERT INTO tunerush_playable_catalog VALUES(?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(spotify_uri) DO UPDATE SET title=excluded.title,artist=excluded.artist,
                genres_json=excluded.genres_json,decades_json=excluded.decades_json,rank=excluded.rank,
                sha256=excluded.sha256,duration_ms=excluded.duration_ms,playlist=excluded.playlist,position=excluded.position''',
                (e['uri'],e['title'],e['artist'],json.dumps(e['genres']),json.dumps(e['decades']),e['rank'],e['sha256'],e['actualDurationMs'],e['playlist'],e['position']))
    report={'version':1,'files':results,'catalog':entries,'filesVerified':len(results),'catalogSongs':len(entries),
            'playableSongs':len(by_uri),'uniqueRecordingFiles':len(unique_sizes),'storedAudioBytes':sum(unique_sizes.values()),
            'missingSongs':[{'title':e['title'],'artist':e['artist']} for e in entries if not e['sha256']],
            'permanent':True,'autoDelete':False}
    report_path.write_text(json.dumps(report,ensure_ascii=False));report_path.chmod(0o600)
    progress_path.write_text(json.dumps({k:v for k,v in report.items() if k not in ('files','catalog')}|{'done':True}))
    print(json.dumps({k:v for k,v in report.items() if k not in ('files','catalog')}))
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('manifest');run(p.parse_args().manifest)
