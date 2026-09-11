import {withBrowser,newPage} from './browser.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const BASE=process.env.QA_BASE||'http://127.0.0.1:5190',OUT='scratchpad/qa/kinetic-landing';mkdirSync(OUT,{recursive:true});
const results=[];
await withBrowser(async browser=>{
 for(const [width,locale,motion] of [[1440,'en',true],[375,'en',true],[320,'vi',false],[768,'zh',false]]){
  const {page,context}=await newPage(browser,{viewport:{width,height:1000},motion});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(lang=>{localStorage.setItem('playerone.locale',lang);localStorage.setItem('playerone:showcase-cookie-choice:v1','declined');},locale);
  try{
   await page.goto(BASE+'/discover#introduction');await page.waitForTimeout(850);
   const intro=page.locator('#introduction');
   const fills=[];
   for(const offset of [750,250]){await intro.evaluate((n,o)=>window.scrollTo({top:window.scrollY+n.getBoundingClientRect().top-o,behavior:'instant'}),offset);await page.waitForTimeout(100);fills.push(await intro.evaluate(n=>parseFloat(n.style.getPropertyValue('--keyword-fill'))));}
   assert(motion?fills[1]>fills[0]:fills.every(v=>v===100));
   assert.equal(await intro.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
   await intro.screenshot({path:`${OUT}/${width}-${locale}-intro.png`});
   await page.locator('.discover-demo-context').scrollIntoViewIfNeeded();await page.waitForTimeout(850);
   const row={width,locale,motion};row.demo=await page.locator('#demo').evaluate(n=>({title:n.querySelector('h2').textContent,overflow:document.documentElement.scrollWidth-innerWidth,phoneOverflow:n.querySelector('.discover-demo-phone').scrollHeight-n.querySelector('.discover-demo-phone').clientHeight,spin:getComputedStyle(n.querySelector('.discover-scan-orbit')).animationPlayState}));assert.equal(row.demo.overflow,0);assert.equal(row.demo.phoneOverflow,0);
   row.highlight=fills;
   const hardware=await page.locator('.discover-phone-hardware').evaluate(n=>({islandRight:n.querySelector('i').getBoundingClientRect().right,statusLeft:n.querySelector('.discover-phone-status').getBoundingClientRect().left,icons:n.querySelectorAll('svg').length}));assert(hardware.statusLeft>hardware.islandRight);assert.equal(hardware.icons,3);
   if(motion){assert.equal(row.demo.spin,'running');await page.locator('#demo .discover-illustration-toggle').click();assert.equal(await page.locator('#demo .discover-scan-orbit').evaluate(n=>getComputedStyle(n).animationPlayState),'paused');await page.locator('#demo .discover-illustration-toggle').click();}
   else assert.equal(await page.locator('#demo .discover-scan-orbit').evaluate(n=>getComputedStyle(n).animationName),'none');
   await page.locator('#demo').screenshot({path:`${OUT}/${width}-${locale}-demo.png`});
   await page.locator('.discover-native-task').first().click();await page.locator('.discover-demo-phone .discover-button').click();assert(await page.locator('.discover-demo-phone .discover-button').isDisabled());
   await page.locator('#questions').scrollIntoViewIfNeeded();await page.waitForTimeout(800);const items=page.locator('.discover-faq-rows details');assert.equal(await items.count(),6);await items.first().locator('summary').click();assert(await items.first().getAttribute('open')!==null);
   await items.nth(4).locator('summary').focus();await page.keyboard.press('Enter');assert(await items.nth(4).getAttribute('open')!==null);
   row.faq=await page.locator('#questions').evaluate(n=>({overflow:document.documentElement.scrollWidth-innerWidth,title:n.querySelector('h2').textContent,rows:[...n.querySelectorAll('summary')].map(e=>({w:e.clientWidth,overflow:e.scrollWidth-e.clientWidth})),color:getComputedStyle(n.querySelector('details[open] p')).color}));assert.equal(row.faq.overflow,0);assert(row.faq.rows.every(r=>r.overflow<=1));
   await page.locator('#questions').screenshot({path:`${OUT}/${width}-${locale}-faq.png`});
   await page.locator('#demo').scrollIntoViewIfNeeded();await page.waitForTimeout(200);assert.equal(await page.locator('.discover-demo-context').evaluate(n=>getComputedStyle(n).opacity),'1');assert.deepEqual(errors,[]);row.pass=true;results.push(row);
  }finally{await context.close();}
 }
});writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
