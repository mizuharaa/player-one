import {withBrowser,newPage} from './browser.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const BASE=process.env.QA_BASE||'http://127.0.0.1:5190',OUT='scratchpad/qa/discover-scroll';mkdirSync(OUT,{recursive:true});
const out={base:BASE,runs:[],errors:[]};
const inspect=p=>p.evaluate(()=>({scrollY,overflow:document.documentElement.scrollWidth-innerWidth,headings:[...document.querySelectorAll('[data-discover-heading]')].map(n=>{const c=getComputedStyle(n),r=n.getBoundingClientRect();return {text:n.textContent,opacity:c.opacity,visibility:c.visibility,transform:c.transform,inline:n.style.cssText,top:r.top,bottom:r.bottom,height:r.height,color:c.color};}),scenes:[...document.querySelectorAll('[data-discover-scene]')].map(n=>({kind:n.dataset.discoverScene,transform:getComputedStyle(n).transform,inline:n.style.cssText})),gallery:[...document.querySelectorAll('.discover-collector-wall figure img')].map(n=>({loaded:n.complete&&n.naturalWidth>0,filter:getComputedStyle(n).filter,transform:getComputedStyle(n).transform})),movies:[...document.querySelectorAll('video')].map(v=>({src:v.currentSrc,paused:v.paused,time:v.currentTime,ready:v.readyState,visible:v.getBoundingClientRect().bottom>0&&v.getBoundingClientRect().top<innerHeight})),pending:document.querySelector('.discover-page').dataset.storyPending??null}));
await withBrowser(async browser=>{
 for(const width of [375,1440,1920]){
  const {page:p,context}=await newPage(browser,{motion:true,viewport:{width,height:900}});p.on('pageerror',e=>out.errors.push(String(e)));
  await p.addInitScript(()=>{const native=requestAnimationFrame;window.__qaRaf=0;window.requestAnimationFrame=function(cb){window.__qaRaf++;return native.call(window,cb);};});
  await p.goto(BASE+'/discover');await p.waitForSelector('.discover-page[data-logo-complete="true"]');await p.waitForSelector('.logo-intro',{state:'detached'});await p.waitForTimeout(1000);
  const run={width,opening:await inspect(p),stops:[]};
  for(const target of ['.discover-aperture-section','.discover-work','.discover-review-theatre','.discover-questions']){
   const y=await p.locator(target).evaluate(n=>n.getBoundingClientRect().top+scrollY-150);
   for(let j=0;j<20;j++){const current=await p.evaluate(()=>scrollY);const delta=y-current;if(Math.abs(delta)<30)break;await p.mouse.wheel(0,Math.max(-650,Math.min(650,delta)));await p.waitForTimeout(35);}
   await p.waitForTimeout(500);for(const delta of [420,-620,510,-350]){await p.mouse.wheel(0,delta);await p.waitForTimeout(30);}await p.waitForTimeout(900);await p.mouse.move(2,2);
   await p.waitForTimeout(1800);
   await p.evaluate(selector=>{const n=document.querySelector(selector)?.querySelector('h2');window.__qaBlink=[];window.__qaBlinkTimer=setInterval(()=>{if(n)window.__qaBlink.push({opacity:getComputedStyle(n).opacity,transform:getComputedStyle(n).transform,sceneTransforms:[...document.querySelectorAll('[data-discover-scene]')].map(x=>getComputedStyle(x).transform)});},12);},target);
   await p.mouse.wheel(0,4);await p.waitForTimeout(450);for(const delta of [-8,12,-8]){await p.mouse.wheel(0,delta);await p.waitForTimeout(35);}await p.waitForTimeout(400);
   const blink=await p.evaluate(()=>{clearInterval(window.__qaBlinkTimer);return window.__qaBlink;});
   const state=await inspect(p);const stop={target,blink,...state};
   if(target==='.discover-aperture-section'){const ink=p.locator(target+' .discover-title-ink').first();await ink.hover();await p.waitForTimeout(350);stop.headingHover=await ink.evaluate(n=>({foreground:getComputedStyle(n).color,background:getComputedStyle(n.closest('.discover-aperture-section')).backgroundColor,opacity:getComputedStyle(n.closest('h2')).opacity}));await p.mouse.move(1,1);}
   run.stops.push(stop);if(target==='.discover-aperture-section'||target==='.discover-work')await p.screenshot({path:OUT+`/${width}-${target.slice(1)}.png`});
  }
  if(width<768){await p.locator('.discover-menu-button').click();await p.locator('#discover-menu a[href="#work"]').click();}else await p.locator('.discover-nav-destinations a[href="#work"]').click();await p.waitForTimeout(900);run.anchor=await inspect(p);
  const figure=p.locator('.discover-collector-wall figure').first();await figure.scrollIntoViewIfNeeded();await figure.hover();await p.waitForTimeout(700);run.hover=await inspect(p);await p.mouse.move(1,1);await p.waitForTimeout(700);run.hoverOut=await inspect(p);
  run.captionColors=await p.locator('.discover-collector-wall figcaption').evaluateAll(ns=>ns.map(n=>({text:n.textContent,color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor,opacity:getComputedStyle(n).opacity,filter:getComputedStyle(n).filter})));
  run.locales=[];for(const locale of ['en','zh','vi']){if(width<768){await p.locator('.discover-menu-button').click();await p.locator('#discover-menu select').selectOption(locale);await p.keyboard.press('Escape');}else await p.locator('.discover-nav-tools select').selectOption(locale);await p.waitForTimeout(400);run.locales.push({locale,...await inspect(p)});}
  await p.setViewportSize({width:width===375?430:width-80,height:880});await p.waitForTimeout(600);run.resize=await inspect(p);await p.mouse.move(1,1);await p.waitForTimeout(1600);const start=await p.evaluate(()=>window.__qaRaf);await p.waitForTimeout(1200);run.idleRaf=await p.evaluate(start=>window.__qaRaf-start,start);run.final=await inspect(p);
  out.runs.push(run);writeFileSync(OUT+'/results.json',JSON.stringify(out,null,2));console.log(JSON.stringify({width,idleRaf:run.idleRaf,hidden:run.final.headings.filter(h=>Number(h.opacity)<.99||h.visibility!=='visible'),transformed:run.final.scenes.filter(s=>s.transform!=='none'),errors:out.errors}));await context.close();
 }
 const {page:p,context}=await newPage(browser,{viewport:{width:375,height:900}});await p.goto(BASE+'/discover');await p.waitForSelector('.discover-page');await p.mouse.wheel(0,1600);await p.waitForTimeout(500);out.reduced=await inspect(p);out.reduced.intro=await p.locator('.logo-intro').count();await context.close();
});writeFileSync(OUT+'/results.json',JSON.stringify(out,null,2));
