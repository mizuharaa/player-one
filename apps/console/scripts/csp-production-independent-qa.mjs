import {withBrowser,newPage} from './browser.mjs';
import {createShowcaseServer} from '../../../deploy/http-server.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const OUT='scratchpad/qa/csp-independent';mkdirSync(OUT,{recursive:true});
const web=await createShowcaseServer({distDir:'apps/console/dist',apiPort:8080});await new Promise(r=>web.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${web.address().port}`;const result={base,errors:[],violations:[],media:[],headers:null};
try{await withBrowser(async browser=>{
 const {page,context}=await newPage(browser,{motion:true,viewport:{width:1440,height:900}});page.setDefaultTimeout(15000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('response',r=>{if(/\.glb|\.mp4/.test(r.url()))result.media.push({path:new URL(r.url()).pathname,status:r.status()});});
 await page.addInitScript(()=>{localStorage.setItem('playerone.locale','en');localStorage.setItem('playerone:showcase-cookie-choice:v1','declined');window.__violations=[];document.addEventListener('securitypolicyviolation',e=>window.__violations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));});
 try{
  const response=await page.goto(base+'/discover');result.headers={csp:response.headers()['content-security-policy'],frame:response.headers()['x-frame-options']};
  await page.waitForSelector('[data-film-revealed="true"]');result.hero={logoComplete:await page.locator('.discover-page').getAttribute('data-logo-complete'),headingVisible:await page.locator('h1').isVisible()};assert.equal(result.hero.logoComplete,'true');
  await page.locator('#review').scrollIntoViewIfNeeded();const video=page.locator('#review video');await page.waitForFunction(()=>document.querySelector('#review video')?.readyState>=2);if(await video.evaluate(v=>v.paused))await page.locator('#review .discover-video-control').click();const t=await video.evaluate(v=>v.currentTime);await page.waitForTimeout(350);assert(await video.evaluate((v,t)=>v.currentTime>t,t));await page.locator('#review .discover-video-control').click();assert(await video.evaluate(v=>v.paused));result.playPause=true;
  await page.locator('#questions').scrollIntoViewIfNeeded();await page.waitForTimeout(1500);result.mascot=await page.locator('.discover-truc-mascot').evaluate(n=>({canvas:!!n.querySelector('canvas'),svg:!!n.querySelector('svg'),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}));assert(result.mascot.canvas||result.mascot.svg);await page.screenshot({path:OUT+'/mascot.png'});
  result.legitimateViolations=await page.evaluate(()=>window.__violations);assert.deepEqual(result.legitimateViolations,[]);
  await page.evaluate(()=>{const script=document.createElement('script');script.textContent='window.__injectedExecuted = true';document.body.append(script);const button=document.createElement('button');button.setAttribute('onclick','window.__handlerExecuted = true');document.body.append(button);button.click();});await page.waitForTimeout(100);
  result.inline=await page.evaluate(()=>({script:window.__injectedExecuted===true,handler:window.__handlerExecuted===true,violations:window.__violations}));assert.equal(result.inline.script,false);assert.equal(result.inline.handler,false);assert(result.inline.violations.length>=2);
  result.pass=true;
 }catch(e){result.failure=e.message;result.pass=false;}finally{await context.close();}
});}finally{web.closeAllConnections();await new Promise(r=>web.close(r));}
writeFileSync(OUT+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;
