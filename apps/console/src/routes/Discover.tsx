/**
 * THESIS: everyday work becomes first-person material, then a human decision.
 * OWN-WORLD: warm paper, espresso Archivo, lavender interaction, real settings.
 * STORY: recognise the activity, try preparation, understand review and payment.
 * FIRST VIEWPORT: one slogan, then a rising full-width film with a lower title;
 * the action opens the working illustrative collector flow.
 * FORM: user-pinned Fixa takeover, Serus navigation, Flim image scale, Klarna close.
 * No generated image or demo state represents an actual enrolled collector.
 */
import {Fragment,useEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {useTranslation} from 'react-i18next';
import {Link} from '@tanstack/react-router';
import {LocaleSwitch} from '../components/shell/LocaleSwitch.tsx';
import {IconPass,IconPartial,IconReject} from '../components/icons.tsx';
import {PerspectiveTitle} from '../components/discover/PerspectiveTitle.tsx';
import {ScanMotif} from '../components/discover/ScanMotif.tsx';
import {DiscoverDemo} from '../components/discover/DiscoverDemo.tsx';
import {DiscoverHelp} from '../components/discover/DiscoverHelp.tsx';
import {DiscoverPrivacy} from '../components/discover/DiscoverPrivacy.tsx';
import {DISCOVER_MEDIA,DiscoverVideo,PovPicture} from '../components/discover/DiscoverMedia.tsx';
import {AssemblyLogo} from '../components/logo-animation/AssemblyLogo.tsx';
import {HeroLetterShuffle} from '../components/logo-animation/HeroLetterShuffle.tsx';
import {WhiteLogoIntro} from '../components/logo-animation/WhiteLogoIntro.tsx';
import {useDiscoverAmbient,useDiscoverMotion} from '../lib/discover-motion.ts';
import {useDiscoverIllustrationMotion} from '../lib/discover-illustration-motion.ts';
import '../styles/discover.css';
import '../styles/discover-warm.css';
import '../styles/discover-kinetics.css';
import {useDiscoverKinetics} from '../lib/discover-kinetics.ts';

const destinations=['demo','work','camera','review','questions'] as const;
const apk=typeof import.meta.env.VITE_COLLECTOR_APK_URL==='string'?import.meta.env.VITE_COLLECTOR_APK_URL:'';

export function DiscoverScreen(){
  const {t}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const root=useRef<HTMLDivElement>(null);
  const navLogo=useRef<SVGSVGElement>(null);
  useDiscoverMotion(root);useDiscoverAmbient(root);useDiscoverKinetics(root);
  const {paused,reduced,toggle}=useDiscoverIllustrationMotion(root);
  const motionControl=<button type="button" className="discover-illustration-toggle" aria-pressed={paused||reduced} disabled={reduced} onClick={toggle}>{c(reduced?'illustrationsReduced':paused?'resumeIllustrations':'pauseIllustrations')}<span aria-hidden="true">{paused||reduced?'▷':'Ⅱ'}</span></button>;
  return <div ref={root} className="discover-page" data-film-revealed="true" data-logo-complete="true" data-logo-played="false">
    <DiscoverNav logoRef={navLogo}/>
    <WhiteLogoIntro skipLabel={c('skip')}/>
    <main>
      <section className="discover-opening" data-opening="" id="top">
        <div className="discover-opening-stage">
          <div className="discover-opening-slogan" data-opening-slogan=""><p>{c('slogan')}</p></div>
          <div className="discover-opening-film" data-opening-film="">
            <DiscoverVideo opening src={`${DISCOVER_MEDIA}opening.mp4`} poster={`${DISCOVER_MEDIA}opening-poster.webp`} label={c('filmLabel')}/>
            <div className="discover-opening-copy discover-shell" data-opening-copy="">
              <HeroLetterShuffle animate={false}/>
              <p>{c('heroBody')}</p>
              <div className="discover-actions"><a className="discover-button discover-button-light" href="#demo">{c('explore')} <span aria-hidden="true">↗</span></a><a className="discover-opening-skip" href="#introduction">{c('scroll')} <span aria-hidden="true">↓</span></a></div>
            </div>
            <p className="discover-film-label">{c('filmLabel')}</p>
          </div>
          <a className="discover-skip-story" href="#introduction">{c('skip')} ↓</a>
          <p className="discover-mobile-scroll-cue"><span>{c('scroll')}</span><span aria-hidden="true">↓</span></p>
        </div>
      </section>

      <section className="discover-aperture-section discover-wide-intro" id="introduction" data-perspective-scroll="">
        <div className="discover-aperture-copy"><p className="discover-eyebrow">VNG PT Lab × PaXini</p><h2 className="discover-heading" data-discover-heading=""><PerspectiveTitle text={c('introTitle')}/></h2><p className="discover-lead">{c('introBody')}</p><div className="discover-product-callouts">{['Tasks','Review'].map(key=><div key={key}><h3>{c(`product${key}`)}</h3><p>{c(`product${key}Body`)}</p></div>)}</div></div>
        <div className="discover-product-specimen"><span className="discover-product-circle" aria-hidden="true"/><figure><PovPicture/><span className="discover-frame-corners" aria-hidden="true"/><figcaption>{c('povLabel')}</figcaption></figure></div>
      </section>

      <section className="discover-demo-section" id="demo">
        <div className="discover-section-heading discover-shell"><h2 className="discover-heading" data-discover-heading=""><TitleInk>{c('demoTitle')}</TitleInk></h2><p className="discover-lead">{c('demoBody')}</p></div>
        <DiscoverDemo motionControl={motionControl}/>
      </section>

      <section className="discover-work" id="work">
        <div className="discover-section-heading discover-shell"><h2 className="discover-heading" data-discover-heading=""><TitleInk>{c('workTitle')}</TitleInk></h2><div><p className="discover-lead">{c('workBody')}</p><p className="discover-image-label">{c('imageLabel')}</p></div></div>
        <div className="discover-collector-wall">
          <figure className="discover-collector-wide" data-discover-scene="photo" tabIndex={0}><img src={`${DISCOVER_MEDIA}work-wide.webp`} alt={c('imageWide')} loading="lazy" decoding="async" width={1920} height={1086}/><figcaption><span>01</span>{c('activityKitchen')}</figcaption></figure>
          <figure className="discover-collector-portrait" data-discover-scene="photo" tabIndex={0}><img src={`${DISCOVER_MEDIA}work-portrait.webp`} alt={c('imagePortrait')} loading="lazy" decoding="async" width={1440} height={1929}/><figcaption><span>02</span>{c('activityClothes')}</figcaption></figure>
          <figure className="discover-collector-detail" data-discover-scene="photo" tabIndex={0}><img src={`${DISCOVER_MEDIA}work-detail.webp`} alt={c('imageDetail')} loading="lazy" decoding="async" width={1440} height={1075}/><figcaption><span>03</span>{c('activityPacking')}</figcaption></figure>
        </div>
      </section>

      <SettingsStory/>
      <section className="discover-camera-section discover-shell" id="camera"><div className="discover-centered-heading"><p className="discover-eyebrow">Ego · PaXini</p><h2 className="discover-heading" data-discover-heading=""><TitleInk>{c('cameraTitle')}</TitleInk></h2><p className="discover-lead">{c('cameraBody')}</p></div></section>
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
    </main>
    <footer className="discover-footer">
      <div className="discover-footer-top discover-shell"><div className="discover-footer-identity"><a href="#top" className="discover-brand" aria-label="PlayerOne"><AssemblyLogo className="discover-assembly-logo" surface="dark" title="PlayerOne"/></a><p>{c('partners')}</p></div><nav aria-label={c('footerExplore')}><h3>{c('footerExplore')}</h3>{destinations.map(destination=><a href={`#${destination}`} key={destination}>{c(destination)}</a>)}</nav><nav aria-label={c('footerStart')}><h3>{c('footerStart')}</h3><a href="#demo">{c('explore')}</a><Link to="/login">{c('console')}</Link><Link to="/privacy">{c('footerPrivacy')}</Link></nav></div>
      <div className="discover-wordmark discover-shell" aria-hidden="true"><AssemblyLogo monochrome/></div>
      <div className="discover-footer-bottom discover-shell"><p>{c('footerNote')}</p><DiscoverPrivacy/><Link to="/login">{c('console')} ↗</Link></div>
    </footer>
  </div>;
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
  useEffect(()=>{const opening=document.querySelector('.discover-opening');if(!opening)return;const observer=new IntersectionObserver(([entry])=>setSolid(!entry?.isIntersecting));observer.observe(opening);return()=>observer.disconnect();},[]);
  useEffect(()=>{const el=dialog.current;if(!el)return;if(open&&!el.open)el.showModal();if(!open&&el.open)el.close();},[open]);
  const close=()=>{setOpen(false);button.current?.focus({preventScroll:true});};
  return <header className="discover-nav-wrap" data-discover-nav="" data-solid={solid}>
    <nav className="discover-nav" aria-label={c('navigation')}><a href="#top" className="discover-brand" aria-label="PlayerOne"><AssemblyLogo ref={logoRef} className="discover-assembly-logo" surface="dark" aria-hidden="true"/></a>
      <div className="discover-nav-destinations">{destinations.slice(0,4).map(destination=><a key={destination} href={`#${destination}`}>{c(destination)}</a>)}</div>
      <div className="discover-nav-tools"><LocaleSwitch/><Link className="discover-nav-login" to="/login">{c('console')} ↗</Link></div>
      <button ref={button} className="discover-menu-button" onClick={()=>setOpen(true)} aria-label={c('menu')} aria-expanded={open} aria-controls="discover-menu"><span/><span/></button>
    </nav>
    <dialog id="discover-menu" className="discover-menu" ref={dialog} onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)} onClick={event=>{if(event.target===dialog.current)close();}} aria-label={c('navigation')}>
      <div className="discover-menu-panel"><div className="discover-menu-top"><span className="discover-brand"><AssemblyLogo className="discover-assembly-logo" title="PlayerOne"/></span><button onClick={close} aria-label={c('close')}>×</button></div>
        <div className="discover-menu-links">{destinations.map(destination=><a key={destination} href={`#${destination}`} onClick={close}>{c(destination)} <span aria-hidden="true">↗</span></a>)}</div>
        <LocaleSwitch/><Link to="/login" className="discover-button" onClick={close}>{c('console')} ↗</Link>
      </div>
    </dialog>
  </header>;
}

function ReviewStory(){
  const {t}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const [verdict,setVerdict]=useState<'good'|'partial'|'reject'>('good');
  const icons:Record<typeof verdict,ReactNode>={good:<IconPass size={28}/>,partial:<IconPartial size={28}/>,reject:<IconReject size={28}/>};
  return <section className="discover-review-theatre discover-review-wide" id="review">
    <figure className="discover-review-film"><div className="discover-review-film-viewport"><DiscoverVideo src={`${DISCOVER_MEDIA}review.mp4`} poster={`${DISCOVER_MEDIA}review-poster.webp`} label={c('reviewFilmLabel')}/></div><figcaption>{c('reviewFilmLabel')}</figcaption></figure>
    <div className="discover-review-glass"><div className="discover-review-direction"><h2 className="discover-heading" data-discover-heading=""><TitleInk>{c('humanTitle')}</TitleInk></h2><p className="discover-lead">{c('humanBody')}</p></div><div className="discover-review-screen"><p className="discover-eyebrow">{c('reviewExample')}</p><div role="group" aria-label={c('reviewExample')} className="discover-verdict-options">{(['good','partial','reject'] as const).map(key=><button key={key} onClick={()=>setVerdict(key)} aria-pressed={verdict===key} className={`discover-verdict discover-verdict-${key}`}>{icons[key]}<span>{c(key)}</span></button>)}</div><p className="discover-review-explanation" aria-live="polite">{c(`${verdict}Body`)}</p></div></div>
  </section>;
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
    <details className="discover-stories-placeholder"><summary>{c('storiesSoon')}<span aria-hidden="true">+</span></summary><p>{c('storiesBody')}</p></details>
  </section>;
}
