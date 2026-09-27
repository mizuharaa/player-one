// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {OperatorDemo} from './OperatorDemo.tsx';

vi.mock('react-i18next',()=>({useTranslation:()=>({i18n:{language:'en'},t:(key:string)=>key})}));
vi.mock('../../lib/use-demo-cursor',()=>({useDemoCursor:()=>{}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;

it('lets a person inspect each demo step without sending a real review or payment',async()=>{
  vi.stubGlobal('IntersectionObserver',class{observe(){}disconnect(){}});
  vi.stubGlobal('fetch',vi.fn());
  const pause=vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  const host=document.createElement('div');
  const root=createRoot(host);
  const click=async(selector:string)=>{
    const button=host.querySelector<HTMLButtonElement>(selector);
    expect(button).not.toBeNull();
    await act(async()=>button!.click());
  };
  try{
    await act(async()=>root.render(<OperatorDemo motionPaused={false} reducedMotion/>));
    const pauseButton=host.querySelector<HTMLButtonElement>('.operator-window-toggle')!;
    await act(async()=>{pauseButton.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true}));pauseButton.click();});
    expect(pauseButton.getAttribute('aria-pressed')).toBe('true');
    await click('[data-demo-target="open"]');
    for(let index=0;index<3;index++)await click(`[data-demo-target="criterion-${index}"]`);
    expect(host.querySelectorAll('.operator-criteria [aria-pressed="true"]')).toHaveLength(3);
    await click('[data-demo-target="next"]');
    expect(host.querySelector('.operator-window')?.getAttribute('data-step')).toBe('2');
    await click('[data-demo-target="next"]');
    expect(host.querySelector('.operator-window')?.getAttribute('data-step')).toBe('3');
    await click('[data-demo-target="confirm"]');
    expect(host.querySelector('.operator-receipt')?.getAttribute('aria-hidden')).toBe('false');
    expect(host.querySelector('.operator-disclosure')?.textContent).toContain('no money is transferred');
    expect(fetch).not.toHaveBeenCalled();
    await click('[data-demo-target="next"]');
    expect(host.querySelector('.operator-window')?.getAttribute('data-step')).toBe('0');
    expect(host.querySelectorAll('.operator-criteria [aria-pressed="true"]')).toHaveLength(0);
  }finally{
    await act(async()=>root.unmount());pause.mockRestore();vi.unstubAllGlobals();
  }
});
