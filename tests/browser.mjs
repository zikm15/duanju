import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'afterglow-browser-'));
const base='http://127.0.0.1:3101';
const server=spawn(process.execPath,['server/index.js'],{cwd:root,env:{...process.env,PORT:'3101',NODE_ENV:'production',DEMO_MODE:'true',DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
let browser;let passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log(`PASS ${name}`);};
const errors=[];
try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));if(i===99)throw new Error('Server failed to start: '+logs);}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  const desktop=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await desktop.newPage();page.on('pageerror',e=>errors.push(e.message));
  const request=async(url,data)=>page.evaluate(async({url,data})=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'Afterglow'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};},{url,data});
  await check('home starts in the vertical player, demo ad counts down, H.264 video actually advances',async()=>{
    await page.goto(base);await page.getByText('DEMO AD · 5s',{exact:true}).waitFor();
    await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=3&&v.currentTime>1;},{},{timeout:15000});
    assert.equal(await page.locator('video').evaluate(v=>v.videoWidth),360);
    await page.getByRole('button',{name:'Pause video',exact:true}).click();
    await page.screenshot({path:path.join(root,'test-results/watch-desktop.png'),fullPage:true});
  });
  await check('bookmark, server progress, reload persistence and library',async()=>{
    await page.getByRole('button',{name:'Save story',exact:true}).first().click();
    await page.getByRole('status').filter({hasText:'Added to your saved stories'}).waitFor();
    const me=await (await page.request.get(base+'/api/me')).json();assert.ok(me.favorites.includes('after-hours'));assert.ok(me.progress[0].seconds>0);
    await page.reload();await page.getByRole('button',{name:'Unsave story',exact:true}).waitFor();
    await page.locator('.sidebar').getByRole('button',{name:'My list',exact:true}).click();await page.getByRole('button',{name:'Watch After Hours',exact:true}).waitFor();
    await page.getByRole('button',{name:'Continue watching',exact:true}).click();await page.getByText(/Resume at/).waitFor();
  });
  await check('discover search, genre filters, empty result and responsive posters',async()=>{
    await page.locator('.sidebar').getByRole('button',{name:'Discover',exact:true}).click();
    await page.getByRole('textbox',{name:'Search stories',exact:true}).fill('velvet');assert.equal(await page.locator('.poster-card').count(),1);await page.getByRole('button',{name:'Watch Velvet Lies',exact:true}).waitFor();
    await page.getByRole('button',{name:'Clear search'}).click();await page.getByRole('button',{name:'Romance',exact:true}).click();assert.equal(await page.locator('.poster-card').count(),2);
    await page.getByRole('textbox',{name:'Search stories',exact:true}).fill('no-such-title');await page.getByText('No plot twists here. Yet.').waitFor();
    await page.getByRole('button',{name:'Clear search'}).click();await page.getByRole('button',{name:'All stories',exact:true}).click();
    await page.screenshot({path:path.join(root,'test-results/discover-desktop.png'),fullPage:true});
  });
  await check('free viewer paywall and episode dialog keyboard dismissal',async()=>{
    await page.getByRole('button',{name:'Watch After Hours',exact:true}).click();await page.getByRole('button',{name:'Select episodes',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'03',exact:true}).click();await page.getByText('One moreplot twist?').waitFor();
    assert.equal((await page.request.get(base+'/media/after-hours-3')).status(),403);
    await page.getByRole('button',{name:'Explore membership',exact:true}).last().click();await page.getByText('PayPal is not connected.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'PayPal · coming soon',exact:true}).first().isDisabled(),true);
  });
  await check('Basic unlocks paid episodes with demo ads; Premium removes ads; no billing',async()=>{
    await page.getByRole('button',{name:'Try basic in demo',exact:true}).click();await page.getByRole('button',{name:'Active in demo',exact:true}).waitFor();
    let access=await (await page.request.get(base+'/api/episodes/after-hours-3/access')).json();assert.equal(access.allowed,true);assert.ok(access.ad);
    await page.getByRole('button',{name:'Try premium in demo',exact:true}).click();
    await page.waitForFunction(async()=> (await (await fetch('/api/me')).json()).plan==='premium');
    access=await (await page.request.get(base+'/api/episodes/after-hours-3/access')).json();assert.equal(access.allowed,true);assert.equal(access.ad,null);
    assert.equal((await request('/api/billing/subscribe',{plan:'premium'})).status,503);
    await page.screenshot({path:path.join(root,'test-results/membership-desktop.png'),fullPage:true});
    await page.goto(base+'/?series=after-hours');await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.5);
    assert.equal(await page.locator('.ad-overlay').count(),0);
    await page.getByRole('button',{name:'Select episodes',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  });
  await check('auto-play advances episode and disabled auto-play stays on the episode',async()=>{
    await page.locator('.watch-info input[type=checkbox]').check();
    await page.locator('video').evaluate(v=>{v.currentTime=v.duration-0.25;v.play();});
    await page.waitForFunction(()=>document.querySelector('.player-episode')?.textContent==='EP 02');
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=3);
    await page.locator('.watch-info input[type=checkbox]').uncheck();
    await page.locator('video').evaluate(v=>{v.currentTime=v.duration-0.25;v.play();});
    await page.waitForFunction(()=>document.querySelector('video')?.ended);
    assert.equal(await page.locator('.player-episode').textContent(),'EP 02');
  });
  await check('Chinese admin creates a series, uploads cover and real MP4, updates free range, and deletes test content',async()=>{
    await page.goto(base+'/admin');await page.getByLabel('管理密码',{exact:true}).fill('afterglow-preview');await page.getByRole('button',{name:'登录管理后台',exact:false}).click();
    await page.getByRole('button',{name:'创建短剧',exact:true}).click();await page.getByLabel('短剧名称（英文）').fill('Browser test story');await page.getByLabel('一句话简介（英文）').fill('A story that works');await page.getByLabel('剧情介绍（英文）').fill('Created in the real browser test.');
    await page.getByLabel('前 N 集免费').fill('0');await page.getByRole('button',{name:'保存短剧信息',exact:true}).click();await page.getByRole('heading',{name:'封面图片',exact:true}).waitFor();
    await page.getByLabel('选择封面',{exact:true}).setInputFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKf0AAAAASUVORK5CYII=','base64')});await page.getByRole('button',{name:'上传封面',exact:true}).click();await page.getByRole('status').filter({hasText:'封面已更新'}).waitFor();
    await page.getByLabel('剧集标题（英文）').fill('Uploaded chapter');await page.getByLabel('选择视频',{exact:true}).setInputFiles(path.join(root,'media/after-hours.mp4'));await page.getByRole('button',{name:'上传新剧集',exact:true}).click();await page.getByText('第 1 集 · Uploaded chapter',{exact:true}).waitFor();
    let c=await (await page.request.get(base+'/api/catalog')).json();const uploaded=c.find(d=>d.title==='Browser test story');
    await request('/api/demo/plan',{plan:'free'});assert.equal((await page.request.get(base+'/media/'+uploaded.episodes[0].id)).status(),403);
    await page.getByLabel('前 N 集免费').fill('1');await page.getByRole('button',{name:'保存短剧信息',exact:true}).click();await page.getByText('免费',{exact:true}).waitFor();
    assert.equal((await page.request.get(base+'/media/'+uploaded.episodes[0].id)).status(),200);
    await page.getByRole('button',{name:'Close dialog'}).click();await page.screenshot({path:path.join(root,'test-results/admin-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'广告与订阅',exact:true}).click();await page.getByLabel('启用演示广告').uncheck();await page.getByRole('button',{name:'保存广告配置',exact:true}).click();await page.getByRole('status').filter({hasText:'广告配置已保存'}).waitFor();assert.equal((await (await page.request.get(base+'/api/episodes/after-hours-1/access')).json()).ad,null);
    await page.getByRole('button',{name:'短剧与剧集',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'删除 Browser test story',exact:true}).click();await page.getByRole('status').filter({hasText:'已删除短剧'}).waitFor();
  });
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:'reduce'});const phone=await mobile.newPage();phone.on('pageerror',e=>errors.push(e.message));
  await check('mobile navigation, vertical swipe, two-column discover and no horizontal overflow',async()=>{
    await phone.goto(base);await phone.waitForFunction(()=>document.querySelector('video')?.currentTime>0.5);
    await phone.getByRole('button',{name:'Pause video',exact:true}).click();
    await phone.screenshot({path:path.join(root,'test-results/watch-mobile.png'),fullPage:true});
    const title=await phone.locator('.player-caption h2').textContent();
    const touch=await mobile.newCDPSession(phone);
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y:600}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:190,y:200}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await touch.detach();
    await phone.waitForFunction(title=>document.querySelector('.player-caption h2')?.textContent!==title,title);
    await phone.locator('.bottom-nav').getByRole('button',{name:'Discover',exact:true}).click();await phone.getByRole('heading',{name:'Stay for the story.',exact:true}).waitFor();
    const cols=await phone.locator('.poster-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);assert.equal(cols,2);
    assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await phone.screenshot({path:path.join(root,'test-results/discover-mobile.png'),fullPage:true});
    await phone.locator('.bottom-nav').getByRole('button',{name:'Join',exact:true}).click();await phone.screenshot({path:path.join(root,'test-results/membership-mobile.png'),fullPage:true});
    await phone.goto(base+'/admin');assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
  assert.deepEqual(errors,[]);console.log(`${passed} browser workflows passed; no uncaught page errors.`);
  fs.writeFileSync(path.join(root,'test-results/browser-report.json'),JSON.stringify({passed,errors,checkedAt:new Date().toISOString(),screenshots:['watch-desktop','discover-desktop','membership-desktop','admin-desktop','watch-mobile','discover-mobile','membership-mobile']},null,2));
}catch(e){if(browser){const pages=browser.contexts().flatMap(c=>c.pages());for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:path.join(root,`test-results/failure-${i}.png`),fullPage:true}).catch(()=>{});}console.error(logs);throw e;}
finally{if(browser)await browser.close();server.kill('SIGTERM');await once(server,'exit').catch(()=>{});fs.rmSync(dataDir,{recursive:true,force:true});}
