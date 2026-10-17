import express from 'express';
import path from 'node:path';
import { createApp } from './app.js';
const {app,db}=createApp({demoMode:process.env.DEMO_MODE==='true',dataDir:process.env.DATA_DIR,trustProxyHops:Number(process.env.TRUST_PROXY_HOPS||0)});
const root=path.resolve(import.meta.dirname,'..');
if(process.env.NODE_ENV!=='production') {
  const {createServer}=await import('vite');
  const vite=await createServer({server:{middlewareMode:true},appType:'spa'});
  // Vite development requires its injected module loader.
  app.use((req,res,next)=>{res.removeHeader('Content-Security-Policy');next();});
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(root,'dist')));
  app.get('/{*splat}',(req,res)=>res.sendFile(path.join(root,'dist','index.html')));
}
const port=Number(process.env.PORT||3000);
const server=app.listen(port,'0.0.0.0',()=>console.log(`Afterglow listening on port ${port}; demo=${process.env.DEMO_MODE==='true'}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
