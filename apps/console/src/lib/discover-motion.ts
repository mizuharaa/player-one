import { useEffect, useState, type RefObject } from 'react';

function shouldOpen(){
  if(typeof window==='undefined'||matchMedia('(prefers-reduced-motion: reduce)').matches||location.hash||window.scrollY>2)return false;
  const query=new URLSearchParams(location.search);
  if(import.meta.env.DEV&&(query.has('logoReplay')||query.has('logoDebug')||query.has('logo-intro')))return true;
  try{return sessionStorage.getItem('playerone:logo-assembly:v1')!=='1';}catch{return true;}
}
/** Native scrolling; bounded, owned animations never restart on scroll or resize. */
export function useDiscoverMotion(root: RefObject<HTMLElement | null>) {
  const [pending,setPending]=useState(shouldOpen);
  useEffect(() => {
    const el=root.current;
    if(!el)return;
    let cancelled=false;
    let expired=false;
    let settled=false;
    let cleanup=()=>{};
    const preference=matchMedia('(prefers-reduced-motion: reduce)');
    const film=el.querySelector<HTMLElement>('[data-opening-film]');
    const slogan=el.querySelector<HTMLElement>('[data-opening-slogan]');
    const copy=el.querySelector<HTMLElement>('[data-opening-copy]');
    const bar=el.querySelector<HTMLElement>('[data-discover-nav]');
    const css=getComputedStyle(el);
    const duration=(parseFloat(css.getPropertyValue('--discover-reveal'))||720)/1000;
    const openingMs=parseFloat(css.getPropertyValue('--discover-opening'))||1100;
    const showContent=()=>{
      // CSS owns the settled layout, including after an interrupted opening.
      // Release the active selector BEFORE removing the slogan's faded styles;
      // otherwise its display:flex rule paints the old black text over the film.
      delete el.dataset.storyActive;
      el.removeAttribute('data-story-pending');
      el.dataset.filmRevealed='true';
      [film,slogan,copy].forEach(node=>{
        node?.style.removeProperty('transform');
        node?.style.removeProperty('opacity');
        node?.style.removeProperty('visibility');
      });
      if(bar){
        bar.dataset.revealed='true';bar.inert=false;
        bar.style.removeProperty('opacity');bar.style.removeProperty('visibility');
      }
      if(!cancelled)setPending(false);
      if(!settled&&!cancelled)el.dispatchEvent(new Event('discover-film-reveal'));
      settled=true;
    };
    const failOpen=()=>{
      if(settled||cancelled)return;
      expired=true;window.clearTimeout(startupTimer);cleanup();showContent();
    };
    // Cover the whole logo handshake, not just the dynamic module import.
    const startupTimer=window.setTimeout(failOpen,Math.max(3500,openingMs*2+1000));
    const start=async()=>{
      if(preference.matches){window.clearTimeout(startupTimer);failOpen();return;}
      const {gsap}=await import('gsap');
      if(cancelled||expired||preference.matches)return;
      if(!film||!slogan||!copy||!bar){window.clearTimeout(startupTimer);failOpen();return;}
      const animations: gsap.core.Animation[]=[];
      let observer: IntersectionObserver|undefined;
      let opening: gsap.core.Timeline|undefined;
      let started=false;
      let completed=false;
      let revealOpening=()=>{};
      const finish=()=>{completed=true;window.clearTimeout(startupTimer);showContent();};
      const context=gsap.context(()=>{
        const revealDuration=duration*.85;
        opening=gsap.timeline({paused:true,onComplete:finish});
        opening.fromTo(slogan,{yPercent:0,opacity:1},{yPercent:-80,opacity:0,duration:revealDuration*.75,ease:'power2.inOut',immediateRender:false},0)
          .fromTo(film,{y:0,yPercent:100},{y:0,yPercent:0,duration:revealDuration,ease:'power3.inOut',immediateRender:false},0)
          .fromTo(copy,{opacity:0,y:28},{opacity:1,y:0,duration:revealDuration*.65,ease:'power3.out',immediateRender:false},revealDuration*.5);
        animations.push(opening);
        revealOpening=()=>{
          if(started||completed||expired||cancelled)return;
          started=true;bar.dataset.revealed='true';bar.inert=false;setPending(false);
          if(el.dataset.logoPlayed==='true'&&!location.hash&&window.scrollY<2){
            el.dataset.storyActive='true';opening?.play();
          }else finish();
        };
      },el);
      if(typeof IntersectionObserver!=='undefined'){
        observer=new IntersectionObserver(entries=>{
          entries.forEach(entry=>{
            if(!entry.isIntersecting)return;
            observer?.unobserve(entry.target);
            // A heading is always readable. Re-entry cannot reset opacity or position.
            context.add(()=>{
              animations.push(gsap.fromTo(entry.target,{y:10},{y:0,duration:Math.min(duration,.45),ease:'power3.out',clearProps:'transform'}));
            });
          });
        },{rootMargin:'0px 0px -6% 0px'});
        el.querySelectorAll<HTMLElement>('[data-discover-heading]').forEach(heading=>observer?.observe(heading));
      }
      const onLogoComplete=()=>revealOpening();
      const visibility=()=>{
        if(!started||completed||!opening)return;
        if(document.hidden)opening.pause();else opening.resume();
      };
      el.addEventListener('discover-logo-complete',onLogoComplete);
      document.addEventListener('visibilitychange',visibility);
      cleanup=()=>{
        observer?.disconnect();
        el.removeEventListener('discover-logo-complete',onLogoComplete);
        document.removeEventListener('visibilitychange',visibility);
        context.revert();animations.forEach(animation=>animation.kill());
      };
      if(el.dataset.logoComplete==='true')revealOpening();
      else if(!pending)finish();
    };
    void start().catch(()=>{window.clearTimeout(startupTimer);failOpen();});
    const change=()=>{if(preference.matches){window.clearTimeout(startupTimer);failOpen();}};
    const skipOpening=()=>{if(location.hash)failOpen();};
    preference.addEventListener('change',change);
    window.addEventListener('resize',failOpen);
    window.addEventListener('hashchange',skipOpening);
    return()=>{
      cancelled=true;window.clearTimeout(startupTimer);
      preference.removeEventListener('change',change);
      window.removeEventListener('resize',failOpen);
      window.removeEventListener('hashchange',skipOpening);
      cleanup();delete el.dataset.storyActive;
    };
  },[root]);
  return pending;
}

/** Quiet compositor light only while the scene is onscreen and the document is visible. */
export function useDiscoverAmbient(root: RefObject<HTMLElement | null>) {
  useEffect(()=>{
    const el=root.current;if(!el||typeof IntersectionObserver==='undefined')return;
    const regions=[...el.querySelectorAll<HTMLElement>('[data-ambient]')];
    const visible=new Set<Element>();
    const update=()=>regions.forEach(region=>region.dataset.ambientActive=String(visible.has(region)&&!document.hidden));
    const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>entry.isIntersecting?visible.add(entry.target):visible.delete(entry.target));update();});
    regions.forEach(region=>observer.observe(region));document.addEventListener('visibilitychange',update);
    return()=>{observer.disconnect();document.removeEventListener('visibilitychange',update);};
  },[root]);
}
