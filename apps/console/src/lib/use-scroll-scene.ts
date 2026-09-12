import {useEffect,useState,type RefObject} from 'react';

/** Native scrolling with a bounded easing tail. Never cancels wheel/touch input. */
export function useScrollScene(root:RefObject<HTMLElement|null>,enabled=true){
  const [pinned,setPinned]=useState(false);
  const [step,setStep]=useState(0);
  useEffect(()=>{
    const node=root.current;if(!node)return;
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const space=matchMedia('(min-width: 900px) and (min-height: 720px)');
    let frame=0,shown=0,target=0,last=0,active=false;
    const draw=(now:number)=>{
      frame=0;if(!active||document.hidden)return;
      const dt=Math.min(48,now-(last||now-16));last=now;
      shown+=(target-shown)*(1-Math.exp(-dt/95));
      if(Math.abs(target-shown)<.0005)shown=target;
      node.style.setProperty('--scene-progress',shown.toFixed(5));
      node.style.setProperty('--phone-turn',`${(1-Math.min(1,shown*5))*14}deg`);
      node.style.setProperty('--phone-lean',`${(1-Math.min(1,shown*5))*-5}deg`);
      setStep(Math.min(3,Math.floor(shown*4)));
      if(shown!==target)frame=requestAnimationFrame(draw);else last=0;
    };
    const measure=()=>{
      if(!active||document.hidden)return;
      const bounds=node.getBoundingClientRect();
      target=Math.max(0,Math.min(1,-bounds.top/Math.max(1,node.offsetHeight-innerHeight)));
      if(!frame)frame=requestAnimationFrame(draw);
    };
    const sync=()=>{
      active=enabled&&space.matches&&!motion.matches;setPinned(active);
      node.dataset.scenePinned=String(active);
      if(!active){cancelAnimationFrame(frame);frame=0;node.style.removeProperty('--phone-turn');node.style.removeProperty('--phone-lean');}
      else measure();
    };
    sync();window.addEventListener('scroll',measure,{passive:true});window.addEventListener('resize',sync);motion.addEventListener('change',sync);space.addEventListener('change',sync);document.addEventListener('visibilitychange',measure);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',measure);window.removeEventListener('resize',sync);motion.removeEventListener('change',sync);space.removeEventListener('change',sync);document.removeEventListener('visibilitychange',measure);delete node.dataset.scenePinned;};
  },[root,enabled]);
  return {pinned,step};
}
