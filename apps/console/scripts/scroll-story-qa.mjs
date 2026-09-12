import {withBrowser,newPage} from './browser.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const BASE=process.env.QA_BASE||'http://127.0.0.1:5190',OUT=process.env.QA_OUT||'scratchpad/qa/scroll-story';mkdirSync(OUT,{recursive:true});
const results=[];
await withBrowser(async browser=>{
 for(const [width,height,locale,motion] of [[1440,900,'en',true],[1280,720,'vi',true],[375,812,'en',true],[320,740,'vi',false],[768,1024,'zh',false]]){
  const {page,context}=await newPage(browser,{viewport:{width,height},motion});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.addInitScript(lang=>{localStorage.setItem('playerone.locale',lang);localStorage.setItem('playerone:showcase-cookie-choice:v1','declined');},locale);
   await page.goto(BASE+'/discover#demo');await page.waitForTimeout(900);
   const row={width,height,locale,motion,steps:[]};
   const demo=page.locator('#demo');const pinned=await demo.getAttribute('data-scene-pinned');row.pinned=pinned;
   for(let index=0;index<4;index++){
    if(pinned==='true'){await demo.evaluate((n,i)=>scrollTo({top:scrollY+n.getBoundingClientRect().top+(n.offsetHeight-innerHeight)*(i+.25)/4,behavior:'instant'}),index);}
    else await page.locator('.discover-walkthrough-copy li button').nth(index).click();
    await page.waitForTimeout(750);assert.equal(await demo.getAttribute('data-step'),String(index));
    const size=await page.locator('.discover-demo-phone').evaluate(n=>({overflow:n.scrollHeight-n.clientHeight,screen:n.querySelector('[data-phone-screen]').dataset.phoneScreen,bottom:n.getBoundingClientRect().bottom,top:n.getBoundingClientRect().top,islandRight:n.querySelector('.discover-phone-hardware i').getBoundingClientRect().right,statusLeft:n.querySelector('.discover-phone-status').getBoundingClientRect().left}));
    await page.screenshot({path:`${OUT}/${width}-${locale}-step${index}.png`});
    row.steps.push(size);console.log(width,index,size);assert.equal(size.screen,['browse','details','prepare','ready'][index]);assert.equal(await page.locator('[data-phone-screen]').count(),1);assert.equal(size.overflow,0);if(pinned==='true')assert(size.bottom<=height-5);assert(size.statusLeft>size.islandRight);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
   }
   await page.locator('.discover-walkthrough-tools button').click();await page.waitForTimeout(200);assert.equal(await demo.getAttribute('data-manual'),'true');
   await page.locator('.discover-native-task').first().click();await page.locator('.discover-demo-phone .discover-button').click();assert(await page.locator('.discover-demo-phone .discover-button').isDisabled());
   await page.locator('.discover-demo-choice').first().getByRole('radio').last().check();await page.locator('.discover-demo-choice').last().getByRole('radio').last().check();await page.locator('.discover-demo-phone .discover-button').click();assert.equal(await page.locator('[data-phone-screen]').getAttribute('data-phone-screen'),'ready');
   await page.goto(BASE+'/discover#review');await page.waitForTimeout(800);
   row.review=await page.locator('.discover-review-wide').evaluate(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height,videoFit:getComputedStyle(n.querySelector('video')).objectFit,overflow:document.documentElement.scrollWidth-innerWidth}));assert.equal(row.review.overflow,0);assert.equal(row.review.w,width);assert.equal(row.review.videoFit,'cover');
   await page.screenshot({path:`${OUT}/${width}-${locale}-review.png`});
   await page.locator('.discover-verdict-partial').click();assert.equal(await page.locator('.discover-verdict-partial').getAttribute('aria-pressed'),'true');
   assert.deepEqual(errors,[]);results.push(row);
  }finally{await context.close();}
 }
});writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
