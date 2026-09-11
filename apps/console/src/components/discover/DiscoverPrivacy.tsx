import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';

const CHOICE_KEY='playerone:showcase-cookie-choice:v1';
type Choice='accepted'|'declined';
function readChoice():Choice|null{
  try{const value=localStorage.getItem(CHOICE_KEY);return value==='accepted'||value==='declined'?value:null;}catch{return null;}
}

/** A preference record only: neither choice starts an analytics or advertising service. */
export function DiscoverPrivacy(){
  const {t}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const [choice,setChoice]=useState<Choice|null>(readChoice);
  const [open,setOpen]=useState(()=>readChoice()===null);
  const [failed,setFailed]=useState(false);
  const settings=useRef<HTMLButtonElement>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  const requestedFocus=useRef(false);
  useEffect(()=>{if(open&&requestedFocus.current){requestedFocus.current=false;heading.current?.focus({preventScroll:true});}},[open]);
  const save=(value:Choice)=>{
    let stored=true;try{localStorage.setItem(CHOICE_KEY,value);}catch{stored=false;}
    setChoice(value);setFailed(!stored);setOpen(false);
    if(document.activeElement?.closest('.discover-cookie-banner'))settings.current?.focus({preventScroll:true});
  };
  return <div className="discover-privacy-controls">
    <a href="/privacy">{c('privacyTitle')}</a>
    <button ref={settings} type="button" onClick={()=>{requestedFocus.current=true;setOpen(true);}} aria-expanded={open} aria-controls="discover-cookie-preferences">{c('cookieSettings')}</button>
    <span className="discover-cookie-status" role="status">{failed?c('cookieSaveFailed'):choice?c(choice==='accepted'?'cookieSavedAccept':'cookieSavedDecline'):''}</span>
    {open&&<aside id="discover-cookie-preferences" className="discover-cookie-banner" aria-labelledby="discover-cookie-title">
      <div><h2 id="discover-cookie-title" ref={heading} tabIndex={-1}>{c('cookieTitle')}</h2><p>{c('cookieBody')} <a href="/privacy">{c('privacyTitle')} ↗</a></p></div>
      <div className="discover-cookie-actions"><button type="button" onClick={()=>save('accepted')}>{c('cookieAccept')}</button><button type="button" onClick={()=>save('declined')}>{c('cookieDecline')}</button></div>
    </aside>}
  </div>;
}
