import {useEffect,useState,type RefObject} from 'react';

/** Only decorative preparation artwork; video keeps its own explicit controls. */
export function useDiscoverIllustrationMotion(root:RefObject<HTMLElement|null>){
  const [paused,setPaused]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{
    const el=root.current;if(!el)return;
    const preference=matchMedia('(prefers-reduced-motion: reduce)');
    const regions=[...el.querySelectorAll<HTMLElement>('[data-illustration-region]')];
    const visible=new Set<Element>();
    const sync=()=>{setReduced(preference.matches);regions.forEach(region=>{region.dataset.illustrationActive=String(!paused&&!preference.matches&&!document.hidden&&visible.has(region));});};
    const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>entry.isIntersecting?visible.add(entry.target):visible.delete(entry.target));sync();},{threshold:.12});
    regions.forEach(region=>observer.observe(region));sync();
    preference.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
    return()=>{observer.disconnect();preference.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);regions.forEach(region=>delete region.dataset.illustrationActive);};
  },[root,paused]);
  return {paused,reduced,toggle:()=>setPaused(value=>!value)};
}
