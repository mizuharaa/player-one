import { withBrowser, newPage } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT='scratchpad/qa/studio-fault-independent'; mkdirSync(OUT,{recursive:true});
const results={fixtureOnly:true,deadlineAcceleration:'20s/30s AbortSignal deadlines capped to 400ms; XHR terminal events injected',cases:[]};
await withBrowser(async browser=>{
 for(const mode of ['profile-hang','list-hang','timeout','error','cancel','send-throw','open-throw','login']){
  const {page,context}=await newPage(browser,{viewport:{width:1440,height:900}});page.setDefaultTimeout(8000);
  const row={mode,errors:[]};page.on('pageerror',e=>row.errors.push(e.message));
  await page.addInitScript(mode=>{
   localStorage.setItem('playerone.locale','en');window.__mode=mode;window.__counts={};window.__deadlines=[];
   const deadline=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=ms=>{window.__deadlines.push(ms);return deadline(Math.min(ms,400));};
   const nativeFetch=window.fetch.bind(window);window.fetch=(input,init={})=>{
    const url=String(input),path=new URL(url,location.href).pathname;window.__counts[path]=(window.__counts[path]??0)+1;
    const json=body=>Promise.resolve(new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}}));
    const hang=()=>new Promise((resolve,reject)=>{if(init.signal?.aborted)reject(init.signal.reason);else init.signal?.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
    if(path==='/whoami')return json({role:'operator',operator_id:'qa-id',upload_centre_id:'qa-centre'});
    if(path==='/api/operator/profile'){if(window.__mode==='profile-hang')return hang();return json({operator:{id:'qa-id',external_ref:'QA',role:'admin',status:'active',centre:{id:'qa-centre',name:'Fixture only',region:'HCM'}},activity:{days:[],total_actions:0,active_days:0,timezone:'Asia/Ho_Chi_Minh',from:'2026-06-19',to:'2026-09-10',scope:'recorded_operator_actions'}});}
    if(path==='/api/showcase/footage'){if(window.__mode==='list-hang')return hang();return json({clips:[]});}
    if(path==='/api/session'){window.__submitted=JSON.parse(init.body);return hang();}
    if(path.startsWith('/api/'))return json({});return nativeFetch(input,init);
   };
   class FixtureXHR {
    upload={};status=0;responseText='';timeout=0;
    constructor(){window.__transfer=this;}
    open(){if(window.__mode==='open-throw')throw new Error('Injected open failure');}
    setRequestHeader(){}
    send(){if(window.__mode==='send-throw')throw new Error('Injected send failure');this.upload.onprogress?.({lengthComputable:true,loaded:10,total:10});}
    abort(){this.onabort?.();}
   }
   window.XMLHttpRequest=FixtureXHR;
  },mode);
  try{
   await page.goto('http://127.0.0.1:5190/'+(mode==='login'?'login':'showcase'));
   if(mode==='login'){
    for(const [name,value]of Object.entries({machine_identifier:' QA MACHINE ',machine_secret:' inside  spaces ',external_ref:' QA OPERATOR ',operator_secret:' inside  spaces '}))await page.locator(`input[name="${name}"]`).fill(value);
    await page.locator('input[name="operator_secret"]').blur();row.blurValue=await page.locator('input[name="operator_secret"]').inputValue();
    await page.locator('.ops-credentials button[type="submit"]').click();await page.getByRole('alert').waitFor();row.submitted=await page.evaluate(()=>window.__submitted);row.retryEnabled=await page.locator('.ops-credentials button[type="submit"]').isEnabled();row.alert=await page.getByRole('alert').innerText();
    if(row.submitted.operator_secret!=='inside  spaces'||row.blurValue!=='inside  spaces'||!row.retryEnabled)throw Error('Login normalization or deadline recovery failed');
   }else if(mode.endsWith('hang')){
    await page.getByRole('button',{name:'Try again',exact:true}).waitFor();row.retryVisible=true;row.deadlines=await page.evaluate(()=>window.__deadlines);
    await page.evaluate(()=>window.__mode='success');await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('No demo clips yet.',{exact:false}).waitFor();row.recovered=true;
    if(!row.deadlines.includes(mode==='profile-hang'?20000:30000))throw Error('Wrong requested deadline');
   }else{
    await page.locator('#showcase-file').setInputFiles({name:'fixture.mp4',mimeType:'video/mp4',buffer:Buffer.from('test fixture')});await page.getByRole('button',{name:'Upload demo clip',exact:true}).click();
    if(!mode.endsWith('throw')){
     row.finalizing=await page.locator('.showcase-upload [role="status"]').innerText();if(!row.finalizing.includes('Waiting for the server'))throw Error('Missing finalizing state');
     row.xhrTimeout=await page.evaluate(()=>window.__transfer.timeout);
     if(mode==='cancel')await page.getByRole('button',{name:'Cancel upload',exact:true}).click();else await page.evaluate(mode=>window.__transfer['on'+mode]?.(),mode);
    }
    await page.locator('.showcase-upload [role="alert"]').waitFor();row.alert=await page.locator('.showcase-upload [role="alert"]').innerText();row.progressCleared=await page.locator('progress').count()===0;row.retryEnabled=await page.getByRole('button',{name:'Upload demo clip',exact:true}).isEnabled();
    row.listRequests=await page.evaluate(()=>window.__counts['/api/showcase/footage']);
    if(!row.progressCleared||!row.retryEnabled)throw Error('Upload stuck after terminal event');
    if(!mode.endsWith('throw')&&row.listRequests<2)throw Error('Missing reconciliation read');
    await page.screenshot({path:`${OUT}/${mode}.png`});
   }
   row.pass=row.errors.length===0;
  }catch(e){row.failure=e.message.split('\n')[0];row.pass=false;}
  results.cases.push(row);await context.close();
 }
});
writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.cases.some(x=>!x.pass))process.exitCode=1;
