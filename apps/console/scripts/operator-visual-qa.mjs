import {withBrowser,newPage} from './browser.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out='scratchpad/qa/operator';mkdirSync(out,{recursive:true});
await withBrowser(async browser=>{
 const results=[];
 for(const [width,height,locale] of [[1440,900,'en'],[1280,720,'vi'],[375,812,'en'],[320,740,'vi'],[768,1024,'zh']]){
  const {page,context}=await newPage(browser,{viewport:{width,height},motion:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(lang=>{localStorage.setItem('playerone.locale',lang);localStorage.setItem('playerone:showcase-cookie-choice:v1','declined');},locale);
  await page.goto('http://127.0.0.1:5190/discover#introduction');await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(700);
  await page.locator('.operator-step-nav button').nth(1).click();await page.waitForTimeout(200);
  await page.locator('#introduction').screenshot({path:`${out}/hero-${width}.png`});
  /* A broken glyph renders as a literal '?'; no copy on this section contains one. */
  const heights=[];for(const index of [0,1,2,3,4]){
   await page.locator('.operator-step-nav button').nth(index).click();
   heights.push(await page.locator('.operator-workspace').evaluate(n=>n.getBoundingClientRect().height));
   const text=await page.locator('#introduction').innerText();
   assert.equal(text.includes('?'),false,`Step ${index} renders a literal '?' at ${width}`);
  }
  assert(Math.max(...heights)-Math.min(...heights)<1,'Workspace must not shift between stages');
  await page.locator('.operator-step-nav button').nth(1).click();
  await page.waitForFunction(()=>document.querySelector('.operator-footage video')?.readyState>=2);
  const hero=await page.locator('#introduction').evaluate(n=>({overflow:document.documentElement.scrollWidth-innerWidth,images:[...n.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0),video:n.querySelector('video').readyState}));
  assert.equal(hero.overflow,0);assert.equal(hero.images,true);assert(hero.video>=2);
  /* The partner lockup carries no strip: nothing opaque behind either mark. */
  const partners=await page.locator('.operator-partners').evaluate(n=>{
   const clear=el=>{const c=getComputedStyle(el).backgroundColor;return c==='transparent'||c==='rgba(0, 0, 0, 0)';};
   const marks=[...n.querySelectorAll('img')].map(img=>{
    const chain=[];for(let el=img;el&&el!==n.parentElement;el=el.parentElement)chain.push({tag:el.className||el.tagName,clear:clear(el)});
    return {alt:img.alt,height:Math.round(img.getBoundingClientRect().height),chain};
   });
   return {background:getComputedStyle(n).backgroundColor,clear:clear(n),marks};
  });
  assert.equal(partners.clear,true,'.operator-partners must have no background colour');
  for(const mark of partners.marks)for(const link of mark.chain)assert.equal(link.clear,true,`${mark.alt} sits on an opaque box (${link.tag})`);
  const h2=await page.locator('#introduction h2').evaluate(n=>({font:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,lines:Math.round(n.getBoundingClientRect().height/parseFloat(getComputedStyle(n).lineHeight))}));
  assert.equal(h2.scrollWidth,h2.clientWidth,`Hero h2 overflows at ${width} (${h2.scrollWidth} > ${h2.clientWidth})`);
  const windowWidth=await page.locator('.operator-workspace').evaluate(n=>Math.round(n.getBoundingClientRect().width));
  await page.locator('.operator-step-nav button').nth(3).click();assert(await page.locator('.operator-qr img').evaluate(n=>n.complete&&n.naturalWidth>0));await page.locator('.operator-payment button').click();
  const settled=await page.locator('.operator-workspace').getAttribute('data-step');assert.equal(settled,'4');await page.waitForFunction(()=>{const n=document.querySelector('.operator-zalo');return n?.complete&&n.naturalWidth>0;});
  if(width===1440)await page.locator('#introduction').screenshot({path:`${out}/settled-${width}.png`});
  await page.locator('.operator-desk>footer button').click();assert.equal(await page.locator('.operator-workspace').getAttribute('data-step'),'0');await page.waitForTimeout(4800);
  const advanced=await page.locator('.operator-workspace').getAttribute('data-step');
  assert(advanced!==null&&advanced!=='0',`Replay must advance (saw ${advanced})`);
  await page.locator('#demo').evaluate(n=>scrollTo({top:scrollY+n.getBoundingClientRect().top+10,behavior:'instant'}));await page.waitForTimeout(1000);
  await page.screenshot({path:`${out}/walk-${width}.png`});
  const phone=await page.locator('#demo .discover-demo-phone').evaluate(n=>({overflow:n.scrollHeight-n.clientHeight,bottom:n.getBoundingClientRect().bottom,top:n.getBoundingClientRect().top}));
  assert.deepEqual(errors,[]);
  results.push({width,height,locale,hero,h2,windowWidth,partners:{background:partners.background,caps:partners.marks.map(m=>m.height)},phone,settled,advanced,errors});await context.close();
 }
 const {page,context}=await newPage(browser,{viewport:{width:1280,height:720},motion:false});await page.goto('http://127.0.0.1:5190/discover#introduction');await page.locator('.operator-step-nav button').nth(1).click();await page.waitForTimeout(1000);assert.equal(await page.locator('.operator-hero').getAttribute('data-running'),'false');assert(await page.locator('.operator-footage video').evaluate(n=>n.paused));assert.equal((await page.locator('#introduction').innerText()).includes('?'),false,'Reduced motion renders a literal ?');await context.close();
 writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
});
