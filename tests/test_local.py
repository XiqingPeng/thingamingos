import tempfile
import unittest
import io
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import app

class MemoryContract(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.old=app.DATA;app.DATA=Path(self.temp.name);app.init_db()
    def tearDown(self):
        app.DATA=self.old;self.temp.cleanup()
    def test_multiuser_confirm_persist_and_quote(self):
        state=app.current_state('a');gift=next(m for m in state['memories'] if m['kind']=='gift')
        with self.assertRaises(PermissionError):app.respond_memory(gift['id'],{'expected_revision':1,'action':'confirm'},'c')
        app.respond_memory(gift['id'],{'expected_revision':1,'action':'confirm','response':'我希望它陪你很久'},'b')
        app.init_db();state=app.current_state('a');m=next(m for m in state['memories'] if m['id']==gift['id']);self.assertEqual(m['status'],'confirmed')
        scene=app.make_scene({'object_ids':['cup']},'a');self.assertIn('我希望它陪你很久',scene['lines'][0]['text']);self.assertIn(gift['id'],scene['memory_ids'])
        app.edit_memory(gift['id'],{'text':'更新了礼物的故事'},'a');self.assertIsNone(app.current_state('a')['latest_scene'])
        m=next(m for m in app.current_state('b')['memories'] if m['id']==gift['id']);self.assertEqual(m['status'],'pending')
    def test_decline_and_forget_stop_future_quotes(self):
        gift=next(m for m in app.current_state('a')['memories'] if m['kind']=='gift')
        app.respond_memory(gift['id'],{'expected_revision':1,'action':'decline'},'b');self.assertNotIn(gift['id'],app.make_scene({'object_ids':['cup']},'a')['memory_ids'])
        app.forget_memory(gift['id'],'a');self.assertIsNone(app.current_state('a')['latest_scene'])
    def test_new_gift_object_requires_real_tag_and_story(self):
        with self.assertRaises(ValueError):app.create_object({'name':'x','tagged_user_id':'b'},'a')
        new=app.create_object({'name':'生日杯','kind':'mug','text':'小北送的礼物','tagged_user_id':'b','is_gift':True},'a')
        m=next(m for m in app.current_state('b')['memories'] if m['object_id']==new['id']);self.assertEqual(m['status'],'pending');self.assertEqual(m['kind'],'gift')

    def test_free_text_object_type_persists_and_old_objects_still_work(self):
        obj=app.create_object({'name':'旅行搭子','object_type':'拍立得相机'},'a')
        app.init_db()
        state=app.current_state('a')
        saved=next(o for o in state['objects'] if o['id']==obj['id'])
        self.assertEqual(saved['object_type'],'拍立得相机')
        self.assertEqual(saved['kind'],'other')
        self.assertEqual(next(o for o in state['objects'] if o['id']=='keys')['object_type'],'键盘')
        with self.assertRaises(ValueError):app.create_object({'name':'x','object_type':' '},'a')

    def test_stale_response_is_rejected_until_latest_revision_is_read(self):
        gift=next(m for m in app.current_state('b')['memories'] if m['kind']=='gift')
        self.assertEqual(gift['revision'],1)
        for revision in [None,'1',True,0,1.5]:
            with self.assertRaises(app.ConflictError):
                app.respond_memory(gift['id'],{'action':'confirm','expected_revision':revision},'b')
        app.edit_memory(gift['id'],{'text':'生日礼物的新版本'},'a')
        for action in ['confirm','decline']:
            with self.assertRaises(app.ConflictError):
                app.respond_memory(gift['id'],{'action':action,'expected_revision':gift['revision'],'response':'旧回应'},'b')
        latest=next(m for m in app.current_state('b')['memories'] if m['id']==gift['id'])
        self.assertEqual((latest['revision'],latest['status'],latest['response']),(2,'pending',''))
        app.respond_memory(gift['id'],{'action':'confirm','expected_revision':latest['revision'],'response':'读过新版'},'b')
        scene=app.make_scene({'object_ids':['cup'],'topic':'生日礼物'},'a')
        self.assertIn('读过新版',scene['lines'][0]['text']);self.assertEqual(scene['memory_ids'],[gift['id']])
        app.edit_memory(gift['id'],{'text':latest['text']},'a')
        self.assertEqual(next(m for m in app.current_state('b')['memories'] if m['id']==gift['id'])['revision'],3)

    def test_edit_and_confirmation_serialize_without_confirming_unseen_content(self):
        gift=next(m for m in app.current_state('b')['memories'] if m['kind']=='gift')
        with ThreadPoolExecutor(max_workers=2) as pool:
            edit=pool.submit(app.edit_memory,gift['id'],{'text':'刚修改的礼物内容'},'a')
            response=pool.submit(app.respond_memory,gift['id'],{'action':'confirm','expected_revision':1},'b')
            edit.result()
            try:response.result()
            except app.ConflictError:pass
        latest=next(m for m in app.current_state('b')['memories'] if m['id']==gift['id'])
        self.assertEqual((latest['revision'],latest['status'],latest['response']),(2,'pending',''))

    def test_missing_revision_maps_to_http_409(self):
        gift=next(m for m in app.current_state('b')['memories'] if m['kind']=='gift')
        handler=object.__new__(app.Handler)
        body=json.dumps({'action':'confirm'}).encode()
        handler.headers={'Content-Length':str(len(body)),'X-Demo-User':'b'}
        handler.path='/api/memories/'+gift['id']+'/respond';handler.rfile=io.BytesIO(body)
        replies=[];handler.send_json=lambda code,data:replies.append((code,data))
        handler.do_POST()
        self.assertEqual(replies[0][0],409);self.assertIn('重新阅读',replies[0][1]['error'])

    def test_legacy_database_migrates_revision_and_upload_columns_without_losing_data(self):
        app.DATA=Path(self.temp.name)/'legacy';app.DATA.mkdir()
        with sqlite3.connect(str(app.DATA/'stories.db')) as db:
            db.executescript('''
                CREATE TABLE objects(id TEXT PRIMARY KEY,owner_id TEXT,name TEXT,kind TEXT,personality TEXT,media_id TEXT,created_at TEXT);
                CREATE TABLE memories(id TEXT PRIMARY KEY,object_id TEXT,author_id TEXT,text TEXT,tagged_user_id TEXT,status TEXT,kind TEXT,response TEXT,created_at TEXT,responded_at TEXT);
                CREATE TABLE media(id TEXT PRIMARY KEY,filename TEXT,mime TEXT,size INTEGER,author_id TEXT);
            ''')
            db.execute('INSERT INTO objects VALUES (?,?,?,?,?,?,?)',('cup','a','老杯子','mug','温柔',None,'2026-11-14T02:00:00Z'))
            db.execute('INSERT INTO memories VALUES (?,?,?,?,?,?,?,?,?,?)',('legacy','cup','a','旧版礼物记忆','b','pending','gift','','2026-11-14T02:00:00Z',None))
        app.init_db(seed=False);app.init_db(seed=False)
        state=app.current_state('b');self.assertEqual(len(state['memories']),1)
        self.assertEqual((state['memories'][0]['text'],state['memories'][0]['revision']),('旧版礼物记忆',1))
        app.respond_memory('legacy',{'action':'confirm','expected_revision':1},'b')
        self.assertEqual(app.current_state('b')['memories'][0]['status'],'confirmed')

    def test_upload_retries_reuse_one_file_and_reject_changed_content(self):
        raw=b'\x89PNG\r\n\x1a\n';upload_id='a'*32
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:app.persist_upload(raw,'image/png','photo.png','a',upload_id),range(2)))
        self.assertEqual(results[0],results[1]);self.assertEqual(len(list((app.DATA/'media').iterdir())),1)
        with self.assertRaises(ValueError):app.create_object({'name':'   ','object_type':'杯子','media_id':results[0]['id']},'a')
        self.assertEqual(app.persist_upload(raw,'image/png','photo.png','a',upload_id),results[0])
        with self.assertRaises(app.ConflictError):app.persist_upload(raw+b'other','image/png','other.png','a',upload_id)
        second=app.persist_upload(raw,'image/png','photo.png','b',upload_id)
        self.assertNotEqual(second['id'],results[0]['id'])
        with app.database() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM media').fetchone()[0],2)

    def test_upload_quota_is_atomic_and_allows_existing_retry(self):
        with app.database() as db:
            for i in range(29):db.execute('INSERT INTO media (id,filename,mime,size,author_id) VALUES (?,?,?,?,?)',(str(i),'legacy','image/png',8,'a'))
        def upload(index):
            try:return app.persist_upload(b'\x89PNG\r\n\x1a\n','image/png','photo.png','a',str(index)*32)
            except ValueError:return None
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(upload,[1,2]))
        self.assertEqual(sum(result is not None for result in results),1)
        with app.database() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM media').fetchone()[0],30)
        for index,result in enumerate(results,1):
            if result:self.assertEqual(upload(index),result)

if __name__=='__main__':unittest.main()
