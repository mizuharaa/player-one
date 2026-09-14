import {useEffect,useRef,type RefObject} from 'react';

/** ~9 s for the whole loop. Fast enough to read as a working tool. */
export const OPERATOR_DURATIONS=[1500,2600,1300,1700,1900] as const;

const PRESS_MS=110;

/**
 * A beat is one pointer move that may end in a click.
 *
 * `move` is when the cursor leaves for the target, `travel` is how long that
 * hop takes (short hops are quicker, the way a real hand moves), `press` is
 * when the button goes down. Every `press` is at least 180 ms after
 * `move + travel`, so the cursor is visibly resting on the target before it
 * clicks, and the last release of a step lands no more than 60 ms before the
 * step advances — the screen handoff follows the click instead of racing it.
 */
type Beat={target:string;move:number;travel:number;press?:number};

const SCRIPT:readonly Beat[][]=[
  [{target:'open',move:0,travel:520,press:1330}],
  [{target:'criterion-0',move:0,travel:420,press:600},
   {target:'criterion-1',move:710,travel:260,press:1150},
   {target:'criterion-2',move:1260,travel:260,press:1700},
   {target:'next',move:1810,travel:480,press:2470}],
  [{target:'next',move:0,travel:520,press:1130}],
  [{target:'qr',move:0,travel:420},
   {target:'confirm',move:700,travel:380,press:1530}],
  [{target:'next',move:0,travel:520,press:1730}],
];

/**
 * Where a target rests, ignoring the screen handoff that is still animating.
 *
 * `getBoundingClientRect` reads the transformed box, so aiming with it during
 * an incoming slide put the cursor 64 px right of the first criterion —
 * measured. The offsetParent chain is layout only, so it gives the resting
 * position from the first frame.
 */
function restingCentre(element:HTMLElement,stop:HTMLElement){
  let x=0,y=0;
  for(let node:HTMLElement|null=element;node&&node!==stop;node=node.offsetParent as HTMLElement|null){x+=node.offsetLeft;y+=node.offsetTop;}
  return {x:x+element.offsetWidth*.5,y:y+element.offsetHeight*.55};
}

/** One clock drives the cursor, the click feedback and the screen handoff. Pause retains time. */
export function useOperatorPlayback(root:RefObject<HTMLElement|null>,step:number,running:boolean,advance:()=>void){
  const clock=useRef({step:-1,elapsed:0});
  const next=useRef(advance);next.current=advance;
  useEffect(()=>{
    const node=root.current;const window=node?.querySelector<HTMLElement>('.operator-workspace');
    const cursor=node?.querySelector<HTMLElement>('.operator-cursor');
    if(!node||!window||!cursor)return;
    if(clock.current.step!==step){
      clock.current={step,elapsed:0};
      /* Only a step change clears the ticked criteria; a pause must keep them. */
      window.querySelectorAll<HTMLElement>('[data-demo-done]').forEach(n=>{delete n.dataset.demoDone;});
    }
    if(!running)return;
    const beats=SCRIPT[step]??[];
    const duration=OPERATOR_DURATIONS[step]??1800;
    let frame=0,last=0,lastTarget='',hovered:HTMLElement|null=null,clicked:HTMLElement|null=null;
    const paint=(now:number)=>{
      const dt=last?Math.min(64,now-last):0;last=now;clock.current.elapsed+=dt;
      const elapsed=clock.current.elapsed;
      node.style.setProperty('--operator-progress',String(Math.min(1,elapsed/duration)));
      let index=0;while(index+1<beats.length&&beats[index+1]!.move<=elapsed)index++;
      const beat=beats[index];
      const element=beat?window.querySelector<HTMLElement>(`[data-demo-target="${beat.target}"]`):null;
      if(beat&&element&&beat.target!==lastTarget){
        const point=restingCentre(element,window);
        cursor.style.setProperty('--cursor-travel',`${beat.travel}ms`);
        cursor.style.setProperty('--cursor-x',`${point.x}px`);
        cursor.style.setProperty('--cursor-y',`${point.y}px`);
        lastTarget=beat.target;
      }
      const arrived=!!beat&&elapsed>=beat.move+beat.travel;
      const pressing=!!beat&&beat.press!==undefined&&elapsed>=beat.press&&elapsed<beat.press+PRESS_MS;
      const wantHover=arrived?element:null;
      if(hovered&&hovered!==wantHover){delete hovered.dataset.demoHover;hovered=null;}
      if(wantHover&&hovered!==wantHover){wantHover.dataset.demoHover='true';hovered=wantHover;}
      const wantClick=pressing?element:null;
      if(clicked&&clicked!==wantClick){delete clicked.dataset.demoClicked;clicked=null;}
      if(wantClick&&clicked!==wantClick){wantClick.dataset.demoClicked='true';clicked=wantClick;}
      cursor.dataset.pressing=String(pressing);
      /* Recomputed from elapsed, so resuming from a pause keeps the ticks. */
      for(const done of beats)if(done.press!==undefined&&done.target.startsWith('criterion-')&&elapsed>=done.press+PRESS_MS){
        const mark=window.querySelector<HTMLElement>(`[data-demo-target="${done.target}"]`);
        if(mark&&mark.dataset.demoDone!=='true')mark.dataset.demoDone='true';
      }
      if(elapsed>=duration){next.current();return;}
      frame=requestAnimationFrame(paint);
    };
    frame=requestAnimationFrame(paint);
    return()=>{
      cancelAnimationFrame(frame);
      if(hovered)delete hovered.dataset.demoHover;
      if(clicked)delete clicked.dataset.demoClicked;
      cursor.dataset.pressing='false';
    };
  },[root,step,running]);
}
