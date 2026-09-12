import {useRef,useState} from 'react';
import {DiscoverDemo} from './DiscoverDemo';
import {useScrollScene} from '../../lib/use-scroll-scene';
import {useScrollStoryCopy} from '../../lib/scroll-story-copy';

const stages=['browse','details','prepare','ready'] as const;
export function ScrollDemo(){
  const root=useRef<HTMLElement>(null);const c=useScrollStoryCopy();
  const [manual,setManual]=useState(false);const [selected,setSelected]=useState(0);
  const {pinned,step}=useScrollScene(root,!manual);const current=pinned?step:selected;
  const choose=(index:number)=>{setSelected(index);if(pinned&&root.current){const top=scrollY+root.current.getBoundingClientRect().top;window.scrollTo({top:top+(root.current.offsetHeight-innerHeight)*(index+.15)/4,behavior:'instant'});}};
  const changeMode=()=>{const top=root.current?scrollY+root.current.getBoundingClientRect().top:scrollY;setManual(value=>!value);requestAnimationFrame(()=>window.scrollTo({top,behavior:'instant'}));};
  return <section ref={root} id="demo" className="discover-walkthrough" data-manual={manual} data-step={current}>
    <div className="discover-walkthrough-sticky">
      <div className="discover-walkthrough-top"><h2>{c.title}</h2><div className="discover-walkthrough-tools"><button onClick={changeMode}>{manual?c.guided:c.manual}<span aria-hidden="true">↗</span></button><a href="#work">{c.skip}<span aria-hidden="true">↓</span></a></div></div>
      {manual?<div className="discover-walkthrough-manual"><DiscoverDemo/></div>:<div className="discover-walkthrough-grid">
        <div className="discover-walkthrough-copy"><p className="discover-walkthrough-intro">{c.intro}</p><ol>{c.steps.map((label,index)=><li key={index} data-active={current===index}><button onClick={()=>choose(index)} aria-current={current===index?'step':undefined}><span className="discover-step-index">0{index+1}</span><span>{label}</span><span className="discover-step-arrow" aria-hidden="true">↗</span></button></li>)}</ol><p className="discover-step-description" key={current}>{c.body[current]}</p><p className="discover-walkthrough-disclosure">{c.example}</p><span className="discover-scroll-cue" aria-hidden="true">{pinned?c.scroll:'← →'}<span>↓</span></span></div>
        <div className="discover-walkthrough-device"><div className="discover-device-halo" aria-hidden="true"/><div className="discover-device-caption"><span>0{current+1} / 04</span><span>{c.screen[current]}</span></div><DiscoverDemo guidedStage={stages[current]}/><div className="discover-device-steps"><button type="button" onClick={()=>choose(current-1)} disabled={current===0} aria-label={c.prev}><span aria-hidden="true">&larr;</span></button><span>0{current+1} / 04</span><button type="button" onClick={()=>choose(current+1)} disabled={current===3} aria-label={c.next}><span aria-hidden="true">&rarr;</span></button></div><div className="discover-device-note" key={current}><span aria-hidden="true">✓</span>{c.screen[current]}</div></div>
      </div>}
    </div>
  </section>;
}
