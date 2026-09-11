import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createShowcaseServer } from './http-server.mjs';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
const close=s=>new Promise(r=>{s.closeAllConnections();s.close(r);});
test('independent deploy browser policy on SPA, API, media and errors',async()=>{
 const api=createServer((req,res)=>{res.writeHead(401,{'content-type':'application/json'});res.end('{"error":"unauthorized"}');});
 const apiPort=await listen(api);const web=await createShowcaseServer({distDir:'apps/console/dist',apiPort,secure:true});const port=await listen(web);
 try{for(const path of ['/login','/discover','/api/operator/profile','/assets/missing.js','/.env']){
  const res=await fetch(`http://127.0.0.1:${port}${path}`);const policy=res.headers.get('content-security-policy');
  for(const directive of ["script-src 'self'","object-src 'none'","base-uri 'none'","frame-ancestors 'none'","form-action 'self'"])assert.ok(policy.includes(directive),path+': '+directive);
  const scriptSources=policy.split('script-src')[1].split(';')[0].trim().split(/\s+/);
  assert.ok(!scriptSources.includes("'unsafe-inline'"));assert.ok(!scriptSources.includes("'unsafe-eval'"));
  assert.ok(!scriptSources.includes("'wasm-unsafe-eval'"));
  assert.ok(!policy.includes('spline.design'));
  assert.equal(res.headers.get('x-frame-options'),'DENY');assert.equal(res.headers.get('x-content-type-options'),'nosniff');assert.ok(res.headers.get('strict-transport-security').includes('max-age=31536000'));
  await res.arrayBuffer();
 }}finally{await close(web);await close(api);}
});
