#!/usr/bin/env python3
"""Object Stories: loopback-only shared demo, Python 3.8+, no dependencies."""
import argparse
import cgi
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import uuid
from theater import compose_lines
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('OBJECT_STORIES_DATA', str(ROOT / 'data')))
MAX_UPLOAD = 20 * 1024 * 1024
USERS = [{'id': 'a', 'name': '小满', 'color': '#e6a64d'},
         {'id': 'b', 'name': '小北', 'color': '#9c9ee5'},
         {'id': 'c', 'name': '阿栗', 'color': '#8ebaa3'}]
USER_IDS = {u['id'] for u in USERS}
KINDS = {'mug', 'keyboard', 'plant', 'other'}
OBJECT_LABELS = {'mug': '杯子', 'keyboard': '键盘', 'plant': '植物', 'other': '其他物品'}

class ConflictError(ValueError):
    status = 409

def object_kind(value):
    for kind, pattern in [('mug', r'杯|保温壶|\b(cup|mug|thermos)\b'), ('keyboard', r'键盘|\bkeyboard\b'), ('plant', r'植物|盆栽|绿萝|多肉|花盆|\b(plant|succulent)\b')]:
        if re.search(pattern, value, re.I):
            return kind
    return 'other'

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds')

def uid():
    return uuid.uuid4().hex

@contextlib.contextmanager
def database():
    conn = sqlite3.connect(str(DATA / 'stories.db'), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    try:
        with conn:
            yield conn
    finally:
        conn.close()

def init_db(seed=True):
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / 'media').mkdir(exist_ok=True)
    with database() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS objects (
          id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
          kind TEXT NOT NULL, personality TEXT NOT NULL, media_id TEXT,
          created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS media (
          id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL,
          size INTEGER NOT NULL, author_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY, object_id TEXT NOT NULL REFERENCES objects(id),
          author_id TEXT NOT NULL, text TEXT NOT NULL, tagged_user_id TEXT,
          status TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'story',
          response TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
          responded_at TEXT);
        CREATE TABLE IF NOT EXISTS scenes (
          id TEXT PRIMARY KEY, author_id TEXT NOT NULL, topic TEXT NOT NULL,
          payload TEXT NOT NULL, created_at TEXT NOT NULL);
        """)
        obj_columns = {row['name'] for row in db.execute('PRAGMA table_info(objects)')}
        if 'object_type' not in obj_columns:
            db.execute("ALTER TABLE objects ADD COLUMN object_type TEXT NOT NULL DEFAULT ''")
        if 'pixel_media_id' not in obj_columns:
            db.execute('ALTER TABLE objects ADD COLUMN pixel_media_id TEXT')
        if 'revision' not in {row['name'] for row in db.execute('PRAGMA table_info(memories)')}:
            db.execute('ALTER TABLE memories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')
        media_columns = {row['name'] for row in db.execute('PRAGMA table_info(media)')}
        for column in ('upload_id', 'sha256'):
            if column not in media_columns:
                db.execute('ALTER TABLE media ADD COLUMN %s TEXT' % column)
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS media_upload_id ON media(author_id, upload_id)')
        if seed and not db.execute('SELECT 1 FROM objects LIMIT 1').fetchone():
            for item in [('cup', 'a', '老朋友', 'mug', '嘴硬心软，重感情，偶尔吃醋'),
                         ('keys', 'a', '打工搭子', 'keyboard', '一本正经地吐槽，关心大家下班'),
                         ('leaf', 'b', '慢半拍', 'plant', '慢悠悠的乐天派，总能发现小确幸')]:
                db.execute('INSERT INTO objects (id,owner_id,name,kind,personality,media_id,created_at) VALUES (?,?,?,?,?,NULL,?)', (*item, now()))
            for oid, author, text, tag, status, kind in [
                ('cup', 'a', '这个杯子是小北在毕业那年送我的，我一直用到现在。', 'b', 'pending', 'gift'),
                ('cup', 'a', '我答应这周带它一起去公园晒太阳。', None, 'recorded', 'promise'),
                ('keys', 'a', '昨天我说最后改一个字，结果又敲了两个小时。', None, 'recorded', 'story'),
                ('leaf', 'b', '上周终于长出了一片新叶子，小满给它拍了合照。', 'a', 'pending', 'story')]:
                db.execute('INSERT INTO memories (id,object_id,author_id,text,tagged_user_id,status,kind,response,created_at,responded_at) VALUES (?,?,?,?,?,?,?,\'\',?,NULL)',
                           (uid(), oid, author, text, tag, status, kind, now()))

def clean(data, key, maxlen=600, required=False):
    value = data.get(key, '')
    if not isinstance(value, str):
        raise ValueError('请输入文字')
    value = value.strip()
    if required and not value:
        raise ValueError('请填写' + {'name': '物品名字', 'text': '这段记忆'}.get(key, key))
    if len(value) > maxlen:
        raise ValueError('内容太长，请控制在 %d 字以内' % maxlen)
    return value

def tag_from(data, actor):
    tag = data.get('tagged_user_id') or None
    if tag is not None and tag not in USER_IDS:
        raise ValueError('请选择小屋里的人')
    if tag == actor:
        raise ValueError('这段已经记在你的名下，可以标注另一位朋友')
    return tag

def current_state(actor):
    with database() as db:
        objects = [dict(r) for r in db.execute('SELECT * FROM objects ORDER BY created_at, id')]
        memories = [dict(r) for r in db.execute('SELECT * FROM memories ORDER BY created_at DESC, id DESC')]
        for item in objects:
            item['object_type'] = item.get('object_type') or OBJECT_LABELS.get(item['kind'], '其他物品')
            media = db.execute('SELECT mime FROM media WHERE id=?', (item['media_id'],)).fetchone()
            item['media_url'] = '/media/' + item['media_id'] if media else None
            item['media_type'] = media['mime'] if media else None
            pmedia = db.execute('SELECT mime FROM media WHERE id=?', (item.get('pixel_media_id'),)).fetchone() if item.get('pixel_media_id') else None
            item['pixel_media_url'] = '/media/' + item['pixel_media_id'] if pmedia else None
        recent = db.execute('SELECT * FROM scenes ORDER BY created_at DESC LIMIT 1').fetchone()
    return {'users': USERS, 'current_user_id': actor, 'objects': objects, 'memories': memories,
            'latest_scene': json.loads(recent['payload']) if recent else None,
            'mode': 'rules', 'shared_space': '我们的记忆小屋'}

def create_object(data, actor):
    name = clean(data, 'name', 30, True)
    object_type = clean(data, 'object_type', 40, 'object_type' in data)
    kind = object_kind(object_type) if object_type else data.get('kind', 'other')
    if kind not in KINDS:
        raise ValueError('不支持的物品类型')
    personality = clean(data, 'personality', 100) or '有点好奇，嘴硬心软'
    text = clean(data, 'text', 600)
    tag = tag_from(data, actor)
    if tag and not text:
        raise ValueError('标注朋友时，请写下你们的故事')
    mid = data.get('media_id') or None
    pmid = data.get('pixel_media_id') or None
    oid = uid()
    with database() as db:
        if mid and not db.execute('SELECT 1 FROM media WHERE id=? AND author_id=?', (mid, actor)).fetchone():
            raise ValueError('请重新上传自己的照片或视频')
        if pmid and not db.execute("SELECT 1 FROM media WHERE id=? AND author_id=? AND mime LIKE 'image/%'", (pmid, actor)).fetchone():
            raise ValueError('像素形象文件无效，请重新选择图片')
        db.execute('INSERT INTO objects (id,owner_id,name,kind,personality,media_id,pixel_media_id,created_at,object_type) VALUES (?,?,?,?,?,?,?,?,?)', (oid, actor, name, kind, personality, mid, pmid, now(), object_type or OBJECT_LABELS[kind]))
        if text:
            memory_kind = 'gift' if data.get('is_gift') and tag else 'story'
            db.execute('INSERT INTO memories (id,object_id,author_id,text,tagged_user_id,status,kind,response,created_at,responded_at) VALUES (?,?,?,?,?,?,?,\'\',?,NULL)',
                       (uid(), oid, actor, text, tag, 'pending' if tag else 'recorded', memory_kind, now()))
    return {'id': oid}

def add_memory(data, actor):
    oid = clean(data, 'object_id', 40, True)
    text = clean(data, 'text', 600, True)
    tag = tag_from(data, actor)
    kind = data.get('kind', 'story')
    if kind not in {'story', 'promise', 'gift'}:
        raise ValueError('不支持的记忆类型')
    if kind == 'gift' and not tag:
        raise ValueError('赠送记忆需要标注赠送者')
    mid = uid()
    with database() as db:
        if not db.execute('SELECT 1 FROM objects WHERE id=?', (oid,)).fetchone():
            raise ValueError('这件物品不存在')
        db.execute('INSERT INTO memories (id,object_id,author_id,text,tagged_user_id,status,kind,response,created_at,responded_at) VALUES (?,?,?,?,?,?,?,\'\',?,NULL)',
                   (mid, oid, actor, text, tag, 'pending' if tag else 'recorded', kind, now()))
    return {'id': mid}

def respond_memory(mid, data, actor):
    action = data.get('action')
    if action not in {'confirm', 'decline'}:
        raise ValueError('请选择确认或暂不认同')
    response = clean(data, 'response', 600)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        mem = db.execute('SELECT * FROM memories WHERE id=?', (mid,)).fetchone()
        if not mem:
            raise ValueError('这段记忆不存在')
        if mem['tagged_user_id'] != actor:
            raise PermissionError('只有被标注的人可以回应')
        if type(data.get('expected_revision')) is not int or data['expected_revision'] != mem['revision']:
            raise ConflictError('这段记忆已更新，请关闭弹窗，重新阅读最新内容后再回应')
        if mem['status'] != 'pending':
            raise ValueError('这段记忆已经回应过了')
        db.execute('UPDATE memories SET status=?,response=?,responded_at=? WHERE id=?',
                   ('confirmed' if action == 'confirm' else 'declined', response, now(), mid))
        db.execute('DELETE FROM scenes')
    return {'ok': True}

def edit_memory(mid, data, actor):
    text = clean(data, 'text', 600, True)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        mem = db.execute('SELECT * FROM memories WHERE id=?', (mid,)).fetchone()
        if not mem:
            raise ValueError('这段记忆不存在')
        if mem['author_id'] != actor:
            raise PermissionError('只有记录者可以修改')
        db.execute('UPDATE memories SET text=?,status=?,response=\'\',responded_at=NULL,revision=revision+1 WHERE id=?',
                   (text, 'pending' if mem['tagged_user_id'] else 'recorded', mid))
        db.execute('DELETE FROM scenes')
    return {'ok': True}

def forget_memory(mid, actor):
    with database() as db:
        mem = db.execute('SELECT * FROM memories WHERE id=?', (mid,)).fetchone()
        if not mem:
            raise ValueError('这段记忆不存在')
        if mem['author_id'] != actor:
            raise PermissionError('只有记录者可以让物品忘记这段记忆')
        db.execute('DELETE FROM memories WHERE id=?', (mid,))
        # Remove saved scenes that may quote the forgotten or subsequently edited memory.
        db.execute('DELETE FROM scenes')
    return {'ok': True}

def make_scene(data, actor):
    topic = clean(data, 'topic', 80) or '今天有什么想对我们说的？'
    state = current_state(actor)
    selected = data.get('object_ids')
    if not isinstance(selected, list) or not 1 <= len(selected) <= 3 or any(not isinstance(x, str) for x in selected):
        raise ValueError('请选择一到三件物品')
    if len(set(selected)) != len(selected):
        raise ValueError('请不要重复选择物品')
    actors = [o for o in state['objects'] if o['id'] in selected]
    if len(actors) != len(selected):
        raise ValueError('有物品已经不存在')
    lines = compose_lines(state, selected, topic, USERS)
    used = [mid for line in lines for mid in line['memory_ids']]
    payload = {'id': uid(), 'topic': topic, 'mode': 'rules', 'lines': lines,
               'memory_ids': list(dict.fromkeys(used)), 'created_at': now()}
    with database() as db:
        db.execute('INSERT INTO scenes VALUES (?,?,?,?,?)', (payload['id'], actor, topic, json.dumps(payload, ensure_ascii=False), now()))
    return payload

def persist_upload(raw, mime, filename, actor, upload_id=None):
    if upload_id is not None and (not isinstance(upload_id, str) or not re.fullmatch('[a-f0-9]{32}', upload_id)):
        raise ValueError('上传标识无效，请重新选择文件')
    upload_id = upload_id or uid()
    digest = hashlib.sha256(raw).hexdigest()
    mid = hashlib.sha256(('%s:%s:%s' % (actor, upload_id, digest)).encode()).hexdigest()[:32]
    target = DATA / 'media' / mid
    wrote_file = False
    try:
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM media WHERE author_id=? AND upload_id=?', (actor, upload_id)).fetchone()
            if previous:
                if previous['sha256'] != digest:
                    raise ConflictError('这个上传标识已经用于另一份文件，请重新选择文件')
                return {'id': previous['id'], 'url': '/media/' + previous['id'], 'mime': previous['mime']}
            if db.execute('SELECT COUNT(*) FROM media').fetchone()[0] >= 30:
                raise ValueError('演示小屋最多保存 30 份素材')
            target.write_bytes(raw)
            wrote_file = True
            db.execute('INSERT INTO media (id,filename,mime,size,author_id,upload_id,sha256) VALUES (?,?,?,?,?,?,?)',
                       (mid, Path(filename or 'upload').name[:160], mime, len(raw), actor, upload_id, digest))
    except Exception:
        if wrote_file:
            target.unlink()
        raise
    return {'id': mid, 'url': '/media/' + mid, 'mime': mime}


class Handler(BaseHTTPRequestHandler):
    server_version = 'ObjectStories/0.1'

    def send_json(self, code, data, extra=None):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def actor(self):
        jar = cookies.SimpleCookie()
        jar.load(self.headers.get('Cookie', ''))
        val = self.headers.get('X-Demo-User') or (jar['demo_user'].value if 'demo_user' in jar else 'a')
        if val not in USER_IDS:
            raise PermissionError('请选择有效的演示身份')
        return val

    def body_json(self):
        size = int(self.headers.get('Content-Length', 0))
        if not 0 < size <= 8192:
            raise ValueError('请求内容为空或过大')
        result = json.loads(self.rfile.read(size))
        if not isinstance(result, dict):
            raise ValueError('请求格式不正确')
        return result

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        try:
            if path == '/api/state':
                self.send_json(200, current_state(self.actor()))
                return
            if path == '/api/health':
                self.send_json(200, {'ok': True, 'mode': 'rules', 'storage': 'sqlite'})
                return
            if path.startswith('/media/'):
                mid = path[7:]
                if not re.fullmatch('[a-f0-9]{32}', mid):
                    self.send_error(404)
                    return
                with database() as db:
                    record = db.execute('SELECT * FROM media WHERE id=?', (mid,)).fetchone()
                if not record:
                    self.send_error(404)
                    return
                target = DATA / 'media' / mid
                mime = record['mime']
            else:
                target = (ROOT / 'web' / ('index.html' if path == '/' else path.lstrip('/'))).resolve()
                if ROOT / 'web' not in target.parents or not target.is_file():
                    self.send_error(404)
                    return
                mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                        '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon'}.get(target.suffix, 'application/octet-stream')
            size = target.stat().st_size
            start, end, status = 0, size - 1, 200
            range_header = self.headers.get('Range', '')
            if path.startswith('/media/') and range_header:
                match = re.fullmatch(r'bytes=(\d+)-(\d*)', range_header)
                if not match or int(match[1]) >= size:
                    self.send_response(416)
                    self.send_header('Content-Range', 'bytes */%d' % size)
                    self.end_headers()
                    return
                start = int(match[1]); end = min(int(match[2]) if match[2] else end, end)
                if end < start:
                    self.send_error(416)
                    return
                status = 206
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Length', str(end - start + 1))
            self.send_header('Accept-Ranges', 'bytes')
            if status == 206:
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
            if not path.startswith('/media/'):
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
            self.end_headers()
            with target.open('rb') as stream:
                stream.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = stream.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (ValueError, PermissionError) as exc:
            self.send_json(403 if isinstance(exc, PermissionError) else 400, {'error': str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        try:
            origin = self.headers.get('Origin')
            if origin and origin != 'http://' + self.headers.get('Host', ''):
                raise PermissionError('请从小屋页面提交')
            path = urlsplit(self.path).path
            actor = self.actor()
            if path == '/api/uploads':
                self.upload(actor)
                return
            data = self.body_json()
            if path == '/api/session':
                user = data.get('user_id')
                if user not in USER_IDS:
                    raise ValueError('请选择有效的演示身份')
                self.send_json(200, {'ok': True}, {'Set-Cookie': 'demo_user=%s; Path=/; SameSite=Strict; HttpOnly' % user})
                return
            if path == '/api/objects':
                result = create_object(data, actor)
            elif path == '/api/memories':
                result = add_memory(data, actor)
            elif re.fullmatch('/api/memories/[a-f0-9]{32}/respond', path):
                result = respond_memory(path.split('/')[3], data, actor)
            elif re.fullmatch('/api/memories/[a-f0-9]{32}/edit', path):
                result = edit_memory(path.split('/')[3], data, actor)
            elif re.fullmatch('/api/memories/[a-f0-9]{32}/forget', path):
                result = forget_memory(path.split('/')[3], actor)
            elif path == '/api/scenes':
                result = make_scene(data, actor)
            else:
                self.send_json(404, {'error': '找不到这个入口'})
                return
            self.send_json(200, result)
        except ConflictError as exc:
            self.send_json(409, {'error': str(exc)})
        except PermissionError as exc:
            self.send_json(403, {'error': str(exc)})
        except (ValueError, KeyError, TypeError) as exc:
            self.send_json(400, {'error': str(exc)})
        except Exception:
            self.log_error('request failed')
            self.send_json(500, {'error': '小屋暂时没接上，请重试；刚才的输入可以继续保留'})

    def upload(self, actor):
        size = int(self.headers.get('Content-Length', 0))
        if not 0 < size <= MAX_UPLOAD + 65536:
            raise ValueError('照片或视频请控制在 20 MB 以内')
        if not self.headers.get('Content-Type', '').startswith('multipart/form-data;'):
            raise ValueError('请选择一个照片或视频文件')
        form = cgi.FieldStorage(fp=self.rfile, headers=self.headers,
                                environ={'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': self.headers['Content-Type'],
                                         'CONTENT_LENGTH': str(size)}, keep_blank_values=True)
        if 'file' not in form or isinstance(form['file'], list):
            raise ValueError('请选择一个文件')
        file = form['file']
        raw = file.file.read(MAX_UPLOAD + 1)
        if not raw or len(raw) > MAX_UPLOAD:
            raise ValueError('文件为空或超过 20 MB')
        # Derive allowed media type from magic bytes; never serve user-supplied HTML/SVG.
        mime = None
        if raw.startswith(b'\xff\xd8\xff'):
            mime = 'image/jpeg'
        elif raw.startswith(b'\x89PNG\r\n\x1a\n'):
            mime = 'image/png'
        elif raw[:6] in (b'GIF87a', b'GIF89a'):
            mime = 'image/gif'
        elif raw.startswith(b'RIFF') and raw[8:12] == b'WEBP':
            mime = 'image/webp'
        elif raw.startswith(b'\x1aE\xdf\xa3'):
            mime = 'video/webm'
        elif len(raw) >= 12 and raw[4:8] == b'ftyp':
            brands = raw[8:32]
            if any(x in brands for x in (b'heic', b'heix', b'avif', b'mif1')):
                raise ValueError('这张照片请先转成 JPG 或 PNG')
            mime = 'video/quicktime' if raw[8:12] == b'qt  ' else 'video/mp4'
        if not mime:
            raise ValueError('支持 JPG、PNG、GIF、WebP 图片，以及 MP4、WebM、MOV 视频')
        self.send_json(200, persist_upload(raw, mime, file.filename, actor, form.getfirst('upload_id')))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=18765)
    args = parser.parse_args()
    init_db()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print('Object Stories: http://127.0.0.1:%d (demo identities, rules theater)' % args.port, flush=True)
    server.serve_forever()
