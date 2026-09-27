import {expect,it} from 'vitest';
import config from '../vite.config.ts';

it('serves episode pages as HTML while proxying every legacy episode API path',()=>{
  const routes=Object.keys(config.server?.proxy??{});
  const proxied=(path:string)=>routes.some(route=>route.startsWith('^')?new RegExp(route).test(path):path.startsWith(route));
  for(const page of ['/episodes','/episodes?status=resolved','/episodes/attention','/episodes/attention?batch=preview'])expect(proxied(page),page).toBe(false);
  for(const api of ['/episodes/stuck','/episodes/stuck?limit=10',...['resolve','confirm','clear','park','unpark'].map(action=>`/episodes/preview/${action}`)])expect(proxied(api),api).toBe(true);
});
