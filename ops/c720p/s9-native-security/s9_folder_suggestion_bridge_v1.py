"""Authenticated, appearance-only folder review bridge. No media writes.

Native SHA manifests bind the existing crop index to originals. Playback must
serve real original bytes, then independently verify the original SHA before an
opened ticket is issued. Historical reviews without decision-time media binding
are exclusions only. Private appearance vectors are never returned over HTTP.
"""
from __future__ import annotations
import base64
import contextlib
import datetime as dt
import fcntl
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import sqlite3
import subprocess
import tarfile
import tempfile
import threading
import time
from urllib.parse import urlsplit, parse_qs

import folder_suggestion_api as api
from folder_suggestion_engine import ClipFeatures, ReviewJournal, VECTOR_ONLY

BASE = Path('/home/jespern/c720p-home-hub')
STATE = BASE / 'state'
PREFIX = '/new/api/folder-suggestions'
PHONE = '192.168.178.250:5555'
REMOTE = '/data/local/tmp/s9_worker/features'
SDROOT = '/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K'
HEX = re.compile(r'[a-f0-9]{64}\Z')
CLIP = re.compile(r'motion_[0-9]{13}[.]mp4\Z')
SESSION = re.compile(r'[a-f0-9]{48,64}\Z')
INTENT = 'human-folder-suggestions-v1'


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def read_json(path, limit=6_000_000):
    if path.is_symlink() or not path.is_file() or not 1 <= path.stat().st_size <= limit:
        raise ValueError('trusted_index_unavailable:' + path.name)
    raw = path.read_bytes()
    if len(raw) > limit:
        raise ValueError('index_size_limit')
    return json.loads(raw)


def atomic(path, value):
    raw = canonical(value)
    if len(raw) > 2_000_000:
        raise ValueError('metadata_size_limit')
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.folder-bridge-')
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(tmp, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


class Bridge:
    def __init__(self, state=STATE, phone_run=None, original_attestor=None):
        self.state = Path(state)
        self.local = threading.local()
        self.lock = threading.RLock()
        self.phone_run = phone_run or self._phone
        if original_attestor is None:
            from s9_manual_original_byte_attestor_v252 import IndependentOriginalAttestor
            original_attestor = IndependentOriginalAttestor()
        self.original_attestor = original_attestor
        self.journal = ReviewJournal(self.state / 'folder-suggestion-reviews-v1.json')
        self.key_path = self.state / 'folder-suggestion-ticket-key-v1'
        self.feature_cache = None
        self.opened = {}

    def _phone(self, arguments, timeout=15):
        result = subprocess.run(['adb', '-s', PHONE, 'exec-out'] + arguments,
                                capture_output=True, timeout=timeout)
        if result.returncode and b'not found' in result.stderr:
            subprocess.run(['adb', 'connect', PHONE], capture_output=True, timeout=8)
            result = subprocess.run(['adb', '-s', PHONE, 'exec-out'] + arguments,
                                    capture_output=True, timeout=timeout)
        if result.returncode or len(result.stdout) > 4_000_000:
            raise ValueError('phone_feature_index_unavailable')
        return result.stdout

    def key(self):
        # Separate private key; never read or disclose existing administrator keys.
        try:
            fd = os.open(self.key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(secrets.token_bytes(32)); stream.flush(); os.fsync(stream.fileno())
        if self.key_path.is_symlink() or self.key_path.stat().st_mode & 0o077:
            raise ValueError('unsafe_ticket_key')
        key = self.key_path.read_bytes()
        if len(key) != 32: raise ValueError('invalid_ticket_key')
        return key

    def sign(self, payload):
        raw = base64.urlsafe_b64encode(canonical(payload)).decode().rstrip('=')
        signature = hmac.new(self.key(), raw.encode(), hashlib.sha256).hexdigest()
        return raw + '.' + signature

    def verify(self, ticket, purpose):
        if not isinstance(ticket, str) or not 20 < len(ticket) <= 8192:
            raise ValueError('invalid_opened_ticket')
        raw, signature = ticket.split('.', 1)
        expected = hmac.new(self.key(), raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected): raise ValueError('invalid_ticket_signature')
        payload = json.loads(base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4)))
        now = int(time.time())
        if (payload.get('purpose') != purpose or type(payload.get('exp')) is not int
                or type(payload.get('iat')) is not int or not payload['iat'] <= now <= payload['exp']
                or payload['exp'] - payload['iat'] != 300):
            raise ValueError('expired_or_invalid_ticket')
        return payload

    def review_state(self):
        manual = read_json(self.state / 's9-manual-recording-links-v1.json', 500_000)
        if (manual.get('version') != 1 or type(manual.get('revision')) is not int
                or not isinstance(manual.get('items'), dict)):
            raise ValueError('manual_review_index_invalid')
        database = self.state / 's9-visual-attributes-v36/review.sqlite3'
        if database.is_symlink() or not database.is_file(): raise ValueError('folder_store_unavailable')
        with contextlib.closing(sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True)) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute('BEGIN')
            folders = [dict(r) for r in conn.execute('SELECT id,label FROM folders ORDER BY id')]
            ledger = [dict(r) for r in conn.execute('SELECT folder,clip,source_sha256,decision,snapshot FROM folder_clips_v40 ORDER BY folder,clip,source_sha256')]
            skips = [r[0] for r in conn.execute('SELECT clip FROM inbox_skips_v40 ORDER BY clip')]
            db_revision = conn.execute('SELECT value FROM revision').fetchone()[0]
        archive = read_json(self.state / 's9-archive-recording-review-v32.json')
        if not isinstance(archive.get('labels'), dict): raise ValueError('archive_review_index_invalid')
        closed = {'sd:' + name for name in skips}
        closed.update('sd:' + row['clip'] for row in ledger if row['decision'] in ('approved', 'rejected'))
        closed.update(k for k, row in archive['labels'].items()
                      if isinstance(row, dict) and row.get('human_confirmed') is True)
        for key, entry in manual['items'].items():
            if not isinstance(entry, dict) or key != str(entry.get('source')) + ':' + str(entry.get('name')):
                raise ValueError('manual_source_key_invalid')
            if entry.get('review_status') == 'inbox' and not entry.get('folder') and not entry.get('folders'):
                closed.discard(key)
            elif entry.get('review_status') in ('assigned', 'skipped', 'rejected') or entry.get('folder') or entry.get('folders'):
                closed.add(key)
        revision = digest([manual, folders, ledger, skips, db_revision, archive])
        return manual, folders, sorted(closed), revision

    def features(self):
        # Existing verified corpus owns source->crop->model provenance. Read only.
        from s9_multivector_appearance_api_v3 import active_snapshot, verified_map, VISUAL_SHA
        pointer = active_snapshot()
        verified_map(pointer)
        mapping = read_json(self.state / ('s9-multivector-crop-map-v3-' + pointer['corpus_id'] + '.json'))
        catalog = read_json(self.state / 's9-standalone-archive-catalog-v1.json')
        token = digest([pointer, catalog.get('snapshot_id')])
        with self.lock:
            if self.feature_cache and self.feature_cache[0] == token and time.monotonic() - self.feature_cache[1] < 60:
                return self.feature_cache[2]
            rows = mapping['rows']
            files = {}
            for row in rows:
                key = row['key']
                if not HEX.fullmatch(key): raise ValueError('invalid_feature_key')
                for suffix, field in (('-visual.json', 'visual_sidecar_sha256'), ('-hsv-v2.json', 'hsv_sidecar_sha256')):
                    files[key + suffix] = row[field]
            raw = self.phone_run(['tar', '-cf', '-', '-C', REMOTE] + sorted(files), 25)
            parsed = {}
            with tarfile.open(fileobj=io.BytesIO(raw), mode='r:') as archive:
                members = archive.getmembers()
                if len(members) != len(files): raise ValueError('incomplete_feature_sidecars')
                for member in members:
                    if member.name not in files or not member.isfile() or member.size > 60_000:
                        raise ValueError('untrusted_feature_archive')
                    data = archive.extractfile(member).read(60_001)
                    if hashlib.sha256(data).hexdigest() != files[member.name]:
                        raise ValueError('feature_sidecar_checksum_mismatch')
                    parsed[member.name] = json.loads(data)
            clips = {}
            for row in sorted(rows, key=lambda item: item['key']):
                name, key = row['clip'], row['key']
                if name in clips: continue  # One representative appearance per recording; never an identity.
                record = catalog.get('records', {}).get(name)
                if not isinstance(record, dict): continue
                manifest = record.get('manifest', {})
                sha = manifest.get('sha256', '')
                if not CLIP.fullmatch(name) or not HEX.fullmatch(sha) or manifest.get('bytes') != record.get('bytes'):
                    continue
                visual, hsv = parsed[key + '-visual.json'], parsed[key + '-hsv-v2.json']
                for evidence in (visual, hsv):
                    if (evidence.get('source_qualified_key') != key or evidence.get('crop_sha256') != row['crop_sha256']
                            or evidence.get('verified_same_person') is not False or evidence.get('human_review_required') is not True):
                        raise ValueError('feature_provenance_mismatch')
                if (visual.get('model_sha256') != VISUAL_SHA or visual.get('appearance_only') is not True
                        or hsv.get('schema') != 's9_uniform_upper_torso_hsv32_v2'):
                    raise ValueError('appearance_model_or_color_schema_mismatch')
                feature = {'source': 'sd', 'clip_id': name, 'media_sha256': sha,
                           'media_revision': 'catalog:' + str(record['version']),
                           'visual_model_id': VISUAL_SHA, 'visual_embedding': visual['visual_embedding'],
                           'structural_aligned_verified': False, 'color_histogram': hsv['upper_hsv32']}
                ClipFeatures.from_dict(feature)
                clips[name] = feature
            if not clips: raise ValueError('no_verified_appearance_features')
            result = [clips[name] for name in sorted(clips)]
            self.feature_cache = token, time.monotonic(), result
            return result

    def provider(self):
        manual, folders, historical, review_revision = self.review_state()
        clips = self.features()
        revision = digest([clips, folders, historical, review_revision])
        self.local.manual_revision = manual['revision']
        return {'clips': clips, 'folders': folders, 'historic_reviewed_keys': historical,
                'revision': revision, 'features_verified': True,
                'historic_review_index_verified': True,
                'scoring_mode': VECTOR_ONLY,
                'embedding_similarity_threshold': 0.68}

    def candidate(self, payload):
        data = self.provider()
        if payload.get('feature_snapshot_revision') != data['revision']:
            raise ValueError('feature_snapshot_changed')
        for row in data['clips']:
            if all(row.get(k) == payload.get(k) for k in ('source', 'clip_id', 'media_sha256', 'media_revision')):
                return row
        raise ValueError('original_or_feature_revision_changed')

    def current_revision(self, source, clip_id):
        try:
            return self.original_attestor.current_revision(source, clip_id)
        except RuntimeError as error:
            if source != 'sd' or str(error) != 'phone_original_unavailable': raise
            subprocess.run(['adb', 'connect', PHONE], capture_output=True, timeout=8)
            return self.original_attestor.current_revision(source, clip_id)

    def prepare_open(self, payload):
        row = self.candidate(payload)
        session = getattr(self.local, 'session', '')
        if not SESSION.fullmatch(session): raise ValueError('review_session_required')
        revision = self.current_revision(row['source'], row['clip_id'])
        now = int(time.time())
        ticket = self.sign({**{k: row[k] for k in ('source', 'clip_id', 'media_sha256', 'media_revision')},
                            'purpose': 'original_stream', 'session': session, 'nonce': secrets.token_hex(16),
                            'original_revision': revision, 'iat': now, 'exp': now + 300})
        return {'ok': True, 'challenge': ticket, 'media_path': PREFIX + '/original/' + ticket}

    def finish_open(self, challenge):
        row = self.verify(challenge, 'original_stream')
        if row['session'] != getattr(self.local, 'session', ''):
            raise ValueError('review_session_mismatch')
        with self.lock:
            if self.opened.get(row['nonce'], {}).get('bytes', 0) < 4096: raise ValueError('original_not_served')
        # Existing thermal/idle guard applies. No bypasses or fabricated SHA proof.
        self.current_revision(row['source'], row['clip_id'])
        proof = self.original_attestor.verify_bytes(row['source'], row['clip_id'])
        if (proof.get('verified_original_bytes') is not True or proof.get('sha256') != row['media_sha256']
                or {k: proof.get(k) for k in ('source_identity', 'source_revision')} != row['original_revision']):
            raise ValueError('original_bytes_changed')
        now = int(time.time())
        payload = {**row, 'purpose': 'original_opened', 'iat': now, 'exp': now + 300}
        return {'ok': True, 'verified': True, 'media_sha256': row['media_sha256'],
                'media_revision': row['media_revision'], 'opened_ticket': self.sign(payload)}

    def opened_attestor(self, ticket, source, clip_id, media_sha256, media_revision):
        try:
            row = self.verify(ticket, 'original_opened')
            if (row['session'] != getattr(self.local, 'session', '') or
                    any(row.get(k) != value for k, value in zip(
                        ('source', 'clip_id', 'media_sha256', 'media_revision'),
                        (source, clip_id, media_sha256, media_revision)))): return False
            if self.current_revision(source, clip_id) != row['original_revision']: return False
            self.local.attested = row
            return True
        except (ValueError, KeyError, TypeError, OSError, RuntimeError):
            return False

    def authoritative_commit(self, *, action, source, clip_id, folder_id, media_sha256, media_revision):
        import s9_manual_recording_links as manual
        attested = getattr(self.local, 'attested', None)
        if (action not in ('approve', 'reject') or not attested or
                any(attested.get(k) != value for k, value in zip(
                    ('source', 'clip_id', 'media_sha256', 'media_revision'),
                    (source, clip_id, media_sha256, media_revision)))):
            raise ValueError('opened_original_proof_required')
        path = self.state / 's9-manual-recording-links-v1.json'
        lock_path = self.state / 's9-manual-recording-links-v1.lock'
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            before = read_json(path, 500_000)
            if before['revision'] != getattr(self.local, 'manual_revision', None):
                raise ValueError('manual_review_changed')
            if self.current_revision(source, clip_id) != attested['original_revision']:
                raise ValueError('original_changed_before_commit')
            doc = json.loads(json.dumps(before))
            key = source + ':' + clip_id
            entry = doc['items'].setdefault(key, {'source': source, 'name': clip_id,
                                                   'folder': None, 'folders': [], 'review_status': 'inbox'})
            receipt = {'persisted': True, 'source': source, 'clip_id': clip_id,
                       'folder_id': folder_id, 'status': 'approved' if action == 'approve' else 'rejected',
                       'media_verified': True, 'human_confirmed': True,
                       'media_sha256': media_sha256, 'media_revision': media_revision,
                       'original_revision': attested['original_revision'],
                       'at': dt.datetime.now(dt.timezone.utc).isoformat()}
            entry.setdefault('folder_suggestion_reviews', {})[folder_id] = receipt
            if action == 'approve':
                selected = list(entry.get('folders') or ([entry['folder']] if entry.get('folder') else []))
                if folder_id not in selected: selected.append(folder_id)
                entry.update(folder=selected[0], folders=selected, review_status='assigned')
                entry['media_binding'] = {'schema_version': 'manual_original_digest_binding_v1',
                    'status': 'bound_at_decision', 'source': source, 'name': clip_id,
                    'sha256': media_sha256, 'source_identity': attested['original_revision']['source_identity'],
                    'source_revision': attested['original_revision']['source_revision'],
                    'verified_at_decision': True, 'verified_at_utc': receipt['at'],
                    'media_revision': media_revision}
            # Reject changes only the folder-specific receipt; never global skip/reject.
            doc['revision'] += 1
            if len(canonical(doc)) > 500_000: raise ValueError('manual_store_size_limit')
            manual.atomic(doc)
            try:
                audit_fd = os.open(manual.AUDIT, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
                with os.fdopen(audit_fd, 'ab') as audit:
                    audit.write(canonical({'action': 'folder_suggestion_' + action, 'receipt': receipt,
                                           'manual': True, 'revision': doc['revision']}) + b'\n')
                    audit.flush(); os.fsync(audit.fileno())
            except BaseException:
                manual.atomic(before)
                raise
            if read_json(path, 500_000) != doc: raise ValueError('manual_receipt_not_persisted')
            return receipt

    def reconcile_journal(self):
        """Recover a persisted receipt after interruption, and revoke removed links.

        Only decision-time byte-bound receipts are imported. Never synthesize a
        human approval from a feature-index checksum or from a historical label.
        """
        manual, folders, _, _ = self.review_state()
        valid_folders = {row['id'] for row in folders}
        doc = self.journal.read()
        changed = False
        for row in doc['decisions']:
            entry = manual['items'].get(row['source'] + ':' + row['clip_id'], {})
            removed = row['folder_id'] not in entry.get('folder_suggestion_reviews', {})
            if ((row['status'] == 'approved' and row['folder_id'] not in (entry.get('folders') or [entry.get('folder')]))
                    or (row['status'] == 'rejected' and removed)):
                if row.get('revoked') is not True: row['revoked'] = True; changed = True
        for key, entry in manual['items'].items():
            for folder, receipt in entry.get('folder_suggestion_reviews', {}).items():
                if (folder not in valid_folders or receipt.get('persisted') is not True or
                        receipt.get('media_verified') is not True or receipt.get('human_confirmed') is not True): continue
                if receipt.get('status') == 'approved' and folder not in (entry.get('folders') or [entry.get('folder')]): continue
                row = {k: receipt[k] for k in ('source', 'clip_id', 'folder_id', 'status', 'media_sha256', 'media_revision', 'human_confirmed')}
                if row['source'] + ':' + row['clip_id'] != key or not HEX.fullmatch(row['media_sha256']):
                    raise ValueError('invalid_authoritative_receipt')
                existing = next((r for r in reversed(doc['decisions']) if all(r.get(k) == row[k] for k in ('source', 'clip_id', 'folder_id'))), None)
                if existing != row:
                    doc['decisions'].append(row); changed = True
            # Existing binding at the time of approval, if any: eligible seed.
            binding = entry.get('media_binding', {})
            if (binding.get('status') == 'bound_at_decision' and binding.get('verified_at_decision') is True
                    and HEX.fullmatch(str(binding.get('sha256', ''))) and not entry.get('folder_suggestion_reviews')):
                for folder in entry.get('folders') or [entry.get('folder')]:
                    if folder not in valid_folders or entry.get('review_status') != 'assigned': continue
                    # A native revision must be explicitly saved with the approval.
                    revision = binding.get('media_revision')
                    if not revision and binding.get('source_revision'):
                        feature = next((clip for clip in self.features()
                            if clip['source'] == entry['source'] and clip['clip_id'] == entry['name']
                            and clip['media_sha256'] == binding['sha256']), None)
                        original = {k: binding.get(k) for k in ('source_identity', 'source_revision')}
                        if feature and self.current_revision(entry['source'], entry['name']) == original:
                            revision = feature['media_revision']
                    if not revision: continue
                    row = {'source': entry['source'], 'clip_id': entry['name'], 'folder_id': folder,
                           'status': 'approved', 'media_sha256': binding['sha256'],
                           'media_revision': revision, 'human_confirmed': True}
                    if row not in doc['decisions']: doc['decisions'].append(row); changed = True
        if changed:
            doc['revision'] += 1
            atomic(self.journal.path, doc)


def install(H, bridge=None):
    """Mount only on the existing authenticated handler, preserving its signature."""
    if not hasattr(H, 'authorized'): raise ValueError('authenticated_handler_required')
    bridge = bridge or Bridge()
    old_get, old_post, old_options = H.go, H.do_POST, H.do_OPTIONS
    origins = {'http://' + host + ':8123' for host in ('127.0.0.1', 'localhost', '192.168.178.141', 'jesper-hub', 'jesper-hub.local', 'homeassistant.local')}
    api.ORIGINS = api.ORIGINS | origins

    def reply(handler, code, data):
        raw = canonical(data); handler.send_response(code); handler.cors()
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Content-Length', str(len(raw)))
        handler.send_header('Cache-Control', 'private, no-store')
        handler.send_header('X-Content-Type-Options', 'nosniff'); handler.end_headers()
        if handler.command != 'HEAD': handler.wfile.write(raw)

    class Adapter:
        def __init__(self, handler): self.handler = handler; self.path = urlsplit(handler.path).path
        def __getattr__(self, name): return getattr(self.handler, name)
        def js(self, code, data): return reply(self.handler, code, data)
        def go(self): return self.js(404, {'ok': False, 'error': 'not_found'})
        def do_POST(self): return self.js(404, {'ok': False, 'error': 'not_found'})

    api.install(Adapter, bridge.provider, bridge.journal, bridge.opened_attestor, bridge.authoritative_commit)

    def serve(handler, callback):
        if not handler.authorized(): return reply(handler, 401, {'ok': False, 'error': 'authentication_required'})
        bridge.local.session = handler.headers.get('X-S9-Review-Session', '')
        bridge.local.attested = None
        try:
            with api.GUARD:
                bridge.reconcile_journal()
                return callback()
        except (OSError, ValueError, KeyError, TypeError, RuntimeError, sqlite3.Error, subprocess.SubprocessError) as error:
            # Only fixed diagnostic labels; never command output, media IDs or tokens.
            label = str(error).split(':', 1)[0]
            if not re.fullmatch(r'[a-z_]{3,80}', label): label = 'verified_review_temporarily_unavailable'
            return reply(handler, 503, {'ok': False, 'error': label, 'human_review_required': True})
        finally:
            bridge.local.attested = None; bridge.local.session = ''

    def get(handler, *args, **kwargs):
        route = urlsplit(handler.path)
        if not (route.path == PREFIX or route.path.startswith(PREFIX + '/')):
            return old_get(handler, *args, **kwargs)
        if route.path.startswith(PREFIX + '/original/'):
            def original():
                if set(parse_qs(route.query, keep_blank_values=True)) - {'auth'}:
                    raise ValueError('original_query_not_allowed')
                ticket = route.path[len(PREFIX + '/original/'):]
                evidence = bridge.verify(ticket, 'original_stream')
                if evidence['source'] != 'sd' or not CLIP.fullmatch(evidence['clip_id']): raise ValueError('unsupported_original_source')
                if bridge.current_revision('sd', evidence['clip_id']) != evidence['original_revision']:
                    raise ValueError('original_changed')
                stream = handler.wfile
                class CountWrites:
                    def __getattr__(self, name): return getattr(stream, name)
                    def write(self, data):
                        result = stream.write(data)
                        if getattr(handler, '_folder_body', False) and handler.command == 'GET':
                            with bridge.lock:
                                now = int(time.time())
                                bridge.opened = {key: value for key, value in bridge.opened.items() if value['exp'] >= now}
                                if evidence['nonce'] not in bridge.opened and len(bridge.opened) >= 512:
                                    raise ValueError('review_stream_capacity_reached')
                                observed = bridge.opened.setdefault(evidence['nonce'], {'bytes': 0, 'exp': evidence['exp']})
                                observed['bytes'] += len(data)
                        return result
                # Count body only, after successful upstream response headers.
                send_response, end_headers = handler.send_response, handler.end_headers
                status = [None]
                def response(code, *a, **kw): status[0] = code; return send_response(code, *a, **kw)
                def headers():
                    result = end_headers(); handler._folder_body = status[0] in (200, 206); return result
                old_path = handler.path
                handler.path = '/new/saved/clip/' + evidence['clip_id'] + ('?' + route.query if route.query else '')
                handler.wfile = CountWrites(); handler.send_response = response; handler.end_headers = headers
                try:
                    return old_get(handler, *args, **kwargs)
                finally:
                    handler.path = old_path
                    handler.wfile = stream; handler.send_response = send_response; handler.end_headers = end_headers
                    handler._folder_body = False
            # Do not hold the review transaction lock while streaming original media.
            if not handler.authorized(): return reply(handler, 401, {'ok': False, 'error': 'authentication_required'})
            try: return original()
            except (OSError, ValueError, KeyError, RuntimeError): return reply(handler, 409, {'ok': False, 'error': 'original_stream_unavailable'})
        if route.path != PREFIX or handler.command != 'GET': return reply(handler, 404, {'ok': False, 'error': 'not_found'})
        return serve(handler, lambda: Adapter(handler).go())

    def post(handler, *args, **kwargs):
        route = urlsplit(handler.path)
        if not (route.path == PREFIX or route.path.startswith(PREFIX + '/')): return old_post(handler, *args, **kwargs)
        def dispatch():
            if (handler.headers.get('Origin') not in api.ORIGINS or
                    handler.headers.get('X-S9-Folder-Suggestion-Intent') != INTENT or
                    handler.headers.get('Sec-Fetch-Site', '') not in ('', 'same-origin', 'none', 'same-site') or
                    not SESSION.fullmatch(bridge.local.session)):
                return reply(handler, 403, {'ok': False, 'error': 'explicit_same_origin_review_required'})
            if route.path == PREFIX + '/review': return Adapter(handler).do_POST()
            size = int(handler.headers.get('Content-Length', 0))
            if not 2 <= size <= 12000 or 'application/json' not in handler.headers.get('Content-Type', ''):
                return reply(handler, 400, {'ok': False, 'error': 'bounded_json_required'})
            data = json.loads(handler.rfile.read(size))
            if route.path == PREFIX + '/open': return reply(handler, 200, bridge.prepare_open(data))
            if route.path == PREFIX + '/opened': return reply(handler, 200, bridge.finish_open(data.get('challenge')))
            return reply(handler, 404, {'ok': False, 'error': 'not_found'})
        return serve(handler, dispatch)

    def options(handler, *args, **kwargs):
        if not urlsplit(handler.path).path.startswith(PREFIX): return old_options(handler, *args, **kwargs)
        if not handler.allowed_net() or not handler.origin_ok(): return handler.empty(403)
        handler.send_response(204); handler.cors()
        handler.send_header('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS')
        handler.send_header('Access-Control-Allow-Headers', 'Content-Type,X-C720P-Relay-Token,X-S9-Folder-Suggestion-Intent,X-S9-Review-Session,Range')
        handler.send_header('Content-Length', '0'); handler.end_headers()

    H.go, H.do_POST, H.do_OPTIONS = get, post, options
    H._folder_suggestion_bridge_v1 = bridge
    return bridge
