// @vitest-environment jsdom
import {createInstance} from 'i18next';
import type {AnchorHTMLAttributes} from 'react';
import {I18nextProvider} from 'react-i18next';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {DISCOVER_COPY} from '../lib/discover-copy.ts';
import {CinematicOpening,CollectorStory} from './Discover.tsx';

vi.mock('@tanstack/react-router',()=>({Link:({to,...props}:{to:string}&AnchorHTMLAttributes<HTMLAnchorElement>)=><a href={to} {...props}/>}));

it.each(['en','vi','zh'] as const)('preserves the %s accessible story, original opening film and working destinations',async(locale)=>{
  const i18n=createInstance();
  const copy=DISCOVER_COPY[locale];
  await i18n.init({lng:locale,keySeparator:false,resources:{[locale]:{translation:Object.fromEntries(Object.entries(copy).map(([key,value])=>[`discoverV2.${key}`,value]))}}});
  const host=document.createElement('div');
  host.innerHTML=renderToStaticMarkup(<I18nextProvider i18n={i18n}><CollectorStory/></I18nextProvider>);
  const paragraph=host.querySelector('.discover-story-reveal')!;
  const readable=paragraph.cloneNode(true) as HTMLElement;
  readable.querySelectorAll('[aria-hidden="true"]').forEach(element=>element.remove());
  expect(readable.textContent).toBe(copy.workBody);
  expect(readable.querySelector('.sr-only')?.getAttribute('aria-hidden')).toBeNull();
  expect(paragraph.hasAttribute('aria-label')).toBe(false);
  const visual=paragraph.querySelector('[aria-hidden="true"]')!;
  expect(visual.textContent).toBe(copy.workBody);
  const segments=visual.querySelectorAll<HTMLElement>('.discover-story-word');
  expect(segments.length).toBeGreaterThan(1);
  const progress=Array.from(segments,segment=>Number(segment.style.getPropertyValue('--word-progress')));
  expect(progress.every((value,index)=>index===0||value>progress[index-1]!)).toBe(true);
  host.innerHTML=renderToStaticMarkup(<I18nextProvider i18n={i18n}><CinematicOpening/></I18nextProvider>);
  expect(host.querySelectorAll('video')).toHaveLength(1);
  expect(host.querySelector('video')?.getAttribute('poster')).toBe('/discover-media/20260909/opening-poster.webp');
  expect(host.querySelector('video')?.getAttribute('aria-label')).toBe(copy.filmLabel);
  expect(host.querySelector('h1')?.textContent).toBe(copy.heroA+copy.heroB);
  expect(host.querySelector('a[href="#demo"]')?.textContent).toContain(copy.explore);
  expect(host.querySelector('a[href="/login"]')?.textContent).toBe(copy.forOperators);
  expect(host.querySelector('.discover-cinema-wordmark')?.closest('[aria-hidden="true"]')).not.toBeNull();
});
