// 原创彩色海报制作12秒无音轨演示视频；不接触用户上传目录。
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';import {chromium} from 'playwright';import {dramas} from '../server/seed.js';
const root=path.resolve(import.meta.dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'prime-video-'));
const size=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=width,height','-of','json',path.join(root,'public/assets/prime-posters.png')])).streams[0];
const image='data:image/png;base64,'+fs.readFileSync(path.join(root,'public/assets/prime-posters.png')).toString('base64');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{const page=await browser.newPage({viewport:{width:360,height:640},deviceScaleFactor:2});for(const [i,d] of dramas.entries()){
 await page.setContent(`<style>body{margin:0}svg{width:360px;height:640px;display:block;overflow:hidden}</style><svg viewBox="${i%3*size.width/3} ${Math.floor(i/3)*size.height/2} ${size.width/3} ${size.height/2}" preserveAspectRatio="xMidYMin slice"><image href="${image}" width="${size.width}" height="${size.height}"/></svg>`);
 await page.locator('image').evaluate(async el=>{const im=new Image();im.src=el.getAttribute('href');await im.decode();});const frame=path.join(tmp,d.id+'.png');await page.screenshot({path:frame});
 execFileSync('ffmpeg',['-y','-loop','1','-i',frame,'-vf',"scale=720:1280,zoompan=z='min(zoom+0.00011,1.04)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=360:s=360x640:fps=30",'-t','12','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',path.join(root,'media',d.id+'.mp4')],{stdio:'ignore'});console.log('Rendered',d.id);
}}finally{await browser.close();fs.rmSync(tmp,{recursive:true,force:true});}
