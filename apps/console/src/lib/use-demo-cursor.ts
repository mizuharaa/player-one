import {useEffect,useRef,type RefObject} from 'react';

/**
 * The hero demo's pointer: a scripted hand with weight.
 *
 * The previous version drove the cursor with a CSS transition on a `linear()`
 * curve and set `--cursor-x/y` per beat. That reads as a tween because it is
 * one: every hop starts at rest, travels a fixed authored duration and stops
 * dead, so a short hop and a long one take the same time and nothing carries
 * momentum between them. The owner's word for the result was "the buttons
 * clicking" — mechanical.
 *
 * So the position is integrated instead. One critically-damped-ish spring per
 * axis, chasing a target the script moves; a long hop overshoots slightly and
 * settles, a short one barely does, and the arrival is the spring's own rather
 * than a number somebody typed. Same integrator as `use-discover-nav`'s dock
 * — fixed substeps, clamped catch-up — and deliberately not that hook itself:
 * that one springs a single scalar toward a *pointer-derived* fraction and
 * owns the dock's collapse state. Two axes and a script share the arithmetic,
 * not the mechanism.
 *
 * **`stiffness 120, damping 22, mass 1`** → ω = 11.0 rad/s, ζ = 1.00. Heavier
 * and slower than the dock's (280/24, ζ 0.72): the dock has to finish before a
 * pointer arrives, while this one IS the pointer and reads as a hand. At ζ 1
 * it does not overshoot a control and click beside it, which a bouncier
 * setting does on the short hops between the three criteria. Measured on the
 * integrator itself: a 300px hop covers 95% of its distance in 450ms and is
 * fully at rest by 1.4s — the long tail is the last few pixels, which is why
 * every press in the script sits at least 400ms after its move.
 *
 * **Panning uses the same spring.** The scroll offset inside the window is a
 * third axis on the same integrator, so the content glides with the pointer's
 * weight instead of a second easing curve nobody tuned.
 *
 * Nothing here is React state: the loop writes custom properties and data
 * attributes. A per-frame `setState` would re-render the whole demo sixty
 * times a second to move one element.
 */
const STIFFNESS=120,DAMPING=22,SUBSTEP=1/120;

/** Zoom's own spring: softer, so the footage settles rather than arrives. */
const ZOOM_STIFFNESS=64,ZOOM_DAMPING=16;

/** How long the button stays visibly pressed. Matches the CSS `:active` beat. */
export const PRESS_MS=120;

/**
 * One action: move to a control, rest on it, press it.
 *
 * `at` is when the hand leaves for the target and `press` when the button goes
 * down, both measured from the start of the step. The gap between them is the
 * pause that makes this read as a person rather than a cursor teleporting into
 * a click — the script keeps every one of them between 400 and 900 ms.
 *
 * `click` is the handler a real click would run. The scripted press calls the
 * element's own `click()`, so there is exactly one code path: whatever a
 * visitor's mouse does, the hand does.
 */
export type Beat={target:string;at:number;press?:number};

export type Scene={
  /** Beats for this step, in order. */
  beats:readonly Beat[];
  /** How long the step lasts before the demo advances. */
  duration:number;
  /** Scroll offset inside the window, in px, sprung. */
  pan?:number;
  /** 1.06 while the demo is looking at the footage; 1 everywhere else. */
  zoom?:number;
};

type Axis={value:number;velocity:number;target:number};
const axis=(value:number):Axis=>({value,velocity:0,target:value});

function integrate(a:Axis,dt:number,stiffness:number,damping:number){
  for(let left=dt;left>0;left-=SUBSTEP){
    const h=Math.min(SUBSTEP,left);
    a.velocity+=(-stiffness*(a.value-a.target)-damping*a.velocity)*h;
    a.value+=a.velocity*h;
  }
}
const resting=(a:Axis)=>Math.abs(a.target-a.value)<.05&&Math.abs(a.velocity)<.05;

/**
 * Where a control rests, ignoring a cross-fade that may still be running.
 *
 * `getBoundingClientRect` reads the transformed box, so aiming with it during
 * an incoming state put the cursor 64px right of the first criterion — that
 * was measured on the previous build and the fault survives any change of
 * transition. The offsetParent chain is layout only, so it gives the resting
 * position from the first frame.
 */
function restingCentre(element:HTMLElement,stop:HTMLElement){
  let x=0,y=0;
  for(let node:HTMLElement|null=element;node&&node!==stop;node=node.offsetParent as HTMLElement|null){x+=node.offsetLeft;y+=node.offsetTop;}
  return {x:x+element.offsetWidth*.5,y:y+element.offsetHeight*.5};
}

/**
 * Drive the cursor, the pan and the zoom for one step.
 *
 * `advance` is called once the step's duration elapses. Pausing keeps the
 * elapsed time, so resuming continues the beat rather than restarting it.
 */
export function useDemoCursor(
  root:RefObject<HTMLElement|null>,
  step:number,
  running:boolean,
  scenes:readonly Scene[],
  advance:()=>void,
){
  const clock=useRef({step:-1,elapsed:0});
  const next=useRef(advance);next.current=advance;
  useEffect(()=>{
    const node=root.current;
    const frame=node?.querySelector<HTMLElement>('.operator-window-content');
    const cursor=node?.querySelector<HTMLElement>('.operator-cursor');
    const scene=scenes[step];
    if(!node||!frame||!cursor||!scene)return;
    if(clock.current.step!==step)clock.current={step,elapsed:0};
    if(!running)return;

    const x=axis(cursor.offsetLeft||frame.offsetWidth*.62);
    const y=axis(cursor.offsetTop||frame.offsetHeight*.5);
    /* Seed from the last painted position so a step change continues the
       motion rather than snapping the hand back to an origin. */
    const seeded=cursor.dataset.x&&cursor.dataset.y;
    if(seeded){x.value=Number(cursor.dataset.x);y.value=Number(cursor.dataset.y);}
    x.target=x.value;y.target=y.value;
    const pan=axis(Number(frame.dataset.pan??0));
    const zoom=axis(Number(frame.dataset.zoom??1));
    pan.target=scene.pan??0;
    zoom.target=scene.zoom??1;

    let raf=0,last=0,aimed='',pressed:HTMLElement|null=null,fired=-1,rides=false;
    const paint=(now:number)=>{
      const dt=last?Math.min(.064,(now-last)/1000):0;last=now;
      clock.current.elapsed+=dt*1000;
      const elapsed=clock.current.elapsed;

      /* The beat whose `at` has passed. */
      let index=-1;
      for(let i=0;i<scene.beats.length;i+=1)if(scene.beats[i]!.at<=elapsed)index=i;
      const beat=index>=0?scene.beats[index]:undefined;
      const element=beat?frame.querySelector<HTMLElement>(`[data-demo-target="${beat.target}"]`):null;
      if(beat&&element&&beat.target!==aimed){
        const point=restingCentre(element,frame);
        x.target=point.x;y.target=point.y;
        aimed=beat.target;
        /* The panned region moves under the cursor, and `restingCentre` reads
           layout, which the pan's transform does not touch. A control inside it
           has to be followed, or the hand sits where the button used to be. */
        rides=!!element.closest('.operator-display');
      }

      integrate(x,dt,STIFFNESS,DAMPING);
      integrate(y,dt,STIFFNESS,DAMPING);
      integrate(pan,dt,STIFFNESS,DAMPING);
      integrate(zoom,dt,ZOOM_STIFFNESS,ZOOM_DAMPING);

      cursor.style.setProperty('--cursor-x',`${x.value.toFixed(1)}px`);
      cursor.style.setProperty('--cursor-y',`${(y.value-(rides?pan.value:0)).toFixed(1)}px`);
      cursor.dataset.x=String(x.value);cursor.dataset.y=String(y.value);
      frame.style.setProperty('--pan',`${(-pan.value).toFixed(1)}px`);
      frame.style.setProperty('--zoom',zoom.value.toFixed(4));
      frame.dataset.pan=String(pan.value);frame.dataset.zoom=String(zoom.value);

      /* The press, and the click it performs. The element's own handler runs —
         the scripted hand and a visitor's mouse take the same path. */
      const pressing=!!beat?.press&&elapsed>=beat.press&&elapsed<beat.press+PRESS_MS;
      if(pressing&&element&&fired!==index){fired=index;element.click();}
      const want=pressing?element:null;
      if(pressed&&pressed!==want){delete pressed.dataset.demoPress;pressed=null;}
      if(want&&pressed!==want){want.dataset.demoPress='true';pressed=want;}
      cursor.dataset.pressing=String(pressing);

      if(elapsed>=scene.duration){next.current();return;}
      raf=requestAnimationFrame(paint);
    };
    raf=requestAnimationFrame(paint);
    return()=>{
      cancelAnimationFrame(raf);
      if(pressed)delete pressed.dataset.demoPress;
      cursor.dataset.pressing='false';
      /* Park the springs where they stopped: `resting` is what tells a test
         the hand has settled, and a half-integrated axis left behind would
         make the next step start from a velocity nobody applied. */
      if(resting(x)&&resting(y))cursor.dataset.settled='true';
      else delete cursor.dataset.settled;
    };
  },[root,step,running,scenes]);
}
