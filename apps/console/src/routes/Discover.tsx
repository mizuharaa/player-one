/**
 * THESIS: everyday activity fills the screen before the interface explains it.
 * OWN-WORLD: existing film, white copy, violet controls and orange/blue wordmark.
 * STORY: enter the work, meet the collector perspective, try the real demo.
 * FIRST VIEWPORT: edge-to-edge 100svh film; compact dock and lower-left actions.
 * FORM: owner-approved A, 26 September; same film continues into a wide wordmark.
 * Preserve the exact shuffle, product truth and visible illustrative disclosures.
 */
import {Fragment,useEffect,useRef,useState,type CSSProperties,type ReactNode,type RefObject} from 'react';
import {useTranslation} from 'react-i18next';
import {Link} from '@tanstack/react-router';
import {LocaleSwitch} from '../components/shell/LocaleSwitch.tsx';
import {IconPass,IconPartial,IconReject} from '../components/icons.tsx';
import {OperatorDemo} from '../components/discover/OperatorDemo.tsx';
import {ScanMotif} from '../components/discover/ScanMotif.tsx';
import {ScrollDemo} from '../components/discover/ScrollDemo.tsx';
import {useDiscoverNav} from '../lib/use-discover-nav.ts';
import {DownloadApp} from '../components/discover/DownloadApp.tsx';
import {useScrollScene} from '../lib/use-scroll-scene.ts';
import {useScrollStoryCopy} from '../lib/scroll-story-copy.ts';
import {DiscoverHelp} from '../components/discover/DiscoverHelp.tsx';
import {DiscoverPrivacy} from '../components/discover/DiscoverPrivacy.tsx';
import {DISCOVER_MEDIA,DiscoverVideo} from '../components/discover/DiscoverMedia.tsx';
import {AssemblyLogo} from '../components/logo-animation/AssemblyLogo.tsx';
import {WhiteLogoIntro} from '../components/logo-animation/WhiteLogoIntro.tsx';
import {useDiscoverAmbient} from '../lib/discover-motion.ts';
import {Panda} from '../components/identity/Panda.tsx';
import {useDiscoverIllustrationMotion} from '../lib/discover-illustration-motion.ts';
import '../styles/discover.css';
import '../styles/discover-warm.css';
import '../styles/discover-kinetics.css';
import '../styles/discover-scroll-story.css';
import '../styles/discover-nav-motion.css';
import '../styles/discover-walkthrough.css';
import '../styles/discover-download.css';
import '../styles/discover-faq-color.css';
import '../styles/discover-editorial.css';
import {useDiscoverKinetics} from '../lib/discover-kinetics.ts';

const destinations=['demo','work','camera','review','questions'] as const;
const apk=typeof import.meta.env.VITE_COLLECTOR_APK_URL==='string'?import.meta.env.VITE_COLLECTOR_APK_URL:'';

export function DiscoverScreen(){
  const {t}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const root=useRef<HTMLDivElement>(null);
  const navLogo=useRef<SVGSVGElement>(null);
  useDiscoverAmbient(root);useDiscoverKinetics(root);
  const {paused,reduced,toggle}=useDiscoverIllustrationMotion(root);
  const motionControl=<button type="button" className="discover-illustration-toggle" aria-pressed={paused||reduced} disabled={reduced} onClick={toggle}>{c(reduced?'illustrationsReduced':paused?'resumeIllustrations':'pauseIllustrations')}<span aria-hidden="true">{paused||reduced?'▷':'Ⅱ'}</span></button>;
  return <div ref={root} className="discover-page" data-film-revealed="true" data-logo-complete="true" data-logo-played="false">
    <DiscoverNav logoRef={navLogo}/>
    <WhiteLogoIntro skipLabel={c('skip')}/>
    <main>
      <CinematicOpening/>

      <CollectorStory/>

      <OperatorDemo motionPaused={paused||reduced} reducedMotion={reduced}/>

      <ScrollDemo motionPaused={paused||reduced} reducedMotion={reduced} onToggleMotion={toggle}/>

      <section className="discover-work" id="work">
        <div className="discover-section-heading discover-shell"><h2 className="discover-heading" data-discover-heading=""><TitleInk>{c('workTitle')}</TitleInk></h2><div><p className="discover-lead">{c('workBody')}</p><p className="discover-image-label">{c('imageLabel')}</p></div></div>
        <div className="discover-collector-wall">
          <figure className="discover-collector-wide" data-discover-scene="photo" tabIndex={0}><img src={`${DISCOVER_MEDIA}work-wide.webp`} alt={c('imageWide')} loading="lazy" decoding="async" width={1920} height={1086}/><figcaption><span>01</span>{c('activityKitchen')}</figcaption></figure>
          <figure className="discover-collector-portrait" data-discover-scene="photo" tabIndex={0}><img src={`${DISCOVER_MEDIA}work-portrait.webp`} alt={c('imagePortrait')} loading="lazy" decoding="async" width={1440} height={1929}/><figcaption><span>02</span>{c('activityClothes')}</figcaption></figure>
          <figure className="discover-collector-detail" data-discover-scene="photo" tabIndex={0}><img src={`${DISCOVER_MEDIA}work-detail.webp`} alt={c('imageDetail')} loading="lazy" decoding="async" width={1440} height={1075}/><figcaption><span>03</span>{c('activityPacking')}</figcaption></figure>
        </div>
      </section>

      <SettingsStory/>
      <section className="discover-camera-section discover-shell" id="camera"><div className="discover-centered-heading"><p className="discover-eyebrow">Ego</p><h2 className="discover-heading" data-discover-heading=""><TitleInk>{c('cameraTitle')}</TitleInk></h2><p className="discover-lead">{c('cameraBody')}</p></div><figure className="discover-ego-portrait" data-kinetic-entry="side"><img src={`${DISCOVER_MEDIA}work-portrait.webp`} alt={c('imagePortrait')} width={1000} height={1000} loading="lazy" decoding="async"/><figcaption>{c('imageLabel')}</figcaption></figure></section>
      <ReviewStory/>

      <section className="discover-coverage" id="payment">
        <div className="discover-coverage-copy">
        <h2 className="discover-heading" data-discover-heading=""><TitleInk>{c('paymentTitle')}</TitleInk></h2>
        <p className="discover-lead">{c('paymentBody')}</p>
        </div>
        <figure className="discover-coverage-figure"><div className="discover-coverage-rows">{[['streamVideo','video'],['streamAudio','audio'],['streamMotion','motion']].map(([key,role])=><Fragment key={role}><span>{c(key??'')}</span><div className={`discover-coverage-track discover-coverage-${role}`} aria-hidden="true"><i data-discover-scene="channel"/></div></Fragment>)}<span className="discover-coverage-result-label">{c('overlapShort')}</span><div className="discover-coverage-track discover-coverage-result" aria-hidden="true"><i/></div></div><figcaption><strong>{c('overlap')}</strong><p>{c('diagram')}</p></figcaption></figure>
        <div className="discover-payment-details">{['paid','when'].map(key=><details key={key}><summary>{t(`discover.before.q.${key}`)}<span aria-hidden="true">+</span></summary><p>{t(`discover.before.a.${key}`)}</p></details>)}</div>
      </section>

      <section className="discover-questions discover-shell" id="questions" data-illustration-region="">
        <div className="discover-faq-intro" data-kinetic-entry=""><p className="discover-eyebrow">{c('questions')}</p><h2 className="discover-heading" data-discover-heading=""><TitleInk>{c('questionsTitle')}</TitleInk></h2><DiscoverHelp/><div className="discover-faq-motion"><span className="discover-faq-optics" aria-hidden="true"><ScanMotif/></span>{motionControl}</div></div>
        <div className="discover-faq-rows" data-kinetic-entry="side">{['record','paid','when','data','device','join'].map((key,index)=><details key={key}><summary><b className="discover-faq-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</b><strong>{key==='device'?c('faqDevice'):key==='join'?c('faqJoin'):t(`discover.before.q.${key}`)}</strong><span aria-hidden="true">+</span></summary><p>{key==='device'?c('cameraBody'):key==='join'?c('prerequisites'):t(`discover.before.a.${key}`)}</p></details>)}</div>
      </section>

      <section className="discover-close discover-shell">
        <h2 className="discover-heading" data-discover-heading=""><TitleInk>{c('closeTitle')}</TitleInk></h2>
        <div className="discover-close-action"><div className="discover-actions">{apk?<a className="discover-button" href={apk} download>{c('apkDownload')} ↓</a>:<a className="discover-button" href="#demo">{c('explore')} ↗</a>}<Link to="/login" className="discover-text-link">{c('console')} ↗</Link></div>{!apk&&<p>{c('apkMissing')}</p>}</div>
      </section>
      <DownloadApp/>
    </main>
    <footer className="discover-footer">
      <div className="discover-footer-top discover-shell"><div className="discover-footer-identity"><a href="#top" className="discover-brand" aria-label="PlayerOne"><AssemblyLogo className="discover-assembly-logo" surface="dark" title="PlayerOne"/></a><p>{c('introBody')}</p></div><nav aria-label={c('footerExplore')}><h3>{c('footerExplore')}</h3>{destinations.map(destination=><a href={`#${destination}`} key={destination}>{c(destination)}</a>)}</nav><nav aria-label={c('footerStart')}><h3>{c('footerStart')}</h3><a href="#demo">{c('explore')}</a><Link to="/login">{c('console')}</Link><Link to="/privacy">{c('footerPrivacy')}</Link></nav></div>
      <div className="discover-wordmark discover-shell" aria-hidden="true"><AssemblyLogo monochrome/></div>
      <div className="discover-footer-bottom discover-shell"><p>{c('footerNote')}</p><DiscoverPrivacy/><Link to="/login">{c('console')} ↗</Link></div>
    </footer>
  </div>;
}

/** One film spans both the opening and its scroll-led wordmark; no duplicate media. */
export function CinematicOpening(){
  const {t}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const root=useRef<HTMLElement>(null);const {pinned,step}=useScrollScene(root);
  return <section ref={root} className="discover-opening discover-cinema" id="top" data-copy-hidden={pinned&&step>0} aria-labelledby="discover-cinema-title">
    <div className="discover-cinema-stage">
      <DiscoverVideo opening src={`${DISCOVER_MEDIA}opening.mp4`} poster={`${DISCOVER_MEDIA}opening-poster.webp`} label={c('filmLabel')}/>
      <div className="discover-cinema-transition" aria-hidden="true"><p>{c('introTitle')}</p><div className="discover-cinema-wordmark"><span>Player</span><span>One</span></div></div>
      <p className="discover-film-label">{c('filmLabel')}</p>
    </div>
    <div className="discover-cinema-copy">
      <h1 id="discover-cinema-title"><span>{c('heroA')}</span><span>{c('heroB')}</span></h1>
      <p>{c('heroBody')}</p>
      <div className="discover-actions"><a className="discover-button discover-button-light" href="#demo">{c('explore')} <span aria-hidden="true">↗</span></a><Link className="discover-cinema-console" to="/login">{c('forOperators')}</Link></div>
    </div>
    <a className="discover-cinema-scroll" href="#story">{c('scroll')} <span aria-hidden="true">↓</span></a>
  </section>;
}

/** A native sticky chapter: natural page scrolling, with a complete static fallback. */
export function CollectorStory(){
  const {t,i18n}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const root=useRef<HTMLElement>(null);useScrollScene(root);
  const body=c('workBody');
  const words=i18n.language.startsWith('zh')?Array.from(body):body.match(/\S+\s*/g)??[];
  const photos=['work-portrait.webp','pov-landscape.webp','work-detail.webp','work-wide.webp'];
  return <section ref={root} id="story" className="discover-constellation" aria-labelledby="collector-story-title">
    <div className="discover-constellation-stage">
      <div className="discover-constellation-photos" aria-hidden="true">{photos.map((file,index)=><img key={file} className={`discover-story-photo discover-story-photo-${index}`} src={`${DISCOVER_MEDIA}${file}`} alt="" loading="lazy" decoding="async"/>)}</div>
      <div className="discover-constellation-copy"><h2 id="collector-story-title" className="discover-heading" data-discover-heading="">{c('introTitle')}</h2><p className="discover-story-reveal"><span className="sr-only">{body}</span><span aria-hidden="true">{words.map((word,index)=><span key={index} className="discover-story-word" style={{'--word-progress':index/Math.max(1,words.length)} as CSSProperties}>{word}</span>)}</span></p><a className="discover-collector-guide" href="#questions"><Panda size={100} state="dayShift"/><span><strong>{c('humanTitle')}</strong><span>{c('trucTitle')} ↗</span></span></a></div>
      <p className="discover-constellation-caption">{c('imageLabel')}</p>
    </div>
  </section>;
}

/** Real inline word boxes, not a block hitbox. Native pointer and accessible text remain. */
function TitleInk({children}:{children:string}){
  const pieces=children.split(/(\s+)/);
  return <>{pieces.map((word,index)=>/\s+/.test(word)?word:<span key={index} className="discover-title-ink">{word}</span>)}</>;
}

function DiscoverNav({logoRef}:{logoRef:RefObject<SVGSVGElement|null>}){
  const {t}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const [open,setOpen]=useState(false);const dialog=useRef<HTMLDialogElement>(null);const button=useRef<HTMLButtonElement>(null);
  const [solid,setSolid]=useState(false);
  const navRoot=useRef<HTMLElement>(null);const {collapsed,expand}=useDiscoverNav(navRoot,open);
  useEffect(()=>{const opening=document.querySelector('.discover-opening');if(!opening)return;const observer=new IntersectionObserver(([entry])=>setSolid(!entry?.isIntersecting));observer.observe(opening);return()=>observer.disconnect();},[]);
  useEffect(()=>{const el=dialog.current;if(!el)return;if(open&&!el.open)el.showModal();if(!open&&el.open)el.close();},[open]);
  const close=()=>{setOpen(false);button.current?.focus({preventScroll:true});};
  return <header ref={navRoot} className="discover-nav-wrap" data-discover-nav="" data-solid={solid} data-collapsed={collapsed}>
    <nav className="discover-nav" aria-label={c('navigation')}><a href="#top" className="discover-brand" aria-label="PlayerOne"><AssemblyLogo ref={logoRef} className="discover-assembly-logo" surface="dark" aria-hidden="true"/></a>
      <div className="discover-nav-expanded" id="discover-nav-expanded" inert={collapsed} aria-hidden={collapsed}>
        <div className="discover-nav-destinations">{destinations.slice(0,2).map(destination=><a key={destination} href={`#${destination}`}>{c(destination)}</a>)}</div>
        <div className="discover-nav-tools"><Link className="discover-nav-login" to="/login">{c('forOperators')} ↗</Link></div>
        <button ref={button} className="discover-menu-button" onClick={()=>setOpen(true)} aria-label={c('menu')} aria-expanded={open} aria-controls="discover-menu"><span/><span/></button>
      </div>
      <button className="discover-nav-reveal" type="button" onClick={expand} tabIndex={collapsed?0:-1} aria-hidden={!collapsed} aria-label={c('menu')} aria-expanded={!collapsed} aria-controls="discover-nav-expanded"><span/><span/></button>
    </nav>
    <dialog id="discover-menu" className="discover-menu" ref={dialog} onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)} onClick={event=>{if(event.target===dialog.current)close();}} aria-label={c('navigation')}>
      <div className="discover-menu-panel"><div className="discover-menu-top"><span className="discover-brand"><AssemblyLogo className="discover-assembly-logo" title="PlayerOne"/></span><button onClick={close} aria-label={c('close')}>×</button></div>
        <div className="discover-menu-body"><div className="discover-menu-links">{destinations.map(destination=><a key={destination} href={`#${destination}`} onClick={close}>{c(destination)} <span aria-hidden="true">↗</span></a>)}</div>
        <a className="discover-menu-story" href="#story" onClick={close}><img src={`${DISCOVER_MEDIA}work-wide.webp`} alt=""/><span>{c('introTitle')} <b aria-hidden="true">↗</b></span><small>{c('aiLabel')}</small></a></div>
        <div className="discover-menu-bottom"><LocaleSwitch/><Link to="/login" className="discover-button" onClick={close}>{c('console')} ↗</Link></div>
      </div>
    </dialog>
  </header>;
}

function ReviewStory(){
  const root=useRef<HTMLElement>(null);useScrollScene(root);const story=useScrollStoryCopy();
  const {t}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const [verdict,setVerdict]=useState<'good'|'partial'|'reject'>('good');
  const icons:Record<typeof verdict,ReactNode>={good:<IconPass size={28}/>,partial:<IconPartial size={28}/>,reject:<IconReject size={28}/>};
  return <section ref={root} className="discover-review-scroll" id="review"><div className="discover-review-theatre discover-review-wide">
    <figure className="discover-review-film"><div className="discover-review-film-viewport"><DiscoverVideo src={`${DISCOVER_MEDIA}review.mp4`} poster={`${DISCOVER_MEDIA}review-poster.webp`} label={c('reviewFilmLabel')}/></div><figcaption>{c('reviewFilmLabel')}</figcaption></figure>
    <div className="discover-review-glass"><div className="discover-review-direction"><h2 className="discover-heading" data-discover-heading=""><span className="discover-review-first">{story.reviewFirst}</span><span className="discover-review-last">{story.reviewLast}</span></h2><p className="discover-lead">{c('humanBody')}</p></div><div className="discover-review-screen"><p className="discover-eyebrow">{c('reviewExample')}</p><div role="group" aria-label={c('reviewExample')} className="discover-verdict-options">{(['good','partial','reject'] as const).map(key=><button key={key} onClick={()=>setVerdict(key)} aria-pressed={verdict===key} className={`discover-verdict discover-verdict-${key}`}>{icons[key]}<span>{c(key)}</span></button>)}</div><p className="discover-review-explanation" aria-live="polite">{c(`${verdict}Body`)}</p></div></div>
  </div></section>;
}

/** Verified stock settings are separate from the labelled AI collector scenes. */
function SettingsStory(){
  const {t}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const settings=[
    {file:'setting-kitchen.jpg',label:'settingHome',author:'Pew Nguyen',href:'https://www.pexels.com/photo/bright-and-modern-kitchen-interior-with-sunlight-36671731/'},
    {file:'setting-workspace.webp',label:'settingWork',author:'Norbert Levajsics',href:'https://unsplash.com/photos/BMYQaySauY0'},
    {file:'setting-terraces.webp',label:'settingOutside',author:'Kevin Charit',href:'https://unsplash.com/photos/Vrc5-ejPprM'},
    {file:'setting-warehouse.webp',label:'settingEveryday',author:'Brian Wangenheim',href:'https://unsplash.com/photos/1Elnip2SeM8'},
  ];
  return <section className="discover-settings discover-shell">
    <div className="discover-centered-heading"><h2 className="discover-heading" data-discover-heading=""><TitleInk>{c('settingsTitle')}</TitleInk></h2><p className="discover-lead">{c('settingsBody')}</p><p className="discover-settings-disclosure">{c('stockLabel')}</p></div>
    <div className="discover-settings-gallery">{settings.map(item=><figure key={item.file}><img src={`/discover-media/${item.file}`} alt={c(item.label)} loading="lazy" decoding="async"/><figcaption><strong>{c(item.label)}</strong><a href={item.href} target="_blank" rel="noreferrer">{item.author} ↗</a></figcaption></figure>)}</div>
  </section>;
}
