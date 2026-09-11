import {useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import '../../styles/sheets.css';

export function useCompactSheet(){
  const [compact,setCompact]=useState(()=>matchMedia('(max-width: 767px)').matches);
  useEffect(()=>{const media=matchMedia('(max-width: 767px)');const update=()=>setCompact(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  return compact;
}

/** One native modal: platform focus containment, owned scroll lock, no nested overlay. */
export function ResponsiveSheet({title,onClose,children,footer,dismissible=true,draggable=true}:{
  title:string;onClose:()=>void;children:ReactNode;footer?:ReactNode;dismissible?:boolean;draggable?:boolean;
}){
  const {t}=useTranslation();const titleId=useId();const dialog=useRef<HTMLDialogElement>(null);const heading=useRef<HTMLHeadingElement>(null);
  const close=useRef(onClose);close.current=onClose;
  const drag=useRef<{start:number;delta:number}|null>(null);
  const compact=useCompactSheet();
  useLayoutEffect(()=>{
    const node=dialog.current;if(!node)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const root=document.documentElement;const overflow=root.style.overflow;const gutter=root.style.scrollbarGutter;
    root.style.scrollbarGutter='stable';root.style.overflow='hidden';node.showModal();heading.current?.focus({preventScroll:true});
    return()=>{node.close();root.style.overflow=overflow;root.style.scrollbarGutter=gutter;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  return <dialog ref={dialog} className="workspace-sheet" aria-labelledby={titleId}
    onCancel={event=>{event.preventDefault();if(dismissible)close.current();}}
    onKeyDown={event=>event.stopPropagation()}
    onClick={event=>{if(!dismissible||event.target!==event.currentTarget)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close.current();}}>
    {compact&&draggable&&dismissible?<div className="workspace-sheet-handle" aria-hidden="true"
      onPointerDown={event=>{if(event.button!==0)return;drag.current={start:event.clientY,delta:0};event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{if(!drag.current)return;drag.current.delta=Math.max(0,event.clientY-drag.current.start);if(dialog.current)dialog.current.style.transform=`translateY(${drag.current.delta}px)`;}}
      onPointerUp={()=>{const delta=drag.current?.delta??0;drag.current=null;if(dialog.current)dialog.current.style.transform='';if(delta>96)close.current();}}
      onPointerCancel={()=>{drag.current=null;if(dialog.current)dialog.current.style.transform='';}}><span/></div>:null}
    <header className="workspace-sheet-header"><h2 ref={heading} tabIndex={-1} id={titleId}>{title}</h2><button type="button" className="workspace-button" disabled={!dismissible} onClick={()=>close.current()}>{t('episodes.close')}</button></header>
    <div className="workspace-sheet-body">{children}</div>
    {footer?<footer className="workspace-sheet-footer">{footer}</footer>:null}
  </dialog>;
}
