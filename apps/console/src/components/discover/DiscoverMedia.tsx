import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';

export const DISCOVER_MEDIA = '/discover-media/20260909/';

/** Select the variant before mounting a media element, never preload both variants. */
export function ResponsivePovVideo(){
  const {t}=useTranslation();
  const [portrait,setPortrait]=useState(()=>matchMedia('(max-width: 767px)').matches);
  useEffect(()=>{const media=matchMedia('(max-width: 767px)');const change=()=>setPortrait(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  const name=portrait?'pov-portrait':'pov-landscape';
  return <DiscoverVideo key={name} src={`${DISCOVER_MEDIA}${name}.mp4`} poster={`${DISCOVER_MEDIA}${name}.webp`} label={t('discoverV2.povLabel')}/>;
}

export function PovPicture({className='', decorative=false}: {className?:string;decorative?:boolean}) {
  const {t}=useTranslation();
  return <picture className={className}><source media="(max-width: 767px)" srcSet={`${DISCOVER_MEDIA}pov-portrait.webp`}/><img src={`${DISCOVER_MEDIA}pov-landscape.webp`} alt={decorative?'':t('discoverV2.povAlt')} loading="lazy" decoding="async" width={2688} height={1520}/></picture>;
}

/** Only attach video bytes once visible. The poster and semantic copy never wait for play(). */
export function DiscoverVideo({opening=false,src,poster,label}: {opening?:boolean;src:string;poster:string;label:string}) {
  const {t}=useTranslation();
  const ref=useRef<HTMLVideoElement>(null);
  const [playing,setPlaying]=useState(false);
  const [failed,setFailed]=useState(false);
  const manual=useRef(false);
  const allowed=useRef(true);
  const visible=useRef(false);
  useEffect(()=>{
    const video=ref.current;if(!video)return;
    const root=video.closest<HTMLElement>('.discover-page');
    const preference=matchMedia('(prefers-reduced-motion: reduce)');
    const sync=()=>{
      const revealed=!opening || (root?.dataset.storyPending!=='true'&&(root?.dataset.storyActive!=='true' || root.dataset.filmRevealed==='true'));
      if(!visible.current || document.hidden || !revealed || !allowed.current || (preference.matches&&!manual.current)){video.pause();return;}
      if(!video.getAttribute('src'))video.src=src;
      if(video.paused)void video.play().catch(()=>setPlaying(false));
    };
    const observer=new IntersectionObserver(entries=>{visible.current=entries.some(e=>e.isIntersecting);sync();},{threshold:.15});
    observer.observe(video);root?.addEventListener('discover-film-reveal',sync);
    document.addEventListener('visibilitychange',sync);preference.addEventListener('change',sync);
    return()=>{observer.disconnect();root?.removeEventListener('discover-film-reveal',sync);document.removeEventListener('visibilitychange',sync);preference.removeEventListener('change',sync);video.pause();video.removeAttribute('src');video.load();};
  },[src,opening]);
  const toggle=()=>{
    const video=ref.current;if(!video)return;
    manual.current=true;
    if(!video.paused){allowed.current=false;video.pause();return;}
    allowed.current=true;setFailed(false);if(!video.getAttribute('src'))video.src=src;
    void video.play().catch(()=>setFailed(true));
  };
  return <div className="discover-video">
    <video ref={ref} poster={poster} muted playsInline loop preload="none" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>setFailed(true)} aria-label={label}/>
    <div className="discover-film-scrim" aria-hidden="true"/>
    <button className="discover-video-control" onClick={toggle} aria-label={t(playing?'discoverV2.pause':'discoverV2.play')}><span aria-hidden="true">{playing?'Ⅱ':'▷'}</span></button>
    {failed&&<p className="discover-media-error" role="status">{t('discoverV2.filmError')}</p>}
  </div>;
}
