import {useEffect,type RefObject} from 'react';

/** One-shot entrances; only decorative optics track scrolling. Never hide copy. */
export function useDiscoverKinetics(root:RefObject<HTMLElement|null>){
  useEffect(()=>{
    const page=root.current;if(!page)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const active=new Set<Animation>();const seen=new WeakSet<Element>();
    const entries=[...page.querySelectorAll<HTMLElement>('[data-kinetic-entry],.discover-coverage-figure,.discover-collector-wall>figure,.discover-settings-gallery>figure')];
    const optics=[...page.querySelectorAll<HTMLElement>('[data-kinetic-pan]')];
    const perspective=page.querySelector<HTMLElement>('[data-perspective-scroll]');
    let frame=0;
    const pan=()=>{
      frame=0;if(document.hidden)return;
      if(perspective){
        const r=perspective.getBoundingClientRect();
        const progress=reduced.matches?1:Math.max(0,Math.min(1,(innerHeight*.8-r.top)/(innerHeight*.7)));
        perspective.style.setProperty('--keyword-fill',`${progress*100}%`);
      }
      if(reduced.matches)return;
      for(const node of optics){if(node.closest('[data-illustration-region]')?.getAttribute('data-illustration-active')!=='true')continue;const r=node.parentElement!.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)continue;const progress=Math.max(-1,Math.min(1,(innerHeight/2-r.top-r.height/2)/innerHeight));node.style.setProperty('--optic-pan',`${progress*48}px`);}
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(pan);};
    const observer=new IntersectionObserver(list=>{for(const entry of list){if(!entry.isIntersecting||seen.has(entry.target))continue;seen.add(entry.target);observer.unobserve(entry.target);if(reduced.matches)continue;
      const node=entry.target as HTMLElement;const horizontal=node.dataset.kineticEntry==='side';
      const animation=node.animate([{transform:`translate3d(${horizontal?24:0}px,${horizontal?0:20}px,0)`,opacity:.65},{transform:'translate3d(0,0,0)',opacity:1}],{duration:640,easing:'cubic-bezier(.16,1,.3,1)'});
      active.add(animation);animation.onfinish=()=>active.delete(animation);
    }},{threshold:.08});
    entries.forEach(node=>observer.observe(node));
    const reset=()=>{if(reduced.matches){active.forEach(a=>a.cancel());active.clear();optics.forEach(n=>n.style.removeProperty('--optic-pan'));}schedule();};
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});
    reduced.addEventListener('change',reset);schedule();
    return()=>{observer.disconnect();cancelAnimationFrame(frame);active.forEach(a=>a.cancel());window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);reduced.removeEventListener('change',reset);optics.forEach(n=>n.style.removeProperty('--optic-pan'));};
  },[root]);
}
