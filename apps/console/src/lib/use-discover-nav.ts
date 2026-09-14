import {useEffect,useRef,useState,type RefObject} from 'react';

/**
 * The `/discover` dock's open fraction, sprung.
 *
 * The requirement is one sentence and three of its clauses are load-bearing:
 * the dock closes when the page scrolls down or the pointer leaves the top
 * region, it opens *before* an approaching pointer arrives, and the two
 * directions have weight rather than an ease. So this returns a continuous
 * number rather than a boolean, and the stylesheet is a function of it.
 *
 * **Why a spring here and not `linear()`.** A generated `linear()` easing is
 * the cheaper answer when a transition runs between two fixed states, and the
 * scroll and focus cases are exactly that. Pointer proximity is not: its
 * target moves every pointer event, and a CSS transition restarted on each one
 * never reaches its end, so the dock would crawl instead of morphing. One
 * spring integrating toward a moving target handles all four inputs with one
 * mechanism, which is less code than a `linear()` curve plus a second path for
 * proximity.
 *
 * `stiffness 280, damping 24, mass 1` → ω = 16.7 rad/s, ζ = 0.72. That is a
 * light overshoot of about 4% and settling inside ~440ms, with the perceived
 * move done by ~330ms. Integrated in fixed 1/120s substeps so a dropped frame
 * cannot blow the integrator up, and the loop stops dead once the spring is at
 * rest — the dock costs nothing while nobody is moving.
 *
 * **Nothing here is per-frame React state.** The fraction goes to a CSS custom
 * property on the header; the only `useState` is the discrete collapsed flag,
 * which exists because `inert` and `aria-hidden` need a boolean.
 */
const STIFFNESS=280,DAMPING=24,SUBSTEP=1/120;
/**
 * The approach corridor. The dock opens proportionally across the last 140px
 * and saturates at four fifths of the way in, so it is fully open about 28px
 * short of the dock rather than at the moment of contact — the cursor arrives
 * at a dock that has already finished moving, which is the whole point.
 *
 * 96px was the first figure and measured too tight: at 100px out the dock had
 * not started, so a pointer crossing quickly still met a dock in mid-morph.
 * 140px starts it a third of the way open at 100px out and finished by 28px.
 * The horizontal half-width is Astra's and is deliberately not the dock's own
 * width: reading the dock's box would make the corridor move as the dock
 * contracts, and the pointer would be hunting an edge that runs away from it.
 */
const APPROACH=140,ARRIVED=.8;
/** Scroll travel in one direction before the dock believes the direction. */
const TRAVEL=12;
/** Above this offset there is nothing for the dock to get out of the way of. */
const TOP=120;

export function useDiscoverNav(root:RefObject<HTMLElement|null>,menuOpen:boolean){
  const [collapsed,setCollapsed]=useState(false);
  /* The menu is a prop, but re-registering the listeners on it would reset the
     spring mid-flight, so it reaches the loop through a ref and one nudge. */
  const menu=useRef(menuOpen),aim=useRef<()=>void>(()=>{}),hold=useRef<()=>void>(()=>{});
  useEffect(()=>{
    const node=root.current;if(!node)return;
    const dock=node.querySelector<HTMLElement>('.discover-nav');if(!dock)return;
    const still=matchMedia('(prefers-reduced-motion: reduce)');

    let open=1,velocity=0,target=1,frame=0,transfer=0,clock=0;
    let held=scrollY<=TOP,near=0,focused=false,previous=scrollY,travel=0,heading=0;
    const born=performance.now();
    let edge=node.getBoundingClientRect().bottom;

    const write=()=>node.style.setProperty('--nav-open',open.toFixed(4));
    const tick=(now:number)=>{
      frame=0;
      /* Fixed substeps, and a clamp so a tab that was backgrounded for a
         second does not integrate a second of spring in one go. */
      for(let left=Math.min(.064,(now-clock)/1000);left>0;left-=SUBSTEP){
        const h=Math.min(SUBSTEP,left);
        velocity+=(-STIFFNESS*(open-target)-DAMPING*velocity)*h;
        open+=velocity*h;
      }
      clock=now;write();
      if(Math.abs(target-open)>.001||Math.abs(velocity)>.001)frame=requestAnimationFrame(tick);
      else{open=target;velocity=0;write();}
    };
    const settle=()=>{cancelAnimationFrame(frame);frame=0;open=target;velocity=0;write();};
    const steer=()=>{
      const next=held||focused||menu.current?1:near;
      if(next===target)return;
      target=next;setCollapsed(next<.5);
      /* Nothing on this page has an entrance. A deep link lands mid-document
         and the browser's own hash jump fires a scroll before anyone has
         touched anything; springing the dock shut on that is a page-load
         sequence, so the first half-second settles instead of animating. */
      if(still.matches||performance.now()-born<500){settle();return;}
      if(!frame){clock=performance.now();frame=requestAnimationFrame(tick);}
    };
    aim.current=steer;
    hold.current=()=>{held=true;steer();};
    /* Reduced motion switched on mid-flight: `steer` would return early with
       the target unchanged and leave the spring running out its tail. */
    const quiet=()=>{if(still.matches)settle();else steer();};

    const scroll=()=>{
      const delta=scrollY-previous;previous=scrollY;
      if(scrollY<=TOP){held=true;travel=0;steer();return;}
      const direction=Math.sign(delta);
      if(direction!==heading){heading=direction;travel=0;}
      travel+=delta;
      if(Math.abs(travel)<TRAVEL)return;
      held=travel<0;travel=0;steer();
    };
    const pointer=(event:PointerEvent)=>{
      if(event.pointerType==='touch')return;
      const inside=Math.abs(event.clientX-innerWidth/2)<Math.min(innerWidth*.48,560);
      const raw=inside?Math.min(1,Math.max(0,1-(event.clientY-edge)/APPROACH)/ARRIVED):0;
      /* Quantised to 1/32, so a slow sweep does not re-aim on every pixel and
         0 and 1 are still reached exactly. */
      const closeness=Math.round(raw*32)/32;
      if(closeness===near)return;
      near=closeness;steer();
    };
    const focus=(event:FocusEvent)=>{
      focused=true;steer();
      /* Astra's reveal control hands the keyboard straight to the links it
         uncovered; without this the next Tab leaves the dock again. */
      if((event.target as HTMLElement).closest('.discover-nav-reveal'))transfer=requestAnimationFrame(()=>{
        const first=[...dock.querySelectorAll<HTMLElement>('.discover-nav-expanded a[href],.discover-nav-expanded button,.discover-nav-expanded select')].find(control=>control.getClientRects().length>0);
        first?.focus({preventScroll:true});
      });
    };
    /* `focusout` fires before the matching `focusin`, so moving between two
       controls inside the dock would otherwise read as leaving it and wobble
       the spring. The element about to receive focus is on the event. */
    const blur=(event:FocusEvent)=>{if(node.contains(event.relatedTarget as Node|null))return;focused=false;steer();};

    const size=new ResizeObserver(entries=>{
      const box=entries[0]?.borderBoxSize?.[0];
      /* The expanded width, which the stylesheet needs as a length: the clip
         and the counter-translate cannot use a percentage, because a custom
         property substitutes as text and `100%` would then resolve against
         whichever descendant reads it. Neither the clip nor the translate
         changes this box, so it stays the expanded measurement throughout. */
      if(box)node.style.setProperty('--nav-width',`${box.inlineSize}px`);
      edge=node.getBoundingClientRect().bottom;
    });
    size.observe(dock,{box:'border-box'});
    write();

    const resize=()=>{edge=node.getBoundingClientRect().bottom;};
    window.addEventListener('scroll',scroll,{passive:true});
    window.addEventListener('pointermove',pointer,{passive:true});
    window.addEventListener('resize',resize);
    still.addEventListener('change',quiet);
    node.addEventListener('focusin',focus);
    node.addEventListener('focusout',blur);
    return()=>{
      cancelAnimationFrame(frame);cancelAnimationFrame(transfer);size.disconnect();
      window.removeEventListener('scroll',scroll);window.removeEventListener('pointermove',pointer);
      window.removeEventListener('resize',resize);still.removeEventListener('change',quiet);
      node.removeEventListener('focusin',focus);node.removeEventListener('focusout',blur);
    };
  },[root]);
  useEffect(()=>{menu.current=menuOpen;aim.current();},[menuOpen]);
  return {collapsed,expand:()=>hold.current()};
}
