import {withBrowser,newPage} from './browser.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.env.QA_BASE||'http://127.0.0.1:5190',out='scratchpad/qa/phone-revert';mkdirSync(out,{recursive:true});
const results=[];
await withBrowser(async browser=>{
 for(const width of [320,375,1440]){
  const {page,context}=await newPage(browser,{viewport:{width,height:900}});const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('spline.design'))requests.push(r.url());});
  await page.addInitScript(()=>{localStorage.setItem('playerone.locale','en');localStorage.setItem('playerone:showcase-cookie-choice:v1','declined');});
  try{
   await page.goto(base+'/discover#demo');const phone=page.locator('.discover-demo-phone');await phone.scrollIntoViewIfNeeded();
   assert.equal(await page.locator('.discover-spline-phone').count(),0);assert.equal(await phone.locator('canvas').count(),0);assert.equal(await phone.locator('.discover-phone-status svg').count(),3);
   const layout=await phone.evaluate(n=>{const h=n.querySelector('.discover-phone-hardware'),i=h.querySelector('i').getBoundingClientRect(),s=h.querySelector('.discover-phone-status').getBoundingClientRect();return{border:getComputedStyle(n).borderLeftWidth,overflow:document.documentElement.scrollWidth-innerWidth,iconGap:s.left-i.right,innerOverflow:n.scrollHeight-n.clientHeight};});
   assert.equal(layout.overflow,0);assert(layout.iconGap>=0,JSON.stringify(layout));assert(parseFloat(layout.border)>=6);assert.equal(layout.innerOverflow,0);
   await phone.screenshot({path:`${out}/${base.startsWith('https')?'public':'local'}-${width}.png`});
   await phone.locator('.discover-native-task').first().click();await phone.locator('.discover-button').click();assert(await phone.locator('.discover-button').isDisabled());
   assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);results.push({width,layout,pass:true});
  }finally{await context.close();}
 }
});writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
