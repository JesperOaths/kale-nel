"""Play the S21's permanent, user-supplied MP3 library.

Only bounded, metadata-free clues leave the phone. Full recordings remain in
the permanent library and are independent of session/cache cleanup.
"""
from __future__ import annotations
import base64
import functools
import json
import mmap
import random
import re
import secrets
import sqlite3
from pathlib import Path

from persistent_music_library import LIBRARY_ROOT

_RATES=(44100,48000,32000)
_BITRATES={3:(0,32,40,48,56,64,80,96,112,128,160,192,224,256,320),
           2:(0,8,16,24,32,40,48,56,64,80,96,112,128,144,160)}
_SHA=re.compile(r'^[0-9a-f]{64}$')
MAX_CLUE_BYTES=1100000

def title_answers(title):
    """Accept the song title without Spotify's edition/guest metadata."""
    original=str(title)
    plain=re.sub(r'[\[(]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^)\]]*[)\]]','',original,flags=re.I)
    plain=re.sub(r'\s*(?:-|\(|\[)\s*(?:(?:19|20)\d{2}\s+remaster|remaster|radio edit|album version|single version|from .+soundtrack).*$', '',plain,flags=re.I).strip()
    return [original,plain] if plain and plain!=original else [original]

def frame_header(data,pos):
    if pos+4>len(data):return None
    h=int.from_bytes(data[pos:pos+4],'big')
    if h>>21!=0x7ff:return None
    version=(h>>19)&3;layer=(h>>17)&3;rate_index=(h>>10)&3;bit_index=(h>>12)&15
    if version==1 or layer!=1 or rate_index==3 or bit_index in (0,15):return None
    rate=_RATES[rate_index]//(1 if version==3 else 2 if version==2 else 4)
    bitrate=_BITRATES[3 if version==3 else 2][bit_index]
    length=(144000 if version==3 else 72000)*bitrate//rate+((h>>9)&1)
    return {'length':length,'seconds':(1152 if version==3 else 576)/rate,
            'rate':rate,'bitrate':bitrate,'version':version}

def _first_frame(data,start=0,stop=None):
    end=min(len(data)-4,start+65536 if stop is None else stop)
    pos=start
    while pos<end:
        candidate=data.find(b'\xff',pos,end)
        if candidate<0:break
        header=frame_header(data,candidate)
        if header:
            next_header=frame_header(data,candidate+header['length'])
            if next_header and next_header['rate']==header['rate']:return candidate,header
        pos=candidate+1
    raise ValueError('The recording has no valid MP3 audio frames.')

def _info(data):
    start=0
    if data[:3]==b'ID3':
        size=0
        for n in data[6:10]:size=(size<<7)|n
        start=10+size+(10 if data[5]&0x10 else 0)
    pos,h=_first_frame(data,start)
    first=data[pos:pos+h['length']]
    frames=None
    for marker in (b'Xing',b'Info'):
        at=first.find(marker)
        if at>=0 and at+12<=len(first) and int.from_bytes(first[at+4:at+8],'big')&1:
            frames=int.from_bytes(first[at+8:at+12],'big');break
    at=first.find(b'VBRI')
    if not frames and at>=0 and at+18<=len(first):frames=int.from_bytes(first[at+14:at+18],'big')
    duration=frames*h['seconds'] if frames else (len(data)-pos)*8/(1000*h['bitrate'])
    if not 25<=duration<=7200:raise ValueError('The recording is too short or invalid.')
    return {'offset':pos,'duration':duration,'bitrate':h['bitrate']}

def inspect_mp3(path):
    with Path(path).open('rb') as f,mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ) as data:
        return _info(data)

@functools.lru_cache(maxsize=32)
def _clue(path_string,mtime_ns,cue_ms,duration_ms):
    path=Path(path_string)
    if path.stat().st_mtime_ns!=mtime_ns:raise ValueError('Music file changed; reload the game.')
    with path.open('rb') as f,mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ) as data:
        info=_info(data)
        if not 0<=cue_ms/1000<info['duration']-duration_ms/1000-0.5:
            raise ValueError('Music clue position is outside the recording.')
        # Seek by byte position; random clue positions need no sample-accurate
        # whole-song index. Each emitted clue itself is measured by MP3 samples.
        approximate=info['offset']+int((len(data)-info['offset'])*max(0,cue_ms/1000-.25)/info['duration'])
        pos,h=_first_frame(data,approximate)
        chunks=[];elapsed=0.0;length=0
        while elapsed<(duration_ms/1000+.25):
            h=frame_header(data,pos)
            if not h or pos+h['length']>len(data):raise ValueError('Incomplete MP3 clue.')
            chunks.append(data[pos:pos+h['length']]);length+=h['length']
            if length>MAX_CLUE_BYTES:raise ValueError('Clue exceeds the media limit.')
            pos+=h['length'];elapsed+=h['seconds']
        return b''.join(chunks)

def clue_data(track,cue_ms,duration_ms,root=LIBRARY_ROOT):
    if duration_ms not in (500,1500,3000,5000,8000,12000,20000):raise ValueError('Invalid clue duration.')
    sha=track.get('sha256','')
    if not _SHA.fullmatch(sha):raise ValueError('Invalid permanent music identifier.')
    path=Path(root)/'tracks'/(sha+'.mp3')
    if path.is_symlink():raise ValueError('Invalid music file.')
    raw=_clue(str(path),path.stat().st_mtime_ns,int(cue_ms),int(duration_ms))
    return 'data:audio/mpeg;base64,'+base64.b64encode(raw).decode('ascii')

def select(genres,decades,limit,root=LIBRARY_ROOT):
    try:
        with sqlite3.connect(Path(root)/'library.sqlite3') as db:
            db.row_factory=sqlite3.Row
            rows=db.execute('''SELECT c.spotify_uri AS catalog_id,c.title,c.artist,c.genres_json,
                c.decades_json,c.rank,c.spotify_uri,c.sha256,r.extension
                FROM tunerush_playable_catalog c JOIN recordings r ON r.sha256=c.sha256
                WHERE r.extension='.mp3' ORDER BY c.playlist,c.position,c.spotify_uri''').fetchall()
    except sqlite3.OperationalError as err:
        raise ValueError('No cached music has been imported on the S21 yet.') from err
    pool={}
    for row in rows:
        tags=json.loads(row['genres_json']);eras=json.loads(row['decades_json'])
        path=Path(root)/'tracks'/(row['sha256']+'.mp3')
        if not path.is_file() or path.is_symlink():continue
        entry=pool.setdefault(row['sha256'],{
            'id':row['catalog_id'],'title':row['title'],'artist':row['artist'],
            'sha256':row['sha256'],'rank':row['rank'],'spotifyUri':row['spotify_uri'],
            'genres':tags,'decades':eras,'source':'persistent-library'})
        # Album and single listings can refer to the very same recording.
        # Retain every catalog row, but play these bytes only once per game.
        entry['genres']=sorted(set(entry['genres'])|set(tags))
        entry['decades']=sorted(set(entry['decades'])|set(eras))
    pool={sha:t for sha,t in pool.items() if any(g in t['genres'] for g in genres)
          and (not decades or any(d in t['decades'] for d in decades))}
    if len(pool)<limit:raise ValueError(f'Found {len(pool)} cached songs for this mix; choose more genres, All eras or fewer rounds.')
    return list(pool.values())

def availability(root=LIBRARY_ROOT):
    try:
        with sqlite3.connect(Path(root)/'library.sqlite3') as db:
            total,ready,unique=db.execute('SELECT COUNT(*),COUNT(sha256),COUNT(DISTINCT sha256) FROM tunerush_playable_catalog').fetchone()
        return {'playlistCatalogSongs':total,'playableCachedSongs':ready,'uniquePlayableRecordings':unique,'missingCachedSongs':total-ready}
    except sqlite3.OperationalError:
        return {'playlistCatalogSongs':0,'playableCachedSongs':0,'uniquePlayableRecordings':0,'missingCachedSongs':0}

def choose(pool,used,root=LIBRARY_ROOT):
    used_hashes={t['sha256'] for t in pool if t['id'] in used}
    candidates=list({t['sha256']:t for t in pool if t['id'] not in used
                     and t['sha256'] not in used_hashes}.values())
    if not candidates:raise ValueError('No unused cached songs remain.')
    song=random.choice(candidates)
    info=inspect_mp3(Path(root)/'tracks'/(song['sha256']+'.mp3'))
    max_cue=max(1,min(int(info['duration']*1000)-22000,int(info['duration']*650)))
    minimum=min(10000,max_cue//3)
    cue=minimum+secrets.randbelow(max(1,max_cue-minimum))
    return dict(song),cue
