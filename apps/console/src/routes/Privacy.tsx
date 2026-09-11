import {useTranslation} from 'react-i18next';
import {AssemblyLogo} from '../components/logo-animation/AssemblyLogo.tsx';
import {LocaleSwitch} from '../components/shell/LocaleSwitch.tsx';
import {DiscoverPrivacy} from '../components/discover/DiscoverPrivacy.tsx';
import '../styles/discover.css';

export function PrivacyScreen(){
  const {t}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  return <div className="discover-page discover-privacy-page"><header><a href="/discover" aria-label="PlayerOne"><AssemblyLogo className="discover-assembly-logo"/></a><LocaleSwitch/></header><main><a className="discover-text-link" href="/discover">← {c('privacyBack')}</a><p className="discover-eyebrow">{c('privacyDraft')}</p><h1 className="discover-heading">{c('privacyTitle')}</h1><p className="discover-lead">{c('privacyIntro')}</p>{['Local','Demo','Studio','Cookies','Scope'].map(section=><section key={section}><h2>{c(`privacy${section}Title`)}</h2><p>{c(`privacy${section}Body`)}</p></section>)}</main><footer><DiscoverPrivacy/></footer></div>;
}
