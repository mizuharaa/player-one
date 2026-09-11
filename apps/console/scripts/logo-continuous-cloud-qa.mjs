import {withBrowser,newPage} from './browser.mjs';
import {writeFileSync} from 'node:fs';
const BASE='https://playerone-web-production.up.railway.app';
const out={deployment:'b7f50c70-1dc4-42e0-b5eb-48ffcec09644',runs:[],errors:[]};
await withBrowser(async browser=>{
 const {page:p,context}=await newPage(browser,{motion:true,viewport:{width:1440,height:900}});
 p.on('pageerror',e=>out.errors.push(String(e)));
 await p.addInitScript(()=>{
  window.__logoQA={samples:[],mountedAt:null,finishedAt:null};
  const timer=setInterval(()=>{const q=window.__logoQA,root=document.querySelector('.discover-page'),intro=document.querySelector('.logo-intro');
   if(intro){if(q.mountedAt===null)q.mountedAt=performance.now();const nodes=[...intro.querySelectorAll('[data-logo-piece]')];q.samples.push({t:performance.now()-q.mountedAt,count:nodes.length,debug:intro.hasAttribute('data-debug'),controls:intro.querySelectorAll('.logo-intro__debug').length,labels:intro.querySelectorAll('[data-logo-label]').length,fill:[...new Set(nodes.map(n=>getComputedStyle(n).fill))],poses:nodes.map(n=>n.getAttribute('transform'))});}
   if(q.mountedAt!==null&&!intro&&root?.dataset.logoComplete==='true'){q.finishedAt=performance.now();q.played=root.dataset.logoPlayed;clearInterval(timer);}
  },30);
 });
 await p.goto(BASE+'/discover');const health=await p.evaluate(async()=>{const r=await fetch('/healthz');return {status:r.status,body:await r.json()};});out.health=health;
 for(let i=0;i<3;i++){
  if(i===1)await p.reload();if(i===2)await p.goto(BASE+'/discover?logoDebug=1&logo-intro=debug');
  await p.waitForFunction(()=>window.__logoQA?.mountedAt!==null);
  if(i===0){await p.waitForTimeout(1250);await p.screenshot({path:'scratchpad/qa/logo-continuous/cloud-natural-1440.png'});}
  await p.waitForFunction(()=>window.__logoQA?.finishedAt!==null,{timeout:12000});
  await p.waitForFunction(()=>document.querySelector('.discover-page')?.dataset.filmRevealed==='true',null,{timeout:5000}).catch(()=>{});
  await p.waitForTimeout(600);
  const measured=await p.evaluate(()=>{const q=window.__logoQA,v=document.querySelector('[data-opening-film] video'),root=document.querySelector('.discover-page');return {...q,mountedDuration:q.finishedAt-q.mountedAt,query:location.search,film:{revealed:root.dataset.filmRevealed,pending:root.dataset.storyPending??null,paused:v.paused,time:v.currentTime,readyState:v.readyState,source:v.currentSrc},overflow:document.documentElement.style.overflow};});out.runs.push(measured);writeFileSync('scratchpad/qa/logo-continuous/cloud-results.json',JSON.stringify(out,null,2));console.log(JSON.stringify({run:i,duration:measured.mountedDuration,played:measured.played,film:measured.film}));
 }
 await context.close();
});
writeFileSync('scratchpad/qa/logo-continuous/cloud-results.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({...out,runs:out.runs.map(r=>({query:r.query,duration:r.mountedDuration,played:r.played,samples:r.samples.length,countAlways32:r.samples.every(s=>s.count===32),distinctPoses:new Set(r.samples.map(s=>JSON.stringify(s.poses))).size,initialFill:r.samples[0].fill,firstColor:r.samples.find(s=>s.fill.some(c=>c!=='rgb(23, 25, 27)'))?.t,noDebug:r.samples.every(s=>!s.debug&&!s.controls&&!s.labels),film:r.film,overflow:r.overflow}))},null,2));
