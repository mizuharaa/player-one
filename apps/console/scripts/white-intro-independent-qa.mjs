import {withBrowser,newPage} from './browser.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const BASE=process.env.QA_BASE||'http://127.0.0.1:5190';
const OUT=process.env.QA_OUT||'scratchpad/qa/white-intro-independent';mkdirSync(OUT,{recursive:true});
const results={cases:[],errors:[]};
function init(){localStorage.setItem('playerone.locale','en');localStorage.setItem('playerone:showcase-cookie-choice:v1','declined');window.__intro=[];let mounted=false,start=0;const obs=new MutationObserver(()=>{const overlay=document.querySelector('.white-logo-intro');if(!overlay||mounted)return;mounted=true;obs.disconnect();start=performance.now();const sample=()=>{const o=document.querySelector('.white-logo-intro'),h=o?.querySelector('.hero-shuffle'),started=Number(h?.dataset.shuffleStarted)||null;const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};window.__intro.push({at:performance.now()-start,elapsed:started===null?null:performance.now()-started,phase:o?.dataset.phase||'removed',opacity:o?getComputedStyle(o).opacity:null,bg:o?getComputedStyle(o).backgroundColor:null,state:h?.dataset.shuffleState,weight:h?getComputedStyle(h).fontWeight:null,words:h?[...h.querySelectorAll('.hero-shuffle__word')].map(n=>({color:getComputedStyle(n).color,...rect(n)})):[],slots:h?[...h.querySelectorAll('[data-shuffle-slot]')].map(n=>({...rect(n),glyph:n.querySelector('.hero-shuffle__glyph').textContent})):[]});if(performance.now()-start<6100&&o)requestAnimationFrame(sample);};requestAnimationFrame(sample);});obs.observe(document,{childList:true,subtree:true});}
await withBrowser(async browser=>{
 for(const mode of ['1440','375','skip','escape','hash','scroll','reduced','font-reject','font-hang']){
  const {page:p,context}=await newPage(browser,{motion:mode!=='reduced',viewport:{width:mode==='375'?375:1440,height:mode==='375'?812:900}});p.setDefaultTimeout(10000);p.on('pageerror',e=>results.errors.push({mode,message:e.message}));await p.addInitScript(init);const row={mode};
  if(mode.startsWith('font-'))await p.addInitScript(kind=>{document.fonts.load=()=>kind==='font-reject'?Promise.reject(new Error('QA font failure')):new Promise(()=>{});},mode);
  try{
   await p.goto(BASE+'/discover',{waitUntil:'domcontentloaded'});await p.locator('h1.hero-shuffle').waitFor();
   assert.equal(await p.getByRole('heading',{level:1,name:'PLAYER ONE'}).count(),1);
   if(mode==='reduced'){assert.equal(await p.locator('.white-logo-intro').count(),0);row.pass=true;}
   else{
    if(mode==='skip')await p.locator('.white-logo-intro__skip').click();
    else if(mode==='escape')await p.keyboard.press('Escape');
    else if(mode==='hash'){row.beforeNav=await p.locator('.white-logo-intro').count();await p.locator('.discover-nav a[href="#demo"]').click();assert.equal(new URL(p.url()).hash,'#demo');assert.equal(row.beforeNav,1);}
    else if(mode==='scroll')await p.evaluate(()=>scrollTo(0,12));
    else if(mode==='1440'||mode==='375'){await p.waitForFunction(()=>document.querySelector('.white-logo-intro .hero-shuffle')?.dataset.shuffleState==='playing',null,{polling:'raf'});await p.waitForTimeout(250);await p.screenshot({path:`${OUT}/${mode}-white-playing.png`});}
    await p.locator('.white-logo-intro').waitFor({state:'detached',timeout:7000});row.frames=await p.evaluate(()=>window.__intro);assert(row.frames.length);
    row.removedAt=row.frames.at(-1).at;
    if(mode==='1440'||mode==='375'){
     const active=row.frames.filter(f=>f.state==='playing'||f.state==='hold');assert(active.length>30);assert(active.every(f=>f.weight==='650'));assert(active.every(f=>f.slots.length===9&&f.slots.every(s=>/^[A-Z]$/.test(s.glyph))));
     row.slotDrift=Math.max(...Array.from({length:9},(_,i)=>Math.max(...active.map(f=>f.slots[i].width))-Math.min(...active.map(f=>f.slots[i].width))));assert(row.slotDrift<.2);
     const leaving=row.frames.find(f=>f.phase==='leaving');assert(leaving.elapsed>=2300&&leaving.elapsed<2460);row.fadeMs=row.removedAt-leaving.at;assert(row.fadeMs>=300&&row.fadeMs<450);
     row.startColors=active[0].words.map(w=>w.color);row.finalColors=row.frames.filter(f=>f.phase==='leaving').at(-1).words.map(w=>w.color);assert.notDeepEqual(row.startColors,row.finalColors);row.background=active[0].bg;
     assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);await p.screenshot({path:`${OUT}/${mode}-film.png`});
    }
    if(mode==='font-hang')assert(row.removedAt>=5000&&row.removedAt<5700);
    if(mode==='font-reject')assert(row.removedAt<1800);
    row.pass=true;
   }
  }catch(e){row.pass=false;row.failure=e.message;}finally{results.cases.push(row);await context.close();}
 }
});writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({...results,cases:results.cases.map(({frames,...r})=>({...r,samples:frames?.length}))},null,2));if(results.errors.length||results.cases.some(c=>!c.pass))process.exitCode=1;
