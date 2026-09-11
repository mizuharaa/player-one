import {withBrowser,newPage} from './browser.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
// Reuse the existing rendered glyph-difference measurement; never launch its broad sweep.
const source=readFileSync(new URL('./contrast.mjs',import.meta.url),'utf8').replace("el.style.color = 'transparent';","el.style.setProperty('color','transparent','important');");
const {inkRatio}=await import('data:text/javascript;base64,'+Buffer.from(source.slice(source.indexOf('const lin ='),source.indexOf('const TEXT ='))+'\nexport {inkRatio};').toString('base64'));
const BASE='http://127.0.0.1:5190',out=[];
if(process.argv[2]==='help'){
await withBrowser(async browser=>{for(const theme of ['light','dark']){const {context,page}=await newPage(browser,{viewport:{width:1440,height:900}});await page.goto(`${BASE}/discover`);await page.waitForSelector('.discover-page');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.locator('.discover-cookie-actions button').nth(1).click();await page.locator('.discover-truc-copy button').click();await page.mouse.move(0,0);await page.waitForTimeout(500);out.push({theme,label:'help action rest',...await inkRatio(page,'.discover-truc-copy button')});await page.locator('.discover-truc-copy button').hover();await page.waitForTimeout(500);out.push({theme,label:'help action hover',...await inkRatio(page,'.discover-truc-copy button')});await context.close();}});writeFileSync('scratchpad/qa/showcase-independent/contrast-help-results.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));process.exit(0);
}
await withBrowser(async browser=>{
for(const theme of ['light','dark']){
const {context,page}=await newPage(browser,{viewport:{width:1440,height:900},storageState:{cookies:[],origins:[{origin:BASE,localStorage:[{name:'playerone.theme',value:theme},{name:'playerone.locale',value:'en'}]}]}});
await context.route('**/whoami',r=>r.fulfill({json:{role:'operator'}}));await context.route('**/api/**',r=>new URL(r.request().url()).pathname.startsWith('/api/')?r.fulfill({status:503,json:{reason:'qa_fixture_unavailable'}}):r.continue());
await page.goto(`${BASE}/login`);await page.waitForSelector('.ops-credentials');for(const [label,selector,index] of [['role selected','.ops-credentials label:has(input[type="radio"])',0],['role unselected','.ops-credentials label:has(input[type="radio"])',1],['sign in','button[type="submit"]',0]])out.push({theme,label,...await inkRatio(page,selector,index)});
await page.goto(`${BASE}/`);await page.waitForSelector('.ops-shell');out.push({theme,label:'shell current navigation',...await inkRatio(page,'.ops-shell-nav a[aria-current="page"] span')});out.push({theme,label:'shell inactive navigation',...await inkRatio(page,'.ops-shell-nav a[href="/counter"] span')});
await page.goto(`${BASE}/discover`);await page.waitForSelector('.discover-page');out.push({theme,label:'cookie accept',...await inkRatio(page,'.discover-cookie-actions button',0)});out.push({theme,label:'cookie decline',...await inkRatio(page,'.discover-cookie-actions button',1)});await page.locator('.discover-cookie-actions button').nth(1).click();await page.locator('.discover-truc-copy button').click();out.push({theme,label:'help action',...await inkRatio(page,'.discover-truc-copy button')});out.push({theme,label:'help selected answer',...await inkRatio(page,'.discover-truc-options button[aria-pressed="true"]')});out.push({theme,label:'help body',...await inkRatio(page,'.discover-truc-copy>p:not(.discover-eyebrow)')});await context.close();
}
});writeFileSync('scratchpad/qa/showcase-independent/contrast-results.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));

