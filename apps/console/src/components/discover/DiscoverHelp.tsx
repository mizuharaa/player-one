import {Component,lazy,Suspense,useEffect,useRef,useState,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {Panda} from '../identity/Panda.tsx';

const PandaStage=lazy(()=>import('../identity/PandaStage.tsx').then(module=>({default:module.PandaStage})));
class MascotFallback extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<Panda size={112}/>:this.props.children;}
}

/** Prepared answers only. The existing GLB is loaded near the section and pauses offscreen. */
export function DiscoverHelp(){
  const {t}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const host=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);const title=useRef<HTMLHeadingElement>(null);
  const [near,setNear]=useState(false);const [visible,setVisible]=useState(false);const [paused,setPaused]=useState(false);
  const [open,setOpen]=useState(false);const [question,setQuestion]=useState('record');
  useEffect(()=>{if(open)title.current?.focus({preventScroll:true});},[open]);
  useEffect(()=>{
    const el=host.current;if(!el)return;
    const load=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setNear(true);load.disconnect();}},{rootMargin:'300px'});
    const viewport=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)));
    load.observe(el);viewport.observe(el);return()=>{load.disconnect();viewport.disconnect();};
  },[]);
  const show=()=>setOpen(true);
  const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
  return <div className="discover-truc" ref={host}>
    <div className="discover-truc-mascot">
      {near?<MascotFallback><Suspense fallback={<Panda size={112}/>}><PandaStage size={112} paused={paused||!visible} label={c('trucOpen')} onPress={show}/></Suspense></MascotFallback>:<Panda size={112}/>}
      <button type="button" className="discover-truc-pause" onClick={()=>setPaused(value=>!value)} aria-pressed={paused}>{c(paused?'trucResume':'trucPause')}</button>
    </div>
    <div className="discover-truc-copy"><p className="discover-eyebrow">{c('trucLabel')}</p><h3>{c('trucTitle')}</h3><p>{c('trucBody')}</p><button ref={trigger} type="button" className="discover-button" aria-expanded={open} aria-controls="discover-truc-answers" onClick={()=>open?close():show()}>{c(open?'trucClose':'trucOpen')} <span aria-hidden="true">↗</span></button></div>
    {open&&<section className="discover-truc-answers" id="discover-truc-answers" aria-labelledby="discover-truc-title" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}>
      <div className="discover-truc-answer-heading"><h4 id="discover-truc-title" ref={title} tabIndex={-1}>{c('trucPrepared')}</h4><button type="button" onClick={close} aria-label={c('trucClose')}>×</button></div>
      <div className="discover-truc-options" role="group" aria-label={c('trucPrepared')}>{['record','paid','when','data'].map(key=><button key={key} type="button" aria-pressed={question===key} onClick={()=>setQuestion(key)}>{t(`discover.before.q.${key}`)}</button>)}</div>
      <p aria-live="polite">{t(`discover.before.a.${question}`)}</p>
    </section>}
  </div>;
}
