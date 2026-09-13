import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {WalkthroughAtmosphere} from './WalkthroughAtmosphere';
import {DiscoverDemo} from './DiscoverDemo';
import {useScrollScene} from '../../lib/use-scroll-scene';
import {useScrollStoryCopy} from '../../lib/scroll-story-copy';

const stages=['browse','details','prepare','ready'] as const;
export function ScrollDemo({motionPaused,reducedMotion,onToggleMotion}:{motionPaused:boolean;reducedMotion:boolean;onToggleMotion:()=>void}){
  const root=useRef<HTMLElement>(null);const c=useScrollStoryCopy();const {t}=useTranslation();
  const motionLabel=t(`discoverV2.${reducedMotion?'illustrationsReduced':motionPaused?'resumeIllustrations':'pauseIllustrations'}`);
  const [manual,setManual]=useState(false);const [selected,setSelected]=useState(0);
  const {pinned,step}=useScrollScene(root,!manual);const current=pinned?step:selected;
  const choose=(index:number)=>{index=Math.max(0,Math.min(3,index));setSelected(index);if(pinned&&root.current){const top=scrollY+root.current.getBoundingClientRect().top;window.scrollTo({top:top+(root.current.offsetHeight-innerHeight)*(index+.15)/4,behavior:'smooth'});}};
  const changeMode=()=>{const top=root.current?scrollY+root.current.getBoundingClientRect().top:scrollY;setManual(value=>!value);requestAnimationFrame(()=>window.scrollTo({top,behavior:'instant'}));};
  return <section ref={root} id="demo" className="discover-walkthrough" data-manual={manual} data-step={current}>
    <div className="discover-walkthrough-sticky" data-illustration-region="" data-art-paused={motionPaused}>
      <div className="discover-walkthrough-top"><div className="discover-walkthrough-heading"><h2>{c.title}</h2><p className="discover-walkthrough-intro">{c.intro}</p></div><div className="discover-walkthrough-tools"><button className="discover-walkthrough-mode" onClick={changeMode}>{manual?c.guided:c.manual}<span aria-hidden="true">↗</span></button><a href="#work">{c.skip}<span aria-hidden="true">↓</span></a><button className="discover-walkthrough-motion" type="button" onClick={onToggleMotion} aria-label={motionLabel} title={motionLabel} aria-pressed={motionPaused} disabled={reducedMotion}><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{motionPaused?<path d="m5 3 8 5-8 5Z"/>:<path d="M4 3h3v10H4zm5 0h3v10H9z"/>}</svg></button></div></div>
      {manual?<div className="discover-walkthrough-manual"><DiscoverDemo/></div>:<div className="discover-walkthrough-grid">
        <div className="discover-walkthrough-copy"><ol>{c.steps.map((label,index)=><li key={index} data-active={current===index}><button onClick={()=>choose(index)} aria-current={current===index?'step':undefined}><span className="discover-step-index">0{index+1}</span><span>{label}</span><span className="discover-step-arrow" aria-hidden="true">↗</span></button></li>)}</ol><p className="discover-step-description" key={current}>{c.body[current]}</p><p className="discover-walkthrough-disclosure">{c.example}</p><span className="discover-scroll-cue" aria-hidden="true">{pinned?c.scroll:'← →'}<span>↓</span></span></div>
        <div className="discover-walkthrough-device"><WalkthroughAtmosphere paused={motionPaused}/><div className="discover-device-caption"><span>0{current+1} / 04</span><span>{c.screen[current]}</span></div><DiscoverDemo guidedStage={stages[current]}/><div className="discover-device-steps"><button type="button" onClick={()=>choose(current-1)} disabled={current===0} aria-label={c.prev}><span aria-hidden="true">&larr;</span></button><span>0{current+1} / 04</span><button type="button" onClick={()=>choose(current+1)} disabled={current===3} aria-label={c.next}><span aria-hidden="true">&rarr;</span></button></div></div>
      </div>}
    </div>
  </section>;
}
