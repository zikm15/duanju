import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

async function fixture(t,options={}) {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'afterglow-test-'));
  const {app,db}=createApp({dataDir,demoMode:true,...options});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let cookie='';
  const request=async(url,method='GET',body,headers={})=>{
    const res=await fetch(base+url,{method,headers:{cookie,'X-Requested-With':'Afterglow',...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    return res;
  };
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  return {request,base,db,dataDir};
}
test('catalog, cookie isolation, free and paid access including raw media and byte ranges',async t=>{
  const {request,base}=await fixture(t);
  const catalog=await (await request('/api/catalog')).json();assert.equal(catalog.length,6);assert.equal(catalog[0].episodes.length,8);assert.equal(catalog[0].episodes[0].file,undefined);
  assert.equal((await (await request('/api/me')).json()).plan,'free');
  assert.equal((await (await request('/api/episodes/after-hours-2/access')).json()).allowed,true);
  const locked=await (await request('/api/episodes/after-hours-3/access')).json();assert.equal(locked.allowed,false);assert.equal(locked.url,null);
  assert.equal((await request('/media/after-hours-3')).status,403);
  assert.equal((await request('/api/progress','POST',{episodeId:'after-hours-3',seconds:2})).status,403);
  const range=await request('/media/after-hours-1','GET',undefined,{Range:'bytes=0-99'});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);
  const badRange=await request('/media/after-hours-1','GET',undefined,{Range:'bytes=9999999999-'});assert.equal(badRange.status,416);
  await request('/api/demo/plan','POST',{plan:'basic'});
  const basic=await (await request('/api/episodes/after-hours-3/access')).json();assert.equal(basic.allowed,true);assert.equal(basic.ad.enabled,true);
  const paidMedia=await request('/media/after-hours-3');assert.equal(paidMedia.status,200);assert.match(paidMedia.headers.get('cache-control'),/no-store/);await paidMedia.arrayBuffer();
  const other=await fetch(base+'/media/after-hours-3');assert.equal(other.status,403);
  await request('/api/demo/plan','POST',{plan:'premium'});
  const premium=await (await request('/api/episodes/after-hours-3/access')).json();assert.equal(premium.allowed,true);assert.equal(premium.ad,null);
  await request('/api/demo/plan','POST',{plan:'free'});assert.equal((await request('/media/after-hours-3')).status,403);
});
test('favorites and progress persist for the browser session',async t=>{
  const {request,db}=await fixture(t);
  assert.equal((await (await request('/api/favorites/after-hours','POST')).json()).saved,true);
  await request('/api/progress','POST',{episodeId:'after-hours-1',seconds:5.5});
  const me=await (await request('/api/me')).json();assert.deepEqual(me.favorites,['after-hours']);assert.equal(me.progress[0].seconds,5.5);
  assert.equal(db.prepare('SELECT count(*) AS n FROM progress').get().n,1);
  assert.equal((await (await request('/api/favorites/after-hours','POST')).json()).saved,false);
  assert.equal((await request('/api/progress','POST',{episodeId:'after-hours-1',seconds:-1})).status,400);
  assert.equal((await request('/api/favorites/missing','POST')).status,404);
});
test('admin CRUD, free range changes, upload validation, video and cover uploads, ad configuration',async t=>{
  const {request,base,dataDir}=await fixture(t);
  const drama={title:'Test series',tagline:'A test story',description:'Original footage',category:'Drama',freeEpisodes:0,badge:'NEW'};
  assert.equal((await request('/api/admin/dramas','POST',drama)).status,401);
  assert.equal((await request('/api/admin/login','POST',{password:'wrong'})).status,401);
  assert.equal((await request('/api/admin/login','POST',{password:'afterglow-preview'})).status,200);
  const created=await (await request('/api/admin/dramas','POST',drama)).json();assert.equal(created.title,'Test series');
  const bad=new FormData();bad.append('file',new Blob(['<svg onload="alert(1)"/>'],{type:'image/svg+xml'}),'bad.svg');
  assert.equal((await request(`/api/admin/dramas/${created.id}/cover`,'POST',bad)).status,400);
  const cover=new FormData();cover.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKf0AAAAASUVORK5CYII=','base64')],{type:'image/png'}),'cover.png');
  assert.equal((await request(`/api/admin/dramas/${created.id}/cover`,'POST',cover)).status,200);
  const fake=new FormData();fake.append('number','1');fake.append('title','Invalid');fake.append('file',new Blob(['not a video'],{type:'video/mp4'}),'fake.mp4');
  assert.equal((await request(`/api/admin/dramas/${created.id}/episodes`,'POST',fake)).status,400);
  const video=new FormData();video.append('number','1');video.append('title','First chapter');video.append('file',new Blob([fs.readFileSync(new URL('../media/after-hours.mp4',import.meta.url))],{type:'video/mp4'}),'sample.mp4');
  const upload=await request(`/api/admin/dramas/${created.id}/episodes`,'POST',video);assert.equal(upload.status,201);const episode=await upload.json();
  assert.equal((await request('/media/'+episode.id)).status,403);
  assert.equal((await request(`/api/admin/dramas/${created.id}`,'PUT',{...drama,freeEpisodes:1})).status,200);
  const playable=await request('/media/'+episode.id);assert.equal(playable.status,200);await playable.arrayBuffer();
  const files=fs.readdirSync(path.join(dataDir,'uploads'));assert.equal(files.length,2);
  const rawFile=files.find(f=>f.endsWith('.mp4'));assert.equal((await fetch(base+'/covers/'+rawFile)).status,404);
  assert.equal((await request('/api/admin/settings','PUT',{enabled:false,seconds:3,headline:'Demo',sponsor:'Studio',message:'No revenue.'})).status,200);
  assert.equal((await (await request('/api/episodes/after-hours-1/access')).json()).ad,null);
  assert.equal((await request(`/api/admin/episodes/${episode.id}`,'DELETE')).status,200);
  assert.equal((await request(`/api/admin/dramas/${created.id}`,'DELETE')).status,200);
  assert.equal((await request('/api/admin/logout','POST')).status,200);
  assert.equal((await request('/api/admin/settings','PUT',{})).status,401);
});
test('payment stays closed, invalid plans and cross-origin writes are rejected',async t=>{
  const {request}=await fixture(t);
  const billing=await request('/api/billing/subscribe','POST',{plan:'premium'});assert.equal(billing.status,503);assert.equal((await billing.json()).code,'BILLING_NOT_CONNECTED');
  assert.equal((await request('/api/demo/plan','POST',{plan:'admin'})).status,400);
  assert.equal((await request('/api/demo/plan','POST',{plan:'premium'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await request('/api/demo/plan','POST',{plan:'premium'},{'X-Requested-With':''})).status,403);
});
test('production mode disables demo privileges and rejects weak admin configuration',async t=>{
  assert.throws(()=>createApp({demoMode:false,adminPassword:'short'}),/ADMIN_PASSWORD/);
  const {request}=await fixture(t,{demoMode:false,adminPassword:'test-only-strong-password-123'});
  assert.equal((await request('/api/demo/plan','POST',{plan:'premium'})).status,404);
  assert.equal((await request('/api/admin/login','POST',{password:'afterglow-preview'})).status,401);
  assert.equal((await request('/api/admin/login','POST',{password:'test-only-strong-password-123'})).status,200);
});
test('hosted preview hides the shared admin password and sets Secure cookies behind the trusted HTTPS proxy',async t=>{
  const {request}=await fixture(t,{demoMode:true,adminPassword:'test-hosted-admin-password-123',trustProxyHops:1});
  const res=await request('/api/me','GET',undefined,{'X-Forwarded-Proto':'https'});
  assert.match(res.headers.get('set-cookie'),/; Secure/);
  const me=await res.json();assert.equal(me.demoMode,true);assert.equal(me.demoAdminLogin,false);
  assert.equal((await request('/api/admin/login','POST',{password:'afterglow-preview'})).status,401);
  assert.equal((await request('/api/admin/login','POST',{password:'test-hosted-admin-password-123'})).status,200);
  assert.equal((await request('/api/demo/plan','POST',{plan:'premium'})).status,200);
});

test('community keeps notifications private, enforces comment ownership and retains profile on admin login',async t=>{
 const {request,base}=await fixture(t);const a=await(await request('/api/me')).json();let cookie='';
 const other=async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(base+url,{method,headers:{cookie,'X-Requested-With':'Afterglow','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
 const b=await(await other('/api/me')).json();assert.notEqual(a.profile.id,b.profile.id);await other('/api/profile',{nickname:'Reader two',bio:'Drama fan'},'PUT');
 await request('/api/likes/after-hours','POST');await request('/api/following/after-hours','POST');const c=await(await request('/api/comments/after-hours','POST',{body:'A real comment'})).json();assert.equal((await other('/api/comments/'+c.id,undefined,'DELETE')).status,403);
 await other('/api/comments/after-hours',{body:'A reply',replyTo:c.id});await other('/api/comments/'+c.id+'/like',{});await other('/api/people/'+a.profile.id+'/follow',{});
 const notices=await(await request('/api/inbox')).json();assert.ok(['likes','comments','follows'].every(k=>notices.some(n=>n.kind===k)));assert.ok(!(await(await other('/api/inbox')).json()).some(n=>n.kind==='likes'));
 await other('/api/inbox/read',{id:notices.find(n=>n.kind==='likes').id});assert.equal((await(await request('/api/inbox')).json()).find(n=>n.kind==='likes').read,0);await request('/api/inbox/read','POST',{});assert.equal((await(await request('/api/me')).json()).unread,0);
 await request('/api/admin/login','POST',{password:'afterglow-preview'});const rotated=await(await request('/api/me')).json();assert.equal(rotated.profile.id,a.profile.id);assert.ok(rotated.likes.includes('after-hours'));assert.ok(rotated.following.includes('after-hours'));
});
test('discover search, category and finite pagination return distinct series',async t=>{const {request}=await fixture(t);const a=await(await request('/api/discover')).json(),b=await(await request('/api/discover?cursor=4')).json();assert.equal(a.items.length,4);assert.equal(b.items.length,2);assert.equal(b.nextCursor,null);assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,6);const s=await(await request('/api/discover?q=velvet')).json();assert.equal(s.items[0].category,'Revenge');assert.equal((await(await request('/api/discover?category=Billionaire')).json()).items[0].id,'midnight-heir');assert.equal((await request('/api/discover?cursor=-1')).status,400);});
test('art migration retains custom covers, edited titles and free ranges',async t=>{const {db,dataDir}=await fixture(t);db.prepare('DELETE FROM metadata WHERE key=?').run('prime_art_v1');db.prepare('UPDATE dramas SET cover=?,freeEpisodes=0 WHERE id=?').run('/covers/custom.png','after-hours');db.prepare('UPDATE dramas SET title=?,cover=? WHERE id=?').run('My own story','/assets/posters/velvet-lies.svg','velvet-lies');db.prepare('UPDATE dramas SET cover=?,category=?,freeEpisodes=1 WHERE id=?').run('/assets/posters/almost-yours.svg','Romance','almost-yours');const reopened=createApp({dataDir,demoMode:true});reopened.db.close();assert.equal(db.prepare('SELECT cover FROM dramas WHERE id=?').get('after-hours').cover,'/covers/custom.png');assert.equal(db.prepare('SELECT freeEpisodes FROM dramas WHERE id=?').get('after-hours').freeEpisodes,0);assert.equal(db.prepare('SELECT cover FROM dramas WHERE id=?').get('velvet-lies').cover,'/assets/posters/velvet-lies.svg');assert.equal(db.prepare('SELECT freeEpisodes FROM dramas WHERE id=?').get('almost-yours').freeEpisodes,1);});
