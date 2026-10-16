import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { dramas } from './seed.js';

const root = path.resolve(import.meta.dirname, '..');
const hash = value => createHash('sha256').update(value).digest();
export function createApp({ dataDir = path.join(root, '.runtime'), demoMode = false, adminPassword = process.env.ADMIN_PASSWORD, mediaDir = path.join(root, 'media') } = {}) {
  if (!demoMode && (!adminPassword || adminPassword.length < 16)) throw new Error('正式模式必须配置至少 16 位的 ADMIN_PASSWORD；演示请明确设置 DEMO_MODE=true。');
  const app = express();
  fs.mkdirSync(path.join(dataDir, 'uploads'), {recursive:true});
  const db = new DatabaseSync(path.join(dataDir, 'afterglow.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS dramas (id TEXT PRIMARY KEY, title TEXT, tagline TEXT, description TEXT, category TEXT, color TEXT, freeEpisodes INTEGER, badge TEXT, cover TEXT);
    CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, dramaId TEXT REFERENCES dramas(id) ON DELETE CASCADE, number INTEGER, title TEXT, file TEXT, duration REAL, UNIQUE(dramaId,number));
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, plan TEXT DEFAULT 'free', admin INTEGER DEFAULT 0, expires INTEGER);
    CREATE TABLE IF NOT EXISTS favorites (sessionId TEXT REFERENCES sessions(id) ON DELETE CASCADE, dramaId TEXT REFERENCES dramas(id) ON DELETE CASCADE, PRIMARY KEY(sessionId,dramaId));
    CREATE TABLE IF NOT EXISTS progress (sessionId TEXT REFERENCES sessions(id) ON DELETE CASCADE, dramaId TEXT REFERENCES dramas(id) ON DELETE CASCADE, episodeId TEXT REFERENCES episodes(id) ON DELETE CASCADE, seconds REAL, updated INTEGER, PRIMARY KEY(sessionId,dramaId));
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);`);
  if (!db.prepare('SELECT 1 FROM metadata WHERE key=?').get('seeded')) {
    db.exec('BEGIN');
    for (const d of dramas) {
      db.prepare('INSERT INTO dramas VALUES (?,?,?,?,?,?,?,?,?)').run(d.id,d.title,d.tagline,d.description,d.category,d.color,d.freeEpisodes,d.badge,`/assets/posters/${d.id}.svg`);
      for(let n=1;n<=d.episodes;n++) db.prepare('INSERT INTO episodes VALUES (?,?,?,?,?,?)').run(`${d.id}-${n}`,d.id,n, n===1?'A chance encounter':`Chapter ${n}`,`demo:${d.id}`,12);
    }
    db.prepare('INSERT INTO metadata VALUES (?,?)').run('seeded','1');
    db.exec('COMMIT');
  }
  db.prepare('INSERT OR IGNORE INTO settings VALUES (1,?)').run(JSON.stringify({enabled:true,seconds:5,headline:'Make time for a little escape.',sponsor:'Afterglow Studio',message:'This is a demonstration ad. No advertiser is billed and no revenue is generated.'}));
  const settings = () => JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value);
  app.disable('x-powered-by');
  app.use(helmet({contentSecurityPolicy: {directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','blob:'],mediaSrc:["'self'",'blob:'],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'self'"]}},crossOriginEmbedderPolicy:false}));
  app.use(express.json({limit:'100kb'}));
  app.use('/api', (req,res,next) => {
    res.set('Cache-Control','no-store');
    if (!['GET','HEAD'].includes(req.method)) {
      const origin=req.get('origin');
      if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({error:'Cross-origin request rejected.'});
      if (req.get('X-Requested-With')!=='Afterglow') return res.status(403).json({error:'Missing request verification header.'});
    }
    next();
  });
  app.get('/api/health', (req,res)=>res.json({ok:true,service:'afterglow',demoMode}));
  app.use(['/api','/media'], (req,res,next)=>{
    const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('afterglow_session='))?.slice(18);
    let session=token && /^[a-f0-9]{64}$/.test(token) ? db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(token,Date.now()):null;
    if (!session) {
      const id=randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions(id,expires) VALUES (?,?)').run(id,Date.now()+30*86400000);
      session=db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
      res.cookie('afterglow_session',id,{httpOnly:true,sameSite:'lax',secure:req.secure,maxAge:30*86400000,path:'/'});
    }
    req.viewer=session;
    next();
  });
  const admin = (req,res,next)=>req.viewer.admin ? next():res.status(401).json({error:'请先登录管理后台'});
  const serialize = d => ({...d,episodes:db.prepare("SELECT id,number,title,duration,(file LIKE 'demo:%') AS isDemo FROM episodes WHERE dramaId=? ORDER BY number").all(d.id).map(ep=>({...ep,isDemo:!!ep.isDemo}))});
  app.get('/api/catalog', (req,res)=>res.json(db.prepare('SELECT * FROM dramas ORDER BY rowid').all().map(serialize)));
  app.get('/api/me', (req,res)=>res.json({plan:req.viewer.plan,admin:!!req.viewer.admin,demoMode,favorites:db.prepare('SELECT dramaId FROM favorites WHERE sessionId=?').all(req.viewer.id).map(x=>x.dramaId),progress:db.prepare('SELECT dramaId,episodeId,seconds,updated FROM progress WHERE sessionId=? ORDER BY updated DESC').all(req.viewer.id),billing:{provider:'PayPal',enabled:false,status:'not_connected'}}));
  app.get('/api/settings', (req,res)=>res.json(settings()));
  app.post('/api/favorites/:id', (req,res)=>{
    if(!db.prepare('SELECT 1 FROM dramas WHERE id=?').get(req.params.id))return res.status(404).json({error:'Series not found.'});
    const existing=db.prepare('SELECT 1 FROM favorites WHERE sessionId=? AND dramaId=?').get(req.viewer.id,req.params.id);
    if(existing)db.prepare('DELETE FROM favorites WHERE sessionId=? AND dramaId=?').run(req.viewer.id,req.params.id);
    else db.prepare('INSERT INTO favorites VALUES (?,?)').run(req.viewer.id,req.params.id);
    res.json({saved:!existing});
  });
  const progressSchema=z.object({episodeId:z.string(),seconds:z.number().finite().min(0).max(86400)});
  app.post('/api/progress', (req,res)=>{
    const p=progressSchema.parse(req.body);
    const ep=db.prepare('SELECT * FROM episodes WHERE id=?').get(p.episodeId);
    if(!ep)return res.status(404).json({error:'Episode not found.'});
    const d=db.prepare('SELECT * FROM dramas WHERE id=?').get(ep.dramaId);
    if(req.viewer.plan==='free' && ep.number>d.freeEpisodes)return res.status(403).json({error:'Subscription required.'});
    db.prepare('INSERT INTO progress VALUES (?,?,?,?,?) ON CONFLICT(sessionId,dramaId) DO UPDATE SET episodeId=excluded.episodeId,seconds=excluded.seconds,updated=excluded.updated').run(req.viewer.id,ep.dramaId,ep.id,Math.min(p.seconds,ep.duration || p.seconds),Date.now());
    res.json({ok:true});
  });
  app.post('/api/demo/plan', (req,res)=>{
    if(!demoMode)return res.status(404).json({error:'Demo membership is disabled.'});
    const {plan}=z.object({plan:z.enum(['free','basic','premium'])}).parse(req.body);
    db.prepare('UPDATE sessions SET plan=? WHERE id=?').run(plan,req.viewer.id);
    res.json({plan,demo:true,charged:false});
  });
  // Billing remains closed until a real provider adapter and verified webhooks are implemented.
  app.post('/api/billing/subscribe', (req,res)=>res.status(503).json({error:'PayPal subscriptions are not connected. No payment has been taken.',code:'BILLING_NOT_CONNECTED'}));
  app.get('/api/episodes/:id/access',(req,res)=>{
    const ep=db.prepare('SELECT * FROM episodes WHERE id=?').get(req.params.id);
    if(!ep)return res.status(404).json({error:'Episode not found.'});
    const d=db.prepare('SELECT * FROM dramas WHERE id=?').get(ep.dramaId);
    const allowed=req.viewer.plan!=='free'||ep.number<=d.freeEpisodes;
    res.json({allowed,reason:allowed?null:'subscription_required',url:allowed?`/media/${ep.id}`:null,ad:allowed&&req.viewer.plan!=='premium'&&settings().enabled?settings():null});
  });
  app.get('/media/:id', (req,res)=>{
    const ep=db.prepare('SELECT * FROM episodes WHERE id=?').get(req.params.id);
    if(!ep)return res.status(404).end();
    const d=db.prepare('SELECT * FROM dramas WHERE id=?').get(ep.dramaId);
    if(req.viewer.plan==='free' && ep.number>d.freeEpisodes)return res.status(403).json({error:'Subscription required.'});
    const file=ep.file.startsWith('demo:')?path.join(mediaDir,ep.file.slice(5)+'.mp4'):path.join(dataDir,'uploads',ep.file);
    res.set('Cache-Control','private, no-store');
    res.sendFile(file,err=>{if(err&&!res.headersSent)res.status(err.statusCode||404).json({error:'Video is not available.'});});
  });
  app.use('/api/admin/login',rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false}));
  app.post('/api/admin/login', (req,res)=>{
    const {password}=z.object({password:z.string().max(256)}).parse(req.body);
    const expected=adminPassword || (demoMode?'afterglow-preview':'');
    if(!expected||!timingSafeEqual(hash(password),hash(expected)))return res.status(401).json({error:'管理密码不正确'});
    // Rotate the session token when elevating privileges.
    const id=randomBytes(32).toString('hex');
    db.exec('BEGIN');
    db.prepare('INSERT INTO sessions VALUES (?,?,1,?)').run(id,req.viewer.plan,Date.now()+8*3600000);
    db.prepare('INSERT INTO favorites SELECT ?,dramaId FROM favorites WHERE sessionId=?').run(id,req.viewer.id);
    db.prepare('INSERT INTO progress SELECT ?,dramaId,episodeId,seconds,updated FROM progress WHERE sessionId=?').run(id,req.viewer.id);
    db.prepare('DELETE FROM sessions WHERE id=?').run(req.viewer.id);
    db.exec('COMMIT');
    res.cookie('afterglow_session',id,{httpOnly:true,sameSite:'lax',secure:req.secure,maxAge:8*3600000,path:'/'});
    res.json({ok:true});
  });
  app.post('/api/admin/logout',admin,(req,res)=>{db.prepare('UPDATE sessions SET admin=0 WHERE id=?').run(req.viewer.id);res.json({ok:true});});
  app.use('/api/admin',admin);
  const dramaSchema=z.object({title:z.string().trim().min(1).max(100),tagline:z.string().max(160),description:z.string().max(2000),category:z.enum(['Romance','Drama','Thriller','Mystery']),freeEpisodes:z.number().int().min(0).max(500),badge:z.string().max(30).default('NEW SERIES')});
  app.post('/api/admin/dramas',(req,res)=>{
    const p=dramaSchema.parse(req.body),id=randomUUID();
    db.prepare('INSERT INTO dramas VALUES (?,?,?,?,?,?,?,?,?)').run(id,p.title,p.tagline,p.description,p.category,'#af8e68',p.freeEpisodes,p.badge,'/assets/posters/after-hours.svg');
    res.status(201).json(serialize(db.prepare('SELECT * FROM dramas WHERE id=?').get(id)));
  });
  app.put('/api/admin/dramas/:id',(req,res)=>{
    const p=dramaSchema.parse(req.body);
    const result=db.prepare('UPDATE dramas SET title=?,tagline=?,description=?,category=?,freeEpisodes=?,badge=? WHERE id=?').run(p.title,p.tagline,p.description,p.category,p.freeEpisodes,p.badge,req.params.id);
    if(!result.changes)return res.status(404).json({error:'短剧不存在'});
    res.json({ok:true});
  });
  app.delete('/api/admin/dramas/:id',(req,res)=>{db.prepare('DELETE FROM dramas WHERE id=?').run(req.params.id);res.json({ok:true});});
  app.put('/api/admin/settings',(req,res)=>{
    const p=z.object({enabled:z.boolean(),seconds:z.number().int().min(1).max(30),headline:z.string().min(1).max(100),sponsor:z.string().min(1).max(60),message:z.string().max(250)}).parse(req.body);
    db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(p));res.json(p);
  });
  const upload=multer({dest:path.join(dataDir,'uploads'),limits:{fileSize:250*1024*1024,files:1,fields:8}});
  function inspect(file,type) {
    const buffer=Buffer.alloc(12),fd=fs.openSync(file.path,'r');fs.readSync(fd,buffer,0,12,0);fs.closeSync(fd);
    if(type==='cover') {
      const jpg=buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
      const png=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const webp=buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
      if(!jpg&&!png&&!webp)throw new Error('仅接受有效的 JPEG、PNG 或 WebP 封面');
      if(file.size>10*1024*1024)throw new Error('封面不能超过 10 MB');
      return {ext:jpg?'.jpg':png?'.png':'.webp'};
    }
    if(buffer.toString('ascii',4,8)!=='ftyp')throw new Error('请上传 MP4 视频（H.264 / AAC）');
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file.path],{timeout:15000,maxBuffer:1024*1024}).toString());
    if(!probe.streams.some(s=>s.codec_type==='video'&&s.codec_name==='h264'))throw new Error('视频必须使用浏览器兼容的 H.264 编码');
    if(probe.streams.some(s=>s.codec_type==='audio'&&!['aac','mp3'].includes(s.codec_name)))throw new Error('音频请使用 AAC 或 MP3 编码');
    const duration=Number(probe.format.duration);
    if(!Number.isFinite(duration)||duration<=0||duration>86400)throw new Error('视频时长无效');
    return {ext:'.mp4',duration};
  }
  app.post('/api/admin/dramas/:id/cover',upload.single('file'),(req,res)=>{
    try {
      if(!req.file)throw new Error('请选择封面文件');
      if(!db.prepare('SELECT 1 FROM dramas WHERE id=?').get(req.params.id))throw new Error('短剧不存在');
      const {ext}=inspect(req.file,'cover'),name=req.file.filename+ext;
      fs.renameSync(req.file.path,path.join(dataDir,'uploads',name));
      db.prepare('UPDATE dramas SET cover=? WHERE id=?').run(`/covers/${name}`,req.params.id);
      res.json({ok:true});
    }catch(e){if(req.file)fs.rmSync(req.file.path,{force:true});res.status(400).json({error:e.message});}
  });
  app.post('/api/admin/dramas/:id/episodes',upload.single('file'),(req,res)=>{
    try {
      const p=z.object({number:z.coerce.number().int().min(1).max(500),title:z.string().trim().min(1).max(100)}).parse(req.body);
      if(!req.file)throw new Error('请选择视频文件');
      if(!db.prepare('SELECT 1 FROM dramas WHERE id=?').get(req.params.id))throw new Error('短剧不存在');
      if(db.prepare('SELECT 1 FROM episodes WHERE dramaId=? AND number=?').get(req.params.id,p.number))throw new Error('集数已存在，请先删除对应集再上传');
      const meta=inspect(req.file,'video'),name=req.file.filename+meta.ext,id=randomUUID();
      fs.renameSync(req.file.path,path.join(dataDir,'uploads',name));
      db.prepare('INSERT INTO episodes VALUES (?,?,?,?,?,?)').run(id,req.params.id,p.number,p.title,name,meta.duration);
      res.status(201).json({id});
    }catch(e){if(req.file)fs.rmSync(req.file.path,{force:true});res.status(400).json({error:e instanceof z.ZodError?'集数或标题格式不正确':e.message});}
  });
  app.delete('/api/admin/episodes/:id',(req,res)=>{db.prepare('DELETE FROM episodes WHERE id=?').run(req.params.id);res.json({ok:true});});
  app.get('/covers/:name',(req,res)=>{
    if(!/^[a-f0-9]+\.(jpg|png|webp)$/.test(req.params.name))return res.status(404).end();
    res.sendFile(path.join(dataDir,'uploads',req.params.name));
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'API route not found.'}));
  app.use((err,req,res,next)=>{
    if(res.headersSent)return next(err);
    res.status(err instanceof z.ZodError?400:err instanceof multer.MulterError?400:500).json({error:err instanceof z.ZodError?'Invalid input. Please check your entries.':err instanceof multer.MulterError?'上传失败：文件过大或格式不正确':'Unexpected server error.'});
  });
  return {app,db};
}
