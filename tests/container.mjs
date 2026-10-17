import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const env={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(...args)=>execFileSync('docker',['--host=unix:///var/run/docker.sock',...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const name=`afterglow-smoke-${process.pid}`,volume=name+'-data',base='http://127.0.0.1:3102';
let created=false,browser;
function start(){docker('run','--detach','--name',name,'--publish','127.0.0.1:3102:3000','--mount',`type=volume,source=${volume},target=/var/data`,'--env','DEMO_MODE=true','--env','ADMIN_PASSWORD=container-test-password-123',process.env.TEST_IMAGE||'afterglow:preview');created=true;}
async function ready(){for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Container readiness timeout.');}
try{
  docker('volume','create',volume);start();await ready();
  const meResponse=await fetch(base+'/api/me'),cookie=meResponse.headers.get('set-cookie').split(';')[0];
  assert.equal((await meResponse.json()).demoAdminLogin,false);
  const uid=docker('exec',name,'sh','-c',"sed -n '/^Uid:/p' /proc/1/status");assert.match(uid,/Uid:\s+1000/);
  assert.match(docker('exec',name,'ffprobe','-version'),/ffprobe version/);
  assert.equal((await fetch(base+'/media/after-hours-3',{headers:{cookie}})).status,403);
  const partial=await fetch(base+'/media/after-hours-1',{headers:{cookie,Range:'bytes=0-99'}});assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,100);
  const favorite=await fetch(base+'/api/favorites/after-hours',{method:'POST',headers:{cookie,'X-Requested-With':'Afterglow'}});assert.equal(favorite.status,200);
  docker('stop','--time','10',name);docker('rm',name);created=false;
  start();await ready();
  const restored=await (await fetch(base+'/api/me',{headers:{cookie}})).json();assert.ok(restored.favorites.includes('after-hours'));
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(base);await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=3&&v.currentTime>1;},{},{timeout:20000});
  await page.goto(base+'/admin');await page.getByText('此站点已启用独立管理密码，请使用部署时配置的密码登录。').waitFor();
  assert.equal(await page.getByText('afterglow-preview',{exact:true}).count(),0);
  await page.getByLabel('管理密码',{exact:true}).fill('container-test-password-123');await page.getByRole('button',{name:'登录管理后台',exact:false}).click();await page.getByRole('button',{name:'创建短剧',exact:true}).waitFor();
  console.log('PASS container: HTTP readiness, non-root process, ffprobe, protected media, Range playback, data after container replacement, browser video decoding, private admin login.');
}catch(error){
  if(created){console.error(docker('logs',name));console.error(docker('inspect','--format','{{.State.Status}} {{.State.ExitCode}}',name));}
  throw error;
}finally{
  if(browser)await browser.close();
  if(created){try{docker('stop','--time','10',name);}finally{docker('rm',name);}}
  docker('volume','rm',volume);
}
