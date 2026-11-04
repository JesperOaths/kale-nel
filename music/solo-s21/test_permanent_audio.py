"""Offline regression checks for permanent MP3 playback and session boundaries."""
import base64,hashlib,json,os,sqlite3,tempfile
from pathlib import Path

os.environ['TUNERUSH_SOLO_DATA']=tempfile.mkdtemp(prefix='tunerush-permanent-test-')
from persistent_music_library import PersistentMusicLibrary
import permanent_audio as media
import server

assert 'Hotel California' in media.title_answers('Hotel California - 2013 Remaster')
assert 'Unholy' in media.title_answers('Unholy (feat. Kim Petras)')
assert media.title_answers("(Don't Fear) The Reaper")==["(Don't Fear) The Reaper"]

def fixture(index):
    text=('Private song '+str(index)).encode()
    frame=b'TIT2'+(len(text)+1).to_bytes(4,'big')+bytes(2)+b'\x03'+text
    size=len(frame);sync=bytes((size>>21&127,size>>14&127,size>>7&127,size&127))
    header=b'ID3\x03\x00\x00'+sync+frame
    return header+(bytes.fromhex('fffb9000')+bytes([index])*413)*6000

root=Path(os.environ['TUNERUSH_SOLO_DATA'])/'music-library-v1'
lib=PersistentMusicLibrary(root,root/'inbox')
with sqlite3.connect(lib.database) as db:
    db.execute('''CREATE TABLE tunerush_playable_catalog(spotify_uri TEXT PRIMARY KEY,
        title TEXT,artist TEXT,genres_json TEXT,decades_json TEXT,rank INTEGER,
        sha256 TEXT,duration_ms INTEGER,playlist INTEGER,position INTEGER)''')
    for i in range(7):
        data=fixture(i);sha=hashlib.sha256(data).hexdigest();path=lib.tracks/(sha+'.mp3');path.write_bytes(data)
        db.execute('INSERT INTO recordings(sha256,filename,bytes,extension,title,artist,imported_at) VALUES(?,?,?,?,?,?,0)',
            (sha,path.name,len(data),'.mp3','Private song '+str(i),'Artist '+str(i)))
        db.execute('INSERT INTO tunerush_playable_catalog VALUES(?,?,?,?,?,?,?,?,?,?)',
            ('fixture-'+str(i),'Private song '+str(i),'Artist '+str(i),json.dumps(['pop'] if i<6 else ['rock']),json.dumps(['1980']),900000,sha,156000,1,i))

assert media.availability(root)=={'playlistCatalogSongs':7,'playableCachedSongs':7,'missingCachedSongs':0}
pool=media.select(['pop'],['1980'],5,root);assert len(pool)==6
try:media.select(['rock'],[],5,root);raise AssertionError('Short pool accepted')
except ValueError:pass
used=[]
for _ in range(6):
    song,cue=media.choose(pool,used,root);assert song['id'] not in used;used.append(song['id'])
    assert 10000<=cue<110000
    for length in (500,1500,3000,5000,8000,12000,20000):
        uri=media.clue_data(song,cue,length,root)
        assert uri.startswith('data:audio/mpeg;base64,')
        data=base64.b64decode(uri.split(',',1)[1]);assert b'Private song' not in data and not data.startswith(b'ID3')
        pos=0;seconds=0
        while pos<len(data):
            h=media.frame_header(data,pos);assert h is not None;pos+=h['length'];seconds+=h['seconds']
        assert pos==len(data) and length/1000+.25<=seconds<length/1000+.28,(length,seconds)
try:media.clue_data({'sha256':'../bad'},10000,500,root);raise AssertionError('Unsafe identifier')
except ValueError:pass
try:media.clue_data(song,cue,999,root);raise AssertionError('Invalid clue length')
except ValueError:pass

server.GAME_LIBRARY=lib
created=server.new_session({'genres':['pop'],'decades':['1980'],'limit':5})
state=created['state'];token=created['token'];session=server.SESSIONS[token]
assert state['source']=='persistent-library' and state['media'].startswith('owned:')
assert 'Private song' not in json.dumps(state) and 'sha256' not in state
hashes={p.name:p.read_bytes() for p in lib.tracks.iterdir()}
state=server.operation(session,{'op':'clue','round':1,'targetStep':0},token)['state']
assert state['cueMs']==250 and state['clipAudio'].startswith('data:audio/mpeg;base64,')
assert 'Private song' not in json.dumps(state)
server.operation(session,{'op':'finish','round':1},token)
assert {p.name:p.read_bytes() for p in lib.tracks.iterdir()}==hashes
print('PASS permanent audio: genre/era filters, nonrepeating tracks, all seven bounded MP3 clues, no answer metadata, source default, permanent retention')
