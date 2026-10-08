"use client";
import { useEffect, useRef, useState, type MouseEventHandler } from "react";

export type WorkspaceLink = {id:string;label:string;path:string;onClick?:MouseEventHandler<HTMLAnchorElement>};
export function WorkspaceNavigation({profile,page,links,level='primary',controls}: {profile:string;page:string;links:WorkspaceLink[];level?:'primary'|'secondary';controls?:string}) {
  const navigation=useRef<HTMLElement>(null);
  const [overflow,setOverflow]=useState({left:false,right:false});
  function updateOverflow(){const nav=navigation.current;if(nav)setOverflow({left:nav.scrollLeft>2,right:nav.scrollWidth-nav.clientWidth-nav.scrollLeft>2});}
  useEffect(()=>{
    const nav=navigation.current;if(!nav)return;
    // Font and viewport changes can push the active section outside the rail.
    // Scroll only the rail. An inline secondary nav must not move the whole
    // document underneath the fixed application header.
    const revealActive=()=>{const active=nav.querySelector<HTMLElement>('[aria-current="page"]');if(active){const item=active.getBoundingClientRect(),rail=nav.getBoundingClientRect();if(item.left<rail.left||item.right>rail.right)nav.scrollLeft+=item.left-rail.left-(rail.width-item.width)/2;}updateOverflow();};
    const observer=new ResizeObserver(revealActive);observer.observe(nav);if(nav.firstElementChild)observer.observe(nav.firstElementChild);revealActive();return()=>observer.disconnect();
  },[page,profile]);
  function scroll(direction:number){const nav=navigation.current;if(!nav)return;nav.scrollBy({left:direction*Math.max(120,nav.clientWidth*.7),behavior:'auto'});nav.focus({preventScroll:true});}
  return <div className={`view-nav-shell ${level}-nav-shell`}>
    {overflow.left&&<button type="button" className="nav-scroll-control nav-scroll-left" aria-label="Scroll sections left" onClick={()=>scroll(-1)}><span aria-hidden="true">‹</span></button>}
    <nav ref={navigation} tabIndex={-1} onScroll={updateOverflow} data-overflow-left={overflow.left?'true':undefined} data-overflow-right={overflow.right?'true':undefined} className={`view-nav ${level}-nav`} aria-label={`${profile} sections`}><div className={`view-nav-track ${level}-nav-track`}>{links.map(link=><a key={link.id} className={`nav-button ${level}-nav-link${link.id===page?' active':''}`} href={link.path} aria-current={link.id===page?'page':undefined} aria-controls={controls} onClick={link.onClick}>{link.label}</a>)}</div></nav>
    {overflow.right&&<button type="button" className="nav-scroll-control nav-scroll-right" aria-label="Scroll sections right" onClick={()=>scroll(1)}><span aria-hidden="true">›</span></button>}
  </div>;
}
