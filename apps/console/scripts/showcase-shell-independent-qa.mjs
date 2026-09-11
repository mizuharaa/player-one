import {withBrowser,newPage} from './browser.mjs';
import {writeFileSync} from 'node:fs';
const BASE='http://127.0.0.1:5190',OUT='scratchpad/qa/showcase-independent';
const output={fixtureOnly:true,requests:[],shell:[],login:[]};
await withBrowser(async browser=>{
for(const role of ['operator','reviewer']){
 const {context,page}=await newPage(browser,{viewport:{width:1440,height:900}});let signed=false;let failure='mismatch';
 await context.route('**/*',async route=>{const req=route.request(),p=new URL(req.url()).pathname;
 if(p==='/api/session'){output.requests.push({method:req.method(),path:p,body:req.postDataJSON()});if(failure)return route.fulfill({status:401,json:{reason:failure}});signed=true;return route.fulfill({json:{role}});}
 if(p==='/whoami')return route.fulfill({status:signed?200:401,json:{role}});
 if(p.startsWith('/api/')||p.startsWith('/reference'))return route.fulfill({status:503,json:{reason:'qa_fixture_unavailable',ref:'QA-FIXTURE'}});
 return route.continue();});
 await page.goto(`${BASE}/login`);await page.waitForSelector('.ops-credentials');if(role==='reviewer')await page.locator('label').filter({has:page.locator('input[value="reviewer"]')}).click();for(const e of await page.locator('.ops-credentials input:not([type="radio"])').all())await e.fill('qa-placeholder');
 await page.locator('button[type="submit"]').click();await page.waitForSelector('[role="alert"]');const mismatch=await page.locator('[role="alert"]').textContent();failure='sign_in_rate_limited';await page.locator('button[type="submit"]').click();await page.waitForTimeout(150);const limited=await page.locator('[role="alert"]').textContent();failure=null;await page.locator('button[type="submit"]').click();await page.waitForSelector('.ops-shell');output.login.push({role,mismatch,limited,path:new URL(page.url()).pathname});await context.close();
}
for(const width of [375,768,1440,1920]){
 const {context,page}=await newPage(browser,{viewport:{width,height:900},storageState:{cookies:[],origins:[{origin:BASE,localStorage:[{name:'playerone.locale',value:width===375?'vi':width===768?'zh':'en'},{name:'playerone.guide.seen',value:'1'}]}]}});
 await context.route('**/*',route=>{const p=new URL(route.request().url()).pathname;if(p==='/whoami')return route.fulfill({json:{role:'operator'}});if(p.startsWith('/api/')||p.startsWith('/reference')||p.startsWith('/handovers')||p.startsWith('/upload-batches'))return route.fulfill({status:503,json:{reason:'qa_fixture_unavailable',ref:'QA-FIXTURE'}});return route.continue();});
 await page.goto(`${BASE}/`);await page.waitForSelector('.ops-shell');await page.waitForTimeout(300);const row={width,overflow:await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),errors:await page.locator('[role="alert"]').allTextContents()};
 if(width<960){const trigger=page.locator('button[aria-controls="workspace-navigation"]');await trigger.focus();await page.keyboard.press('Enter');row.open=await page.evaluate(()=>({modal:document.querySelector('#workspace-navigation').matches(':modal'),focusIn:!!document.activeElement.closest('#workspace-navigation')}));await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');row.focusContained=await page.evaluate(()=>!!document.activeElement.closest('#workspace-navigation'));await page.keyboard.press('Escape');row.closed=await page.evaluate(()=>({closed:!document.querySelector('#workspace-navigation').open,focusReturned:document.activeElement.matches('button[aria-controls="workspace-navigation"]')}));await trigger.click();}
 row.links=await page.locator('.ops-shell-nav a').evaluateAll(es=>es.map(e=>({href:e.getAttribute('href'),text:e.textContent,current:e.getAttribute('aria-current')})));await page.screenshot({path:`${OUT}/shell-${width}.png`});
 await page.locator('.ops-shell-nav a[href="/episodes"]').click();await page.waitForURL('**/episodes');row.destination=await page.locator('.ops-shell').count();row.current=await page.locator('.ops-shell-nav a[aria-current="page"]').getAttribute('href').catch(()=>null);
 if(width<960){await page.locator('button[aria-controls="workspace-navigation"]').click();await page.setViewportSize({width:1100,height:900});row.resizeClosed=await page.locator('#workspace-navigation').count()===0;}
 await page.locator('.ops-skip').focus();await page.keyboard.press('Enter');row.skipFocus=await page.evaluate(()=>document.activeElement.id);await context.close();output.shell.push(row);
}
});
writeFileSync(`${OUT}/shell-results.json`,JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));

