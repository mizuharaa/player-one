import {withBrowser,newPage} from './browser.mjs';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const BASE='http://127.0.0.1:5190',OUT='scratchpad/qa/sheets-independent',out={cases:[],errors:[]};
const save=()=>writeFileSync(OUT+'/final-payment-results.json',JSON.stringify(out,null,2));
await withBrowser(async b=>{for(const mode of ['manual','api']){
  const {page:p,context:c}=await newPage(b,{viewport:{width:375,height:812}});p.setDefaultTimeout(10000);p.setDefaultNavigationTimeout(15000);
  p.on('pageerror',e=>out.errors.push(String(e)));await p.addInitScript(()=>localStorage.setItem('playerone.locale','en'));
  const row={mode,fixture:'Real local read-only bill; browser-only mode/preflight cache; every financial write intercepted',requests:[]};let release;
  await c.route('**/api/**',async r=>{if(r.request().method()!=='GET'&&/\/api\/(payout|settle|risk)\//.test(r.request().url())){
    row.requests.push(new URL(r.request().url()).pathname);await new Promise(resolve=>{release=resolve;setTimeout(resolve,5000);});
    return r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'QA intercepted; no payment submitted'})});
  }return r.continue();});
  await p.goto(BASE+'/login');for(const[n,v]of Object.entries({machine_identifier:'HCM-01',machine_secret:'pw',external_ref:'fin-1',operator_secret:'pw'}))await p.locator(`input[name="${n}"]`).fill(v);
  await p.locator('.ops-credentials button[type="submit"]').click();await p.waitForSelector('.workspace-shell');
  const bill=await p.evaluate(async()=>{const b=await(await fetch('/api/payout/batches/2026-09-07')).json();return b.bills.find(x=>!x.paid);});assert(bill);
  await p.goto(BASE+`/settle/bills/${bill.id}?period=2026-09-07`);const open=p.getByRole('button',{name:'Review payment details',exact:true});await open.waitFor();
  row.fixtureReady=await p.evaluate(async mode=>{
    const el=document.querySelector('#root'),key=Object.keys(el).find(k=>k.startsWith('__reactContainer$'));let root=el[key];root=root?.stateNode?.current??root;const stack=[root],seen=new Set();let client;
    while(stack.length){const n=stack.pop();if(!n||seen.has(n))continue;seen.add(n);if(n.memoizedProps?.client?.getQueryCache){client=n.memoizedProps.client;break;}stack.push(n.child,n.sibling,n.alternate);}if(!client)return false;
    const{batchFingerprint}=await import('/src/payout/gate.ts');const batch=client.getQueryData(['payout','batch','2026-09-07']);client.setQueryData(['payout','batch','2026-09-07'],{...batch,mode});client.setQueryData(['payout','preflight','2026-09-07'],{fingerprint:batchFingerprint(batch.bills),ok:true,mode});return true;
  },mode);assert(row.fixtureReady);console.log('payment fixture',mode);
  await open.click();const dialog=p.getByRole('dialog'),ref=dialog.locator('input[name="reference"]'),amount=dialog.locator('input[name="amount"]');
  const submit=mode==='manual'?dialog.locator('form button[type="submit"]'):dialog.locator('.workspace-payment-actions button').nth(1);
  row.emptyDisabled=await submit.isDisabled();assert(row.emptyDisabled);
  await amount.fill(String(Number(bill.amount_vnd)+1));row.wrongAmountDisabled=await submit.isDisabled();assert(row.wrongAmountDisabled);
  await amount.fill(String(bill.amount_vnd));if(mode==='manual'){row.missingReferenceDisabled=await submit.isDisabled();assert(row.missingReferenceDisabled);await ref.fill('QA_INTERCEPT_ONLY');}
  row.figuresMatch=await dialog.locator('.workspace-sheet-payment-summary').evaluate((n,b)=>n.textContent.includes(b.collector_ref)&&n.textContent.includes(b.currency),bill);assert(row.figuresMatch);
  await p.keyboard.press('Escape');row.dirtyEscapeBlocked=await dialog.count()===1;assert(row.dirtyEscapeBlocked);
  await p.mouse.click(2,2);row.dirtyBackdropBlocked=await dialog.count()===1;assert(row.dirtyBackdropBlocked);
  row.closeDisabled=await dialog.locator('.workspace-sheet-header button').isDisabled();assert(row.closeDisabled);assert.equal(await dialog.locator('.workspace-sheet-handle').count(),0);
  await dialog.screenshot({path:`${OUT}/final-payment-dirty-${mode}.png`});await p.getByRole('button',{name:'Cancel entry',exact:true}).click();await dialog.waitFor({state:'detached'});
  row.cancelRestoresFocus=await open.evaluate(n=>n===document.activeElement);assert(row.cancelRestoresFocus);
  await open.click();row.cancelCleared=await amount.inputValue()===''&&await ref.inputValue()==='';assert(row.cancelCleared);
  await amount.fill(String(bill.amount_vnd));if(mode==='manual')await ref.fill('QA_INTERCEPT_ONLY');await submit.click();
  await p.waitForTimeout(150);await p.keyboard.press('Escape');await p.mouse.click(2,2);
  row.pendingBlocked=await dialog.count()===1&&await ref.isDisabled()&&await amount.isDisabled()&&await p.getByRole('button',{name:'Cancel entry',exact:true}).isDisabled()&&await submit.isDisabled();assert(row.pendingBlocked);
  await dialog.screenshot({path:`${OUT}/final-payment-pending-${mode}.png`});release?.();await p.getByRole('button',{name:'Cancel entry',exact:true}).waitFor();
  await p.waitForFunction(()=>[...document.querySelectorAll('.workspace-sheet button')].some(n=>n.textContent==='Cancel entry'&&!n.disabled));
  row.errorVisible=await dialog.getByRole('alert').filter({hasText:'The server refused that change.'}).count()===1;assert(row.errorVisible);assert.equal(row.requests.length,1);assert(row.requests[0].endsWith(mode==='manual'?'/mark-paid':'/pay'));
  await p.getByRole('button',{name:'Cancel entry',exact:true}).click();await dialog.waitFor({state:'detached'});row.closedAfterError=true;
  out.cases.push(row);save();await c.close();
}});assert.equal(out.errors.length,0);save();console.log(JSON.stringify(out,null,2));


