import {withBrowser,newPage} from './browser.mjs';
import {createServer} from 'node:http';
import {readFileSync,existsSync,statSync,writeFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
const root=resolve('apps/console/dist');
const OUT=process.env.QA_OUTPUT||'scratchpad/qa/logo-continuous';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.mp4':'video/mp4','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png'};
const server=createServer((req,res)=>{let path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!path.startsWith(root)){res.writeHead(403).end();return;}if(!existsSync(path)||!statSync(path).isFile())path=resolve(root,'index.html');res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(readFileSync(path));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const BASE='http://127.0.0.1:'+server.address().port;
const out={production:true,scenarios:[],errors:[]};
try{await withBrowser(async browser=>{
 for(const scenario of ['debug-query','route-unmount','chunk-failure']){
  const {page:p,context}=await newPage(browser,{motion:true,viewport:{width:1440,height:900}});p.on('pageerror',e=>out.errors.push(String(e)));
  if(scenario==='chunk-failure')await context.route('**/logoMotion-*.js',r=>r.abort());
  await p.goto(BASE+'/discover'+(scenario==='debug-query'?'?logoDebug=1&logoReplay=1&logo-intro=debug':''));await p.waitForSelector('.discover-page');
  const record={scenario};if(scenario!=='chunk-failure'){
   await p.waitForSelector('.logo-intro');record.initial=await p.evaluate(()=>({paths:document.querySelectorAll('.logo-intro path').length,controls:document.querySelectorAll('.logo-intro__debug').length,labels:document.querySelectorAll('[data-logo-label]').length,debug:document.querySelector('.logo-intro').hasAttribute('data-debug'),focus:document.activeElement?.className}));
   if(scenario==='debug-query'){await p.keyboard.press('Tab');record.tabFocus=await p.evaluate(()=>document.activeElement?.className);await p.waitForTimeout(600);await p.screenshot({path:OUT+'/production-natural-1440.png'});}
   if(scenario==='route-unmount')await p.locator('a[href="/login"]').first().evaluate(el=>el.click());
  }
  await p.waitForSelector('.logo-intro',{state:'detached',timeout:10000});record.end=await p.evaluate(()=>({path:location.pathname,overflow:document.documentElement.style.overflow,bodyOverflow:document.body.style.overflow,focus:document.activeElement?.tagName,pending:!!document.querySelector('[data-story-pending="true"]')}));out.scenarios.push(record);await context.close();
 }
});}finally{await new Promise(r=>server.close(r));}
writeFileSync(OUT+'/production-results.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
