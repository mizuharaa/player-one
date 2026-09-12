import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ScanMotif} from './ScanMotif.tsx';
import {useTranslation} from 'react-i18next';
import {AssemblyLogo} from '../logo-animation/AssemblyLogo.tsx';

const tasks=[{key:'taskKitchen',scenario:'home',image:'20260909/pov-landscape.webp',generated:true},{key:'taskDesk',scenario:'office',image:'setting-workspace.webp',generated:false},{key:'taskShelf',scenario:'shop',image:'setting-warehouse.webp',generated:false}] as const;
type Step='browse'|'details'|'prepare'|'ready';

function DemoCursor(){return <span className="discover-demo-cursor" aria-hidden="true"><svg width="38" height="44" viewBox="0 0 38 44"><path d="M6 3 31 25 20 27 14 38Z" fill="#8bbcff" stroke="#14396a" strokeWidth="2.5" strokeLinejoin="round"/></svg><i/></span>;}

/** TaskHall/TaskDetail/SessionCreate anatomy, with local illustrative state only. */
export function DiscoverDemo({motionControl,guidedStage}:{motionControl?:ReactNode;guidedStage?:Step}={}){
  const {t}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const [manualStep,setStep]=useState<Step>('browse');const step=guidedStage??manualStep;const [selected,setSelected]=useState(0);
  const [search,setSearch]=useState('');const [filter,setFilter]=useState('all');
  const [others,setOthers]=useState('');const [sensitive,setSensitive]=useState('');
  const heading=useRef<HTMLHeadingElement>(null);const changed=useRef(false);
  const task=tasks[selected]??tasks[0];
  const go=(next:Step)=>{changed.current=true;setStep(next);};
  useEffect(()=>{if(!guidedStage&&changed.current)heading.current?.focus({preventScroll:true});},[step,guidedStage]);
  const reset=()=>{setOthers('');setSensitive('');setSearch('');setFilter('all');go('browse');};
  const visible=tasks.filter(item=>(filter==='all'||item.scenario===filter)&&c(item.key).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="discover-demo-scene discover-shell" data-guided={Boolean(guidedStage)} data-illustration-region="">
    {!guidedStage&&<><div className="discover-demo-optics" data-kinetic-pan=""><ScanMotif/></div><aside className="discover-demo-context" data-kinetic-entry=""><p className="discover-eyebrow">{c('example')}</p><h3>{c('appGuide')}</h3><p>{c('appGuideBody')}</p><ol>{['taskStage','preparationStage','deviceStage'].map((key,index)=><li key={key} aria-current={index===(step==='browse'||step==='details'?0:step==='prepare'?1:2)?'step':undefined} data-current={index===(step==='browse'||step==='details'?0:step==='prepare'?1:2)}><span aria-hidden="true">{String(index+1).padStart(2,'0')}</span><div><strong>{c(key)}</strong><p>{c(['demoGuidance','prepareAction','physicalBody'][index]!)}</p></div></li>)}</ol><p className="discover-demo-footnote">{c('exampleNote')}</p>{motionControl}</aside></>}
    <div className="discover-phone-stage" data-kinetic-entry={guidedStage?undefined:"side"} aria-hidden={guidedStage?true:undefined} inert={Boolean(guidedStage)}><span className="discover-phone-keys" aria-hidden="true"/><div className="discover-demo-frame discover-demo-phone">
      <div className="discover-phone-hardware" aria-hidden="true"><span>9:41</span><i/><span className="discover-phone-status">
        <svg viewBox="0 0 18 14" width="16" height="13" fill="currentColor"><rect x="0" y="9" width="3" height="5" rx=".7"/><rect x="5" y="6" width="3" height="8" rx=".7"/><rect x="10" y="3" width="3" height="11" rx=".7"/><rect x="15" width="3" height="14" rx=".7"/></svg>
        
        <svg viewBox="0 0 20 16" width="16" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 5a12 12 0 0 1 16 0M5 8a7.5 7.5 0 0 1 10 0M8 11a3 3 0 0 1 4 0"/><circle cx="10" cy="14" r="1" fill="currentColor" stroke="none"/></svg>
        <svg viewBox="0 0 27 14" width="24" height="13" fill="none"><rect x="1" y="1" width="22" height="12" rx="3" stroke="currentColor" strokeWidth="1.5"/><rect x="3.5" y="3.5" width="17" height="7" rx="1" fill="currentColor"/><path d="M25 5v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </span></div>
      <div className="discover-demo-top"><AssemblyLogo className="discover-assembly-logo" title="PlayerOne"/><span className="discover-demo-badge">{c('preview')}</span></div>
      <div className="discover-demo-content" key={step} data-phone-screen={step}>
        {step!=='browse'&&<button className="discover-demo-back" onClick={()=>go(step==='details'?'browse':step==='prepare'?'details':'prepare')}>&larr; {c('back')}</button>}
        <h3 ref={heading} tabIndex={-1}>{c(step)}</h3>
        {step==='browse'&&<>
          {!guidedStage&&<><label className="discover-demo-search">{c('appSearch')}<input type="search" value={search} onChange={event=>setSearch(event.target.value)}/></label>
          <div className="discover-demo-filters" role="group" aria-label={c('scenario')}>{['all','home','office','shop'].map(key=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>setFilter(key)}>{c(key==='all'?'allTasks':key)}</button>)}</div>
          <p className="discover-demo-data-note">{c('appDataNote')}</p></>}
          <div className="discover-native-tasks">{visible.length?(guidedStage?tasks.slice(0,2):visible).map((item,index)=><button className="discover-native-task" key={item.key} onClick={()=>{setSelected(tasks.indexOf(item));setOthers('');setSensitive('');go('details');}}><img className="discover-task-image" src={`/discover-media/${item.image}`} alt="" loading="lazy"/><span className="discover-native-task-context">{c(item.scenario)}</span>{item.generated&&<span className="discover-native-task-ai">{c('aiLabel')}</span>}<strong>{c(item.key)}</strong><span className="discover-native-task-action">{c('demoGuidance')} <span aria-hidden="true">&rarr;</span></span>{guidedStage&&index===0&&<DemoCursor/>}</button>):<p role="status">{c('noTasks')}</p>}</div>
        </>}
        {step==='details'&&<><p className="discover-demo-task-name">{c(task.key)}</p><p>{c('taskDescription')}</p><ul className="discover-demo-instructions"><li>{c('natural')}</li><li>{c('hands')}</li><li>{c('boundaries')}</li></ul><p className="discover-demo-notice">{c('prerequisites')}</p><button className="discover-button" onClick={()=>go('prepare')}>{c('claim')} <span aria-hidden="true">&rarr;</span>{guidedStage&&<DemoCursor/>}</button></>}
        {step==='prepare'&&<><p className="discover-demo-confirmation">{c('claimed')}</p><div className="discover-demo-device"><small>{c('device')}</small><strong>{c('deviceExample')}</strong></div><p className="discover-demo-scenario">{c('scenario')}: <strong>{c(task.scenario)}</strong></p>{guidedStage?<div className="discover-guided-checks"><p><span>✓</span>{c('natural')}</p><p><span>✓</span>{c('boundaries')}</p></div>:[{key:'others',value:others,set:setOthers},{key:'sensitive',value:sensitive,set:setSensitive}].map(choice=><fieldset className="discover-demo-choice" key={choice.key}><legend>{c(choice.key)}</legend><div>{['yes','no'].map(answer=><label key={answer}><input type="radio" name={`demo-${choice.key}`} checked={choice.value===answer} onChange={()=>choice.set(answer)}/>{c(answer)}</label>)}</div></fieldset>)}<button className="discover-button" disabled={!guidedStage&&(!others||!sensitive)} onClick={()=>go('ready')}>{c('prepareAction')} <span aria-hidden="true">&rarr;</span>{guidedStage&&<DemoCursor/>}</button></>}
        {step==='ready'&&<><p className="discover-demo-task-name">{c('physical')}</p><p>{c('physicalBody')}</p>{guidedStage&&<><div className="discover-demo-device"><small>{c('device')}</small><strong>{c('deviceExample')}</strong></div><p className="discover-demo-scenario">{c('scenario')}: <strong>{c(task.scenario)}</strong></p></>}<button className="discover-button" onClick={reset}>{c('restart')} <span aria-hidden="true">&larr;</span></button></>}
        <p className="discover-demo-footnote">{c('exampleNote')}</p>
      </div>
    </div></div>
  </div>;
}
