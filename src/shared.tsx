import React,{useRef,useEffect} from 'react';import {X} from 'lucide-react';import {artWidth,artHeight} from './art';
export type Episode={id:string;number:number;title:string;duration:number;isDemo:boolean};
export type Drama={id:string;title:string;tagline:string;description:string;category:string;color:string;freeEpisodes:number;badge:string;cover:string;artIndex:number;likes:number;comments:number;saves:number;shares:number;episodes:Episode[]};
export type Progress={dramaId:string;episodeId:string;seconds:number;updated:number};
export type Viewer={plan:'free'|'basic'|'premium';admin:boolean;demoMode:boolean;demoAdminLogin:boolean;favorites:string[];profile:{id:string;nickname:string;bio:string};likes:string[];following:string[];followingPeople:string[];followers:number;unread:number;progress:Progress[]};
export type Ad={enabled:boolean;seconds:number;headline:string;sponsor:string;message:string};
export type Access={allowed:boolean;url:string|null;ad:Ad|null};
export async function api<T=any>(url:string,options:RequestInit={}):Promise<T>{
  const res=await fetch(url,{...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),'X-Requested-With':'Afterglow',...options.headers}});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'Something went wrong. Please try again.');return data;
}
export const post=(url:string,data:unknown={})=>api(url,{method:'POST',body:JSON.stringify(data)});
export function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{const previous=document.activeElement as HTMLElement;ref.current?.focus();const handler=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const nodes=Array.from(ref.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex="0"]')||[]);const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};const old=document.body.style.overflow;document.body.style.overflow='hidden';document.addEventListener('keydown',handler);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',handler);previous?.focus();};},[]);return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><button aria-label="Close dialog" onClick={onClose}><X size={22}/></button></div>{children}</div></div>}


export function Logo(){return <strong className="logo">PrimeDrama<span>®</span></strong>}
export function Cover({d}:{d:Drama}){return d.artIndex>=0?<svg className="cover" viewBox={`${d.artIndex%3*artWidth/3} ${Math.floor(d.artIndex/3)*artHeight/2} ${artWidth/3} ${artHeight/2}`} preserveAspectRatio="xMidYMin slice" aria-hidden="true"><image href="/assets/prime-posters.png" width={artWidth} height={artHeight}/></svg>:<img className="cover" src={d.cover} alt="" loading="lazy"/>}
