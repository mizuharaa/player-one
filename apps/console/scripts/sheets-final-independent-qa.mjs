import {withBrowser,newPage} from './browser.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const BASE='http://127.0.0.1:5190',OUT='scratchpad/qa/sheets-independent';
mkdirSync(OUT,{recursive:true});
const out={filters:[],date:[],errors:[],blockedWrites:[]};
const save=()=>writeFileSync(OUT+'/final-results.json',JSON.stringify(out,null,2));
async function setup(b,width,locale,role='op-1'){
  const x=await newPage(b,{viewport:{width,height:812}}),p=x.page;
  p.setDefaultTimeout(10000);p.setDefaultNavigationTimeout(15000);
  p.on('pageerror',e=>out.errors.push(String(e)));
  await p.addInitScript(l=>localStorage.setItem('playerone.locale',l),locale);
  await x.context.route('**/api/**',r=>{
    if(r.request().method()!=='GET'&&/\/api\/(payout|settle|risk)\//.test(r.request().url())){
      out.blockedWrites.push(new URL(r.request().url()).pathname);return r.abort();
    }return r.continue();
  });
  await p.goto(BASE+'/login');
  for(const[n,v]of Object.entries({machine_identifier:'HCM-01',machine_secret:'pw',external_ref:role,operator_secret:'pw'}))await p.locator(`input[name="${n}"]`).fill(v);
  await p.locator('.ops-credentials button[type="submit"]').click();
  await p.waitForSelector('.workspace-shell');return x;
}
async function drag(p,delta){const r=await p.locator('.workspace-sheet-handle').boundingBox();await p.mouse.move(r.x+r.width/2,r.y+15);await p.mouse.down();await p.mouse.move(r.x+r.width/2,r.y+15+delta,{steps:6});await p.mouse.up();}
const dialog=p=>p.getByRole('dialog');
async function closed(p){await dialog(p).waitFor({state:'detached'});}
await withBrowser(async b=>{
  for(const[width,locale]of [[320,'en'],[375,'vi'],[375,'zh'],[768,'en'],[1440,'en']]){
    const{page:p,context:c}=await setup(b,width,locale);
    await p.goto(BASE+'/episodes');await p.waitForSelector('.workspace-shell');
    const row={width,locale};console.log('filters',width,locale);
    if(width<768){
      const trigger=p.locator('.workspace-mobile-filter-bar > button').first();
      await trigger.click();await dialog(p).waitFor();
      row.modal=await dialog(p).evaluate(n=>({nativeModal:n.matches(':modal'),ariaModal:n.getAttribute('aria-modal'),focusInside:n.contains(document.activeElement),backgroundHidden:document.querySelector('#root')?.getAttribute('aria-hidden'),bodyLock:document.body.getAttribute('data-scroll-locked'),box:n.getBoundingClientRect().toJSON()}));
      assert.equal(row.modal.focusInside,true);assert(row.modal.nativeModal||row.modal.backgroundHidden==='true');
      row.tabTargets=[];for(let i=0;i<18;i++){await p.keyboard.press('Tab');const focus=await dialog(p).evaluate(n=>({inside:n.contains(document.activeElement),body:document.activeElement===document.body,tag:document.activeElement.tagName}));row.tabTargets.push(focus);assert(focus.inside||focus.body);}
      row.tabContainment=true;
      await p.locator('.workspace-sheet-filter-fields input').fill('QA_DRAFT');
      await p.keyboard.press('Escape');await closed(p);row.restore=await trigger.evaluate(n=>n===document.activeElement);assert(row.restore);
      await trigger.click();row.cancelDiscarded=await p.locator('.workspace-sheet-filter-fields input').inputValue()==='';assert(row.cancelDiscarded);
      await p.locator('.workspace-sheet-filter-fields input').fill('QA_APPLIED');await p.locator('.workspace-sheet-footer button').last().click();await closed(p);
      await trigger.click();row.applied=await p.locator('.workspace-sheet-filter-fields input').inputValue();assert.equal(row.applied,'QA_APPLIED');
      await p.locator('.workspace-sheet-footer button').first().click();row.resetDraft=await p.locator('.workspace-sheet-filter-fields input').inputValue();assert.equal(row.resetDraft,'');
      await p.locator('.workspace-sheet-footer button').last().click();await closed(p);await trigger.click();
      await p.locator('.workspace-sheet-body').hover();await p.mouse.wheel(0,240);row.bodyScrollKeepsOpen=await dialog(p).count()===1;assert(row.bodyScrollKeepsOpen);
      await drag(p,70);row.smallDragKeepsOpen=await dialog(p).count()===1;assert(row.smallDragKeepsOpen);
      await p.screenshot({path:`${OUT}/final-filters-${width}-${locale}.png`});
      await drag(p,110);await closed(p);row.largeDragCloses=true;
      row.lockRestored=await p.evaluate(()=>!document.body.hasAttribute('data-scroll-locked')&&document.querySelector('#root')?.getAttribute('aria-hidden')!=='true');assert(row.lockRestored);
    }else{row.desktopInline=await p.locator('input[type="search"]').count()>0;assert(row.desktopInline);}
    row.overflow=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.equal(row.overflow,0);out.filters.push(row);save();await c.close();
  }
  for(const width of [375,768]){
    const{page:p,context:c}=await setup(b,width,'en','fin-1');
    await p.goto(BASE+'/settle?period=2026-09-07');const row={width};console.log('date',width);
    if(width===375){
      const choose=p.getByRole('button',{name:'Choose period',exact:true});
      for(let i=0;i<3;i++){await choose.click();await dialog(p).waitFor();await p.keyboard.press('Escape');await closed(p);assert(await choose.evaluate(n=>n===document.activeElement));}
      row.threeCloseReopens=true;
      await choose.click();await dialog(p).locator('input[type="date"]').fill('2026-09-14');await p.keyboard.press('Escape');await closed(p);assert(p.url().includes('2026-09-07'));row.cancelKeepsUrl=true;
      await choose.click();row.cancelResetsDraft=await dialog(p).locator('input[type="date"]').inputValue()==='2026-09-07';assert(row.cancelResetsDraft);
      await dialog(p).locator('input[type="date"]').fill('2026-09-14');await p.screenshot({path:OUT+'/final-date-375.png'});
      await p.locator('.workspace-sheet-footer button').last().click();await closed(p);await p.waitForURL('**period=2026-09-14');row.applied=true;
    }else{await p.locator('input[type="date"]').waitFor();row.inlineDate=await p.locator('input[type="date"]').count()===1;assert(row.inlineDate);}
    row.overflow=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.equal(row.overflow,0);out.date.push(row);save();await c.close();
  }
});assert.equal(out.errors.length,0);assert.equal(out.blockedWrites.length,0);save();console.log(JSON.stringify(out,null,2));


