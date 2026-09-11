import {withBrowser,newPage} from './browser.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.env.QA_BASE||'http://127.0.0.1:5190';
const out='scratchpad/qa/kinetic-release';mkdirSync(out,{recursive:true});
const results=[];
await withBrowser(async browser=>{
 for(const width of [1440,375]){
  const {page,context}=await newPage(browser,{viewport:{width,height:900},motion:true});
  try{
   await page.addInitScript(()=>localStorage.setItem('playerone.locale','en'));
   await page.goto(base+'/discover#questions');
   const control=page.locator('#questions .discover-illustration-toggle');await control.scrollIntoViewIfNeeded();await page.waitForTimeout(750);
   assert.equal(await page.locator('#questions .discover-scan-orbit').evaluate(n=>getComputedStyle(n).animationPlayState),'running');
   const color=await control.evaluate(n=>({fg:getComputedStyle(n).color,bg:getComputedStyle(n).backgroundColor}));assert.equal(color.fg,'rgb(53, 39, 31)');
   await control.click();assert.equal(await page.locator('#questions .discover-scan-orbit').evaluate(n=>getComputedStyle(n).animationPlayState),'paused');
   await control.click();assert.equal(await page.locator('#questions .discover-scan-orbit').evaluate(n=>getComputedStyle(n).animationPlayState),'running');
   await page.locator('#introduction').scrollIntoViewIfNeeded();await page.waitForTimeout(750);assert.equal(await page.locator('#questions').getAttribute('data-illustration-active'),'false');
   const layout=await page.locator('#introduction').evaluate(n=>{const r=e=>{const a=e.getBoundingClientRect();return{left:a.left,right:a.right,top:a.top,bottom:a.bottom}};return{copy:r(n.querySelector('.discover-aperture-copy')),image:r(n.querySelector('figure')),overflow:document.documentElement.scrollWidth-innerWidth}});
   assert.equal(layout.overflow,0);if(width>1100){assert(layout.image.left>layout.copy.right);assert(Math.abs((layout.copy.top+layout.copy.bottom-layout.image.top-layout.image.bottom)/2)<2);}else assert(layout.image.top>layout.copy.bottom);
   await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);assert.equal(await page.locator('#introduction').evaluate(n=>n.style.getPropertyValue('--keyword-fill')),'100%');
   await page.locator('#demo').scrollIntoViewIfNeeded();await page.waitForTimeout(150);assert.equal(await page.locator('#demo .discover-scan-orbit').evaluate(n=>getComputedStyle(n).animationName),'none');
   results.push({width,color,layout,pass:true});
  }finally{await context.close();}
 }
});writeFileSync(out+'/results.json',JSON.stringify({base,results},null,2));console.log(JSON.stringify(results));
