/** Run only after root releases the browser lane and confirms the deployed build. */
import {withBrowser,newPage} from './browser.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const BASE='https://playerone-web-production.up.railway.app';
const OUT='scratchpad/qa/showcase-production';
const fixture='scratchpad/qa/warm-independent/qa-demo.mp4';
const data=readFileSync(fixture);
if(data.length===0||data.length>20*1024*1024||data.toString('ascii',4,8)!=='ftyp')throw Error('Invalid bounded synthetic fixture');
const build=process.argv[process.argv.indexOf('--build')+1];
if(!process.argv.includes('--execute')){console.log('Prepared only. After release: node apps/console/scripts/showcase-production-qa.mjs --execute --build <deployment-id>');process.exit(0);}
if(!process.argv.includes('--build')||!build||build.startsWith('--'))throw Error('Provide reviewed deployed build id');
const cfg=JSON.parse(readFileSync('scratchpad/local-demo/showcase-login.private.json','utf8'));
const out={build,base:BASE,fixture:{name:'qa-demo.mp4',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')},checks:{},errors:[]};
mkdirSync(OUT,{recursive:true});
const check=(name,ok,details)=>{out.checks[name]={ok,...details};if(!ok)throw Error('Check failed: '+name);};
let failed=false;
try{
 await withBrowser(async browser=>{
  const {page:p,context}=await newPage(browser,{viewport:{width:1440,height:900}});
  p.on('pageerror',error=>{out.errors.push('Browser rendering error: '+error.message.split('\n')[0]);failed=true;});
  p.setDefaultTimeout(15000);p.setDefaultNavigationTimeout(30000);
  let id=null,loggedIn=false;
  const api=(path,options={})=>context.request.fetch(BASE+path,{timeout:15000,...options});
  try{
   await p.addInitScript(()=>localStorage.setItem('playerone.locale','en'));
   await p.goto(BASE+'/login');
   for(const [name,value]of Object.entries({machine_identifier:cfg.machine.identifier,machine_secret:cfg.machine.secret,external_ref:cfg.administrator.externalRef,operator_secret:cfg.administrator.secret}))await p.locator(`input[name="${name}"]`).fill(value);
   const login=p.waitForResponse(r=>r.url().endsWith('/api/session')&&r.request().method()==='POST');
   await p.locator('.ops-credentials button[type="submit"]').click();const loginStatus=(await login).status();loggedIn=loginStatus===200;check('login',loggedIn,{status:loginStatus});
   await p.waitForSelector('.workspace-shell');await p.goto(BASE+'/showcase');await p.waitForSelector('#showcase-file');
   await p.locator('#showcase-file').setInputFiles({name:'qa-demo.mp4',mimeType:'video/mp4',buffer:data});
   const upload=p.waitForResponse(r=>r.url().includes('/api/showcase/footage?')&&r.request().method()==='POST',{timeout:45000});
   await p.getByRole('button',{name:'Upload demo clip',exact:true}).click();
   const response=await upload;const uploaded=await response.json();id=uploaded.clip?.id??null;
   check('upload',response.status()===201&&typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id),{status:response.status()});out.clipId=id;
   const video=p.locator('.showcase-review video');await video.waitFor();await p.waitForFunction(id=>document.querySelector('.showcase-review video')?.getAttribute('src')===`/api/showcase/footage/${id}/media`,id);
   await video.evaluate(async node=>{node.muted=true;await node.play();});
   await p.waitForFunction(()=>{const v=document.querySelector('.showcase-review video');return v&&!v.paused&&v.currentTime>0.2;});
   const playback=await video.evaluate(v=>({time:v.currentTime,duration:v.duration,readyState:v.readyState,error:v.error?.code??null}));check('playback',playback.time>0.2&&playback.duration>1&&!playback.error,playback);
   await video.evaluate(v=>{v.pause();v.currentTime=Math.min(1.2,v.duration/2);});
   await p.waitForFunction(()=>{const v=document.querySelector('.showcase-review video');return v&&!v.seeking&&v.currentTime>0.4;});
   check('seek',true,await video.evaluate(v=>({time:v.currentTime,seeking:v.seeking})));
   const range=await api(`/api/showcase/footage/${id}/media`,{headers:{Range:'bytes=4-7'}});const bytes=await range.body();check('range',range.status()===206&&bytes.toString('ascii')==='ftyp'&&range.headers()['content-range']===`bytes 4-7/${data.length}`,{status:range.status(),contentRange:range.headers()['content-range'],bytes:bytes.length});
   const {context:guest}=await newPage(browser,{viewport:{width:375,height:812}});
   try{const denied=await guest.request.get(BASE+`/api/showcase/footage/${id}/media`,{timeout:15000});check('unauthenticatedMedia',denied.status()===401,{status:denied.status()});}finally{await guest.close();}
   const note='Production showcase QA: synthetic test pattern; demonstration decision only.';
   await p.locator('.showcase-review select').selectOption('partial');await p.locator('.showcase-review textarea').fill(note);
   const review=p.waitForResponse(r=>r.url().endsWith(`/footage/${id}/review`)&&r.request().method()==='POST');await p.getByRole('button',{name:'Save demo decision',exact:true}).click();check('review',(await review).status()===200,{});
   await p.getByText('Demo decision saved',{exact:true}).waitFor();await p.reload();await p.locator('.showcase-clip').filter({hasText:'qa-demo.mp4'}).first().waitFor();
   // Identify the exact newly created clip, never a pre-existing same-name clip.
   const list=await (await api('/api/showcase/footage')).json();const index=list.clips.findIndex(c=>c.id===id);check('persistedRecord',index>=0&&list.clips[index].verdict==='partial'&&list.clips[index].note===note,{});
   await p.locator('.showcase-clip').nth(index).click();check('persistedUI',await p.locator('.showcase-review select').inputValue()==='partial'&&await p.locator('.showcase-review textarea').inputValue()===note,{});
   await p.screenshot({path:OUT+'/desktop.png'});await p.setViewportSize({width:375,height:812});await p.screenshot({path:OUT+'/mobile.png'});check('mobileOverflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),{});
   const deletion=p.waitForResponse(r=>r.url().endsWith(`/footage/${id}`)&&r.request().method()==='DELETE');await p.getByRole('button',{name:'Delete clip',exact:true}).click();check('uiDelete',(await deletion).status()===204,{});
  }finally{
   try{if(id){const cleanup=await api(`/api/showcase/footage/${id}`,{method:'DELETE',headers:{'X-Showcase-Request':'1'}});const gone=await api(`/api/showcase/footage/${id}/media`);check('cleanup',[204,404].includes(cleanup.status())&&gone.status()===404,{deleteStatus:cleanup.status(),mediaStatus:gone.status()});}}
   finally{try{if(loggedIn){const logout=await api('/api/session',{method:'DELETE',headers:{Accept:'application/json'}});const denied=await api('/api/showcase/footage');check('logout',logout.ok()&&denied.status()===401,{status:logout.status(),afterStatus:denied.status(),remainingCookies:(await context.cookies()).length});}}finally{await context.close();}}
  }
 });
}catch(error){failed=true;out.errors.push(error instanceof Error?error.message.split('\n')[0]:'QA failed');}
finally{out.passed=!failed;writeFileSync(OUT+'/results.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));}
if(failed)process.exitCode=1;
