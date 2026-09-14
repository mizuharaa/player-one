import {withBrowser,newPage} from './browser.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const BASE=process.env.QA_BASE||'http://127.0.0.1:5190';
const OUT=process.env.QA_OUT||'scratchpad/qa/scroll-story';
const stages=['browse','details','prepare','ready'];
const results=[];
mkdirSync(OUT,{recursive:true});
writeFileSync(OUT+'/results.json',JSON.stringify({status:'running',results}));
try {
 await withBrowser(async browser=>{
  for(const [width,height,locale,motion] of [[1440,900,'en',true],[1280,720,'vi',true],[375,812,'en',true],[320,740,'vi',false],[768,1024,'zh',false]]){
   const {page,context}=await newPage(browser,{viewport:{width,height},motion});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const row={width,height,locale,motion,steps:[]};results.push(row);
   try {
    await page.addInitScript(lang=>{
     localStorage.setItem('playerone.locale',lang);
     localStorage.setItem('playerone:showcase-cookie-choice:v1','declined');
    },locale);
    await page.goto(BASE+'/discover#demo');
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(900);
    const demo=page.locator('#demo');
    const phone=demo.locator('.discover-demo-phone');
    const active=phone.locator('[data-screen-active="true"]');
    const pinned=await demo.getAttribute('data-scene-pinned')==='true';row.pinned=pinned;
    assert.equal(pinned,width>=900&&height>=720&&motion);
    assert.equal(await phone.locator('[data-phone-screen]').count(),4);

    const scrollStep=async index=>{
     await demo.evaluate((n,i)=>scrollTo({top:scrollY+n.getBoundingClientRect().top+(n.offsetHeight-innerHeight)*(i+.25)/4,behavior:'instant'}),index);
    };
    const expectStep=async index=>{
     await page.waitForFunction(i=>document.querySelector('#demo')?.dataset.step===String(i),index);
     await page.waitForTimeout(750);
     assert.equal(await active.count(),1);
     assert.equal(await active.getAttribute('data-phone-screen'),stages[index]);
     assert.equal(await phone.locator('[data-screen-active="false"][inert][aria-hidden="true"]').count(),3);
     assert(await phone.evaluate(n=>n.closest('[inert]')!==null),'Guided phone must not trap focus');
    };
    for(let index=0;index<4;index++){
     if(pinned)await scrollStep(index);
     else if(index)await demo.locator('.discover-device-steps button').last().click();
     else await demo.locator('.discover-walkthrough-device').scrollIntoViewIfNeeded();
     await expectStep(index);
     const size=await phone.evaluate(n=>{
      const s=n.querySelector('[data-screen-active="true"]');const b=s.getBoundingClientRect();
      return {
       overflow:n.scrollHeight-n.clientHeight,contentOverflow:s.scrollHeight-s.clientHeight,
       screen:s.dataset.phoneScreen,opacity:Number(getComputedStyle(s).opacity),
       bottom:n.getBoundingClientRect().bottom,top:n.getBoundingClientRect().top,
       islandRight:n.querySelector('.discover-phone-hardware i').getBoundingClientRect().right,
       statusLeft:n.querySelector('.discover-phone-status').getBoundingClientRect().left,
       clipped:[...s.children].filter(c=>c.getBoundingClientRect().height>0&&c.getBoundingClientRect().bottom>b.bottom+1).map(c=>c.className),
       images:[...s.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0),
      };
     });
     row.steps.push(size);
     assert.equal(size.overflow,0);assert.equal(size.contentOverflow,0);assert.deepEqual(size.clipped,[]);
     assert.equal(size.opacity,1);assert(size.images,'Task imagery must load');
     if(pinned){assert(size.bottom<=height-5);assert(size.top>=76);}
     assert(size.statusLeft>size.islandRight);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
     await page.screenshot({path:`${OUT}/${width}-${locale}-step${index}.png`});
    }
    // Reverse through the actual controls/scroll path, then jump directly to a chapter.
    for(const index of [2,1,0]){
     if(pinned)await scrollStep(index);
     else await demo.locator('.discover-device-steps button').first().click();
     await expectStep(index);
    }
    if(!pinned)assert(await demo.locator('.discover-device-steps button').first().isDisabled());
    await demo.locator('.discover-walkthrough-copy li button').nth(2).click();await expectStep(2);
    if(pinned){
     // Stop halfway through a transition: the phone must retain a visible surface.
     await demo.evaluate(n=>scrollTo({top:scrollY+n.getBoundingClientRect().top+(n.offsetHeight-innerHeight)*.84/4,behavior:'instant'}));
     await page.waitForTimeout(1200);
     const opacity=await phone.locator('[data-phone-screen]').evaluateAll(nodes=>nodes.map(n=>Number(getComputedStyle(n).opacity)));
     assert(opacity[0]>.35&&opacity[0]<.65);assert(opacity[1]>.35&&opacity[1]<.65);
     assert(Math.abs(opacity.reduce((a,b)=>a+b,0)-1)<.01);
    }

    await demo.locator('.discover-walkthrough-mode').click();
    await page.waitForTimeout(250);assert.equal(await demo.getAttribute('data-manual'),'true');
    assert.equal(await phone.locator('[data-phone-screen]').count(),1);
    assert.equal(await phone.evaluate(n=>n.closest('[inert]')!==null),false);
    await phone.locator('.discover-native-task').first().click();
    assert(await phone.locator('h3').evaluate(n=>n===document.activeElement),'Manual navigation moves focus to its heading');
    await phone.locator('.discover-button').click();assert(await phone.locator('.discover-button').isDisabled());
    await phone.locator('.discover-demo-choice').first().getByRole('radio').last().check();
    assert(await phone.locator('.discover-button').isDisabled());
    await phone.locator('.discover-demo-choice').last().getByRole('radio').last().check();
    await phone.locator('.discover-button').click();
    assert.equal(await active.getAttribute('data-phone-screen'),'ready');
    await phone.locator('.discover-button').click();
    assert.equal(await active.getAttribute('data-phone-screen'),'browse');
    await demo.locator('.discover-walkthrough-mode').click();await page.waitForTimeout(900);
    assert.equal(await demo.getAttribute('data-manual'),'false');
    assert.equal(await phone.locator('[data-phone-screen]').count(),4);

    await page.goto(BASE+'/discover#review');await page.waitForTimeout(800);
    row.review=await page.locator('.discover-review-wide').evaluate(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height,videoFit:getComputedStyle(n.querySelector('video')).objectFit,overflow:document.documentElement.scrollWidth-innerWidth}));
    assert.equal(row.review.overflow,0);assert.equal(row.review.w,width);assert.equal(row.review.videoFit,'cover');
    await page.screenshot({path:`${OUT}/${width}-${locale}-review.png`});
    await page.locator('.discover-verdict-partial').click();
    assert.equal(await page.locator('.discover-verdict-partial').getAttribute('aria-pressed'),'true');
    assert.deepEqual(errors,[]);row.status='passed';console.log(`${width}x${height} ${locale} motion=${motion}: passed`);
   } finally {await context.close();}
  }
 });
 writeFileSync(OUT+'/results.json',JSON.stringify({status:'passed',results},null,2));
} catch(error) {
 writeFileSync(OUT+'/results.json',JSON.stringify({status:'failed',error:String(error),results},null,2));
 throw error;
}
