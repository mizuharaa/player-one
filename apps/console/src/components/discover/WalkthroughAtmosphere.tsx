import {useEffect,useRef} from 'react';

/** The two brand colors meet around the collector's perspective. */
export function WalkthroughAtmosphere({paused}:{paused:boolean}) {
  const art=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const node=art.current;
    const stage=node?.parentElement;
    if(!node||!stage||paused)return;
    const pointer=matchMedia('(hover: hover) and (pointer: fine)');
    const move=(event:PointerEvent)=>{
      if(!pointer.matches||event.pointerType==='touch')return;
      const bounds=stage.getBoundingClientRect();
      const x=Math.max(-1,Math.min(1,(event.clientX-bounds.left)/bounds.width*2-1));
      const y=Math.max(-1,Math.min(1,(event.clientY-bounds.top)/bounds.height*2-1));
      node.style.setProperty('--art-pointer-x',`${x*14}px`);
      node.style.setProperty('--art-pointer-y',`${y*10}px`);
    };
    const reset=()=>{
      node.style.removeProperty('--art-pointer-x');
      node.style.removeProperty('--art-pointer-y');
    };
    stage.addEventListener('pointermove',move,{passive:true});
    stage.addEventListener('pointerleave',reset);
    return()=>{stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerleave',reset);reset();};
  },[paused]);
  return <div ref={art} className="discover-walkthrough-art" aria-hidden="true">
    <div className="discover-walkthrough-orbit"/>
    <div className="discover-walkthrough-form discover-walkthrough-form--warm"><span/></div>
    <div className="discover-walkthrough-form discover-walkthrough-form--cool"><span/></div>
    <div className="discover-walkthrough-satellite discover-walkthrough-satellite--lime"/>
    <div className="discover-walkthrough-satellite discover-walkthrough-satellite--blue"/>
    <div className="discover-walkthrough-spark"><span/><span/></div>
  </div>;
}
