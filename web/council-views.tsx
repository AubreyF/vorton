import React, { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { State } from "./types";
import { CouncilAvatar } from "./council-avatar";
import { getSessionVoices, type CouncilVoice } from "./council-presentation";
import "./council-views.css";
import { SessionTimeline } from "./council-timeline";
import { LoadingIndicator } from "./loading-indicator";

type Session = NonNullable<State["councilSessions"]>[number];
type OpenSubmission = { voice: CouncilVoice; anchor: HTMLButtonElement; closing?: boolean };
const tableGeometry = { centerX: 50, centerY: 44, radiusX: 37, radiusY: 36, portraitDiameter: 86, clearance: 64, maxTableScale: .62, orbitExtent: 1.24 };

const shortDate = (date: string) => new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fullDate = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
const plain = (text: string) => text.replace(/^#{1,6}\s+/gm, "").replace(/\*\*|__/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
const accent = (index: number) => ({ "--voice-accent": `var(--aub-chart-series-${index % 7 + 1}, var(--aub-accent))` }) as CSSProperties;

function VoiceText({ voice }: { voice: CouncilVoice }) {
  return <>{voice.submission ? plain(voice.submission) : "No individual submission was recorded for this session."}</>;
}

function Roundtable({ voices, session, onOpen, expandedId }: { voices: CouncilVoice[]; session: Session; onOpen: (submission: OpenSubmission | null) => void; expandedId?: string }) {
  const layout = useRef<HTMLElement>(null);
  const [tableScale, setTableScale] = useState(tableGeometry.maxTableScale);
  useLayoutEffect(() => {
    const element = layout.current;
    if (!element) return;
    const update = () => {
      const smallerRadius = Math.min(element.clientWidth * tableGeometry.radiusX / 100, element.clientHeight * tableGeometry.radiusY / 100);
      if (smallerRadius <= 0) return;
      const inset = tableGeometry.portraitDiameter / 2 + tableGeometry.clearance;
      // Size the complete Orrery by its outermost orbital curve. The crossing
      // orbits extend beyond the main oval while all curves clear the portraits.
      setTableScale(Math.max(.1, Math.min(tableGeometry.maxTableScale, (1 - inset / smallerRadius) / tableGeometry.orbitExtent)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Large custom rosters and small screens use normal flow to keep bubbles apart.
  const height = Math.max(1100, Math.ceil(voices.length / 2) * 200);
  const geometry = {
    "--table-height": `${height}px`,
    "--portrait-diameter": `${tableGeometry.portraitDiameter}px`,
    "--table-center-x": `${tableGeometry.centerX}%`,
    "--table-center-y": `${tableGeometry.centerY}%`,
    "--council-table-width": `${2 * tableGeometry.radiusX * tableScale}%`,
    "--council-table-height": `${2 * tableGeometry.radiusY * tableScale}%`,
  } as CSSProperties;
  return <section ref={layout} className="roundtable-layout" data-table-treatment="orrery" data-large-roster={voices.length > 10 ? "true" : undefined} aria-label="Circular council" style={geometry}>
    <div className="council-table" aria-hidden="true"><svg className="council-orbits" viewBox="-100 -100 200 200" preserveAspectRatio="none" fill="none" stroke="currentColor"><ellipse rx="94" ry="94" vectorEffect="non-scaling-stroke"/><ellipse rx="124" ry="72" transform="rotate(28)" vectorEffect="non-scaling-stroke"/><ellipse rx="124" ry="72" transform="rotate(-28)" vectorEffect="non-scaling-stroke"/></svg><strong>{shortDate(session.publishedAt)}</strong><span className="table-instruction">Choose a voice<br/>to hear their thinking</span></div>
    <div className="roundtable-seats">{voices.map((voice,index)=> {
      const angle = -Math.PI/2 + index * 2*Math.PI / voices.length;
      // These coordinates locate the portrait center, independent of text height.
      const style = { ...accent(index), "--seat-x": `${tableGeometry.centerX + tableGeometry.radiusX * Math.cos(angle)}%`, "--seat-y": `${tableGeometry.centerY + tableGeometry.radiusY * Math.sin(angle)}%` } as CSSProperties;
      return <button type="button" key={voice.identity.id} className="council-seat" style={style} onClick={event=>onOpen(expandedId === voice.identity.id ? null : { voice, anchor: event.currentTarget })} aria-haspopup="dialog" aria-expanded={expandedId === voice.identity.id} aria-label={`Read ${voice.identity.name}'s ${voice.source === "missing" ? "profile" : "submission"}`}>
        <span className="seat-portrait"><CouncilAvatar identity={voice.identity} size={76}/></span><strong>{voice.identity.name}</strong><span className="seat-bubble"><span className="seat-source">{voice.sourceLabel}</span><span className="submission-preview"><VoiceText voice={voice}/></span></span>
      </button>;
    })}</div>
  </section>;
}

function SubmissionContent({ voice, state, onClose, headingId }: { voice: CouncilVoice; state: State; onClose: () => void; headingId: string }) {
  return <>
    <div className="submission-dialog-header"><CouncilAvatar identity={voice.identity} size={86}/><div><span className="council-kicker">{voice.sourceLabel}</span><h2 id={headingId}>{voice.identity.name}</h2><p>{voice.identity.title}</p></div><button type="button" className="submission-close" onClick={onClose} aria-label="Close submission" autoFocus><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M7 7L25 25M25 7L7 25"/></svg></button></div>
    <div className="submission-full">{voice.submission ? voice.submission.split(/\n\s*\n/).map((paragraph,index)=><p key={index}>{plain(paragraph)}</p>) : <p>No individual submission was recorded for this session.</p>}</div>
    {voice.recommendations.length > 0 && <section className="submission-recommendations"><h3>Recommendations from this voice</h3>{voice.recommendations.map(r=><a key={r.id} href={`/${state.profile.toLowerCase()}/council#recommendation-${r.id}`} onClick={onClose}><span>{r.proposal.title}</span><span className="badge">{r.status}</span></a>)}</section>}
    <details className="submission-profile"><summary>About this council identity</summary><p>{voice.identity.mandate}</p><p><strong>Blind spot:</strong> {voice.identity.blindSpot}</p><p><strong>Challenge:</strong> {voice.identity.challenge}</p></details>
  </>;
}

type BubblePlacement = { left: number; width: number; maxHeight: number; top?: number; bottom?: number; tail: number; side: "above" | "below" };

function previewBounds(anchor: HTMLButtonElement) {
  const preview = anchor.querySelector<HTMLElement>(".seat-bubble");
  if (!preview) return null;
  const bounds = preview.getBoundingClientRect();
  // The preview scales around its top center. Recover its layout rectangle so
  // opening and closing still target the full preview while it is collapsed.
  return { left: bounds.left + bounds.width / 2 - preview.offsetWidth / 2, top: bounds.top, width: preview.offsetWidth, height: preview.offsetHeight };
}

function placeSubmission(anchor: HTMLButtonElement): BubblePlacement | null {
  const container = anchor.closest<HTMLElement>(".council-experience");
  if (!container) return null;
  const containerBounds = container.getBoundingClientRect();
  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  const originX = viewport?.offsetLeft ?? 0;
  const originY = viewport?.offsetTop ?? 0;
  if (width < 1024 || height < 500) return null;
  const portrait = anchor.querySelector(".seat-portrait")?.getBoundingClientRect() ?? anchor.getBoundingClientRect();
  const preview = previewBounds(anchor) ?? portrait;
  if (portrait.bottom < originY + 16 || portrait.top > originY + height - 16) return null;
  const below = originY + height - preview.top - 24;
  const above = portrait.top - originY - 38;
  if (Math.max(below, above) < 320) return null;
  const bubbleWidth = Math.min(580, width - 48);
  const center = portrait.left + portrait.width / 2;
  const left = Math.max(originX + 24, Math.min(center - bubbleWidth / 2, originX + width - bubbleWidth - 24));
  const table = anchor.closest(".roundtable-layout")?.querySelector(".council-table")?.getBoundingClientRect();
  const tableCenter = table ? table.top + table.height / 2 : originY + height / 2;
  const preferred = portrait.top + portrait.height / 2 <= tableCenter ? "below" : "above";
  const preferredSpace = preferred === "below" ? below : above;
  const otherSpace = preferred === "below" ? above : below;
  // Open toward the table, but flip when that side would squeeze the reading
  // surface and the opposite side has more usable viewport space.
  const side = preferredSpace < 420 && otherSpace > preferredSpace
    ? preferred === "below" ? "above" : "below"
    : preferred;
  // Like the shared appearance tooltip, this surface belongs to its local
  // positioned container. Page scrolling then carries it with the avatar.
  const containerLeft = containerBounds.left + container.clientLeft - container.scrollLeft;
  const containerTop = containerBounds.top + container.clientTop - container.scrollTop;
  return {
    left: left - containerLeft, width: bubbleWidth,
    maxHeight: Math.min(640, side === "below" ? below : above),
    ...(side === "below" ? { top: preview.top - containerTop } : { bottom: container.clientHeight - (portrait.top - containerTop) + 14 }),
    tail: Math.max(20, Math.min(bubbleWidth - 20, center - left)),
    side,
  };
}

function CenteredSubmission({ children, headingId, onClose }: { children: ReactNode; headingId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog className="council-submission-dialog" ref={dialog} aria-labelledby={headingId} onClose={onClose} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) onClose();
  }}>{children}</dialog>;
}

function SubmissionDetail({ opened, state, onClose }: { opened: OpenSubmission; state: State; onClose: () => void }) {
  const { voice, anchor } = opened;
  const [placement, setPlacement] = useState(() => placeSubmission(anchor));
  const bubble = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const close = useRef(onClose);
  const activeAnimation = useRef<Animation | null>(null);
  const closing = useRef(false);
  close.current = onClose;
  function requestClose() {
    if (closing.current) return;
    closing.current = true;
    const element = bubble.current;
    const preview = anchor.isConnected ? previewBounds(anchor) : null;
    if (!element || !preview || matchMedia("(prefers-reduced-motion: reduce)").matches) { close.current(); return; }
    const current = getComputedStyle(element);
    const start = { transform: current.transform, opacity: current.opacity };
    activeAnimation.current?.cancel();
    const expanded = element.getBoundingClientRect();
    if (!expanded.width || !expanded.height) { close.current(); return; }
    const animation = element.animate([
      start,
      { transform: `translate(${preview.left - expanded.left}px, ${preview.top - expanded.top}px) scale(${preview.width / expanded.width}, ${preview.height / expanded.height})`, opacity: .35 },
    ], { duration: 220, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" });
    activeAnimation.current = animation;
    void animation.finished.then(() => {
      if (activeAnimation.current === animation) close.current();
    }).catch(() => { /* Switching identity or session cancels the previous exit. */ });
  }
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => { if (opened.closing) requestCloseRef.current(); }, [opened.closing]);
  useEffect(() => () => activeAnimation.current?.cancel(), []);
  useLayoutEffect(() => {
    const element = bubble.current;
    if (!element || closing.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const preview = previewBounds(anchor);
    const expanded = element.getBoundingClientRect();
    if (!preview || !expanded.width || !expanded.height) return;
    const animation = element.animate([
      { transform: `translate(${preview.left - expanded.left}px, ${preview.top - expanded.top}px) scale(${preview.width / expanded.width}, ${preview.height / expanded.height})`, opacity: .6 },
      { transform: "none", opacity: 1 },
    ], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
    activeAnimation.current = animation;
    return () => { if (activeAnimation.current === animation) animation.cancel(); };
  }, [anchor, Boolean(placement)]);
  useEffect(() => {
    const update = () => setPlacement(placeSubmission(anchor));
    const container = anchor.closest<HTMLElement>(".council-experience");
    const observer = new ResizeObserver(update);
    if (container) observer.observe(container);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);
  useEffect(() => {
    if (!placement) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !bubble.current?.contains(event.target) && !anchor.contains(event.target)) requestCloseRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); requestCloseRef.current(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [anchor, Boolean(placement)]);
  const content = <SubmissionContent voice={voice} state={state} headingId={headingId} onClose={requestClose} />;
  if (!placement) return <CenteredSubmission headingId={headingId} onClose={requestClose}>{content}</CenteredSubmission>;
  const { tail, side, ...position } = placement;
  return <div className="council-submission-popover" role="dialog" aria-modal="false" aria-labelledby={headingId} ref={bubble} data-side={side} style={{ ...position, "--submission-tail-left": `${tail}px` } as CSSProperties}>
    <div className="submission-popover-scroll">{content}</div>
  </div>;
}

export function CouncilExperience({ state, renderEvidence }: { state: State; renderEvidence: (session: Session) => ReactNode }) {
  const sessions = [...(state.councilSessions ?? [])].sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt));
  const [selectedId, setSelectedId] = useState(sessions.at(-1)?.id ?? "");
  const [opened, setOpened] = useState<OpenSubmission | null>(null);
  const [hashSessionId, setHashSessionId] = useState("");
  const lastHash = useRef<string | null>(null);
  const listed = sessions.find(s=>s.id === selectedId) ?? sessions.at(-1);
  const [hydrated, setHydrated] = useState<{profile:string; session:Session} | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyRetry, setHistoryRetry] = useState(0);
  const selected = listed?.summaryDeferred && hydrated?.profile === state.profile && hydrated.session.id === listed.id ? hydrated.session : listed;
  useEffect(() => {
    setHistoryError("");
    if (!listed?.summaryDeferred) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/${state.profile.toLowerCase()}/state?councilSession=${encodeURIComponent(listed.id)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("The saved Council report could not be loaded.");
        const result = await response.json() as State;
        const session = result.councilSessions?.find(s => s.id === listed.id);
        if (result.profile !== state.profile || !session || session.summaryDeferred) throw new Error("The saved Council report is unavailable in this workspace.");
        if (!controller.signal.aborted) setHydrated({ profile: state.profile, session });
      } catch (error) {
        if (!controller.signal.aborted) setHistoryError((error as Error).message);
      }
    })();
    return () => controller.abort();
  }, [state.profile, listed?.id, listed?.summaryDeferred, historyRetry]);
  const voices = selected ? getSessionVoices(state, selected) : [];
  useEffect(()=> {
    const chooseHash = () => {
      if (lastHash.current === location.hash) return;
      lastHash.current = location.hash;
      const id = location.hash.replace(/^#session-/, "");
      if (sessions.some(s=>s.id === id)) { setSelectedId(id); setOpened(null); setHashSessionId(id); }
    };
    chooseHash();
    window.addEventListener("hashchange", chooseHash);
    return ()=>window.removeEventListener("hashchange", chooseHash);
  }, [state.profile, state.councilSessions]);
  useEffect(()=> {
    if (hashSessionId && selected?.id === hashSessionId) {
      document.getElementById(`session-${hashSessionId}`)?.scrollIntoView({block:"start"});
      setHashSessionId("");
    }
  }, [hashSessionId, selected?.id]);
  return <div className="council-experience" data-council-layout="roundtable">
    <div id="council-timeline"><SessionTimeline sessions={sessions} selected={selected?.id ?? ""} onSelect={id=>{
      setSelectedId(id);setOpened(null);setHashSessionId("");
      lastHash.current = `#session-${id}`;
      history.replaceState(null,"",`${location.pathname}${location.search}${lastHash.current}`);
    }}/></div>
    {selected?.summaryDeferred ? <section id="council-roundtable" aria-label="Saved Council report">{historyError ? <><p role="alert">{historyError}</p><button onClick={() => setHistoryRetry(value => value + 1)}>Retry report</button></> : <LoadingIndicator label="Loading saved Council report"/>}</section> : selected ? <>
      <div className="council-view-stage" id="council-roundtable" key={`stage-${selected.id}`}>
        <div id={`session-${selected.id}`}><Roundtable voices={voices} session={selected} onOpen={next=>setOpened(current=>next ?? (current ? {...current,closing:true} : null))} expandedId={opened?.voice.identity.id}/></div>
      </div>
      {voices.some(voice=>voice.rosterSource === "current") && <p className="council-attribution">This older receipt did not save its roster. The current council identities are shown; only recorded text is attributed.</p>}
      <section className="council-evidence" id="council-session-record" key={`evidence-${selected.id}`} aria-label="Council session report">{renderEvidence(selected)}</section>
    </> : <><div className="council-empty" id="council-roundtable"><div className="empty-portrait-line">{state.council?.identities.slice(0,9).map(identity=><CouncilAvatar key={identity.id} identity={identity} size={72}/>)}</div><h2>The table is ready.</h2><p>Your first published session will bring these voices into the conversation.</p></div><section className="council-evidence" id="council-session-record" aria-label="Council session report"><article className="panel council-session"><h2>Council session</h2><p>No session report has been published yet.</p></article></section></>}
    {opened && <SubmissionDetail key={opened.voice.identity.id} opened={opened} state={state} onClose={()=>setOpened(null)}/>}
  </div>;
}


/** Latest saved briefing, shared by both Bridge implementations. */
export function RoundtableBriefing({state}: {state: State}) {
  const session = [...(state.councilSessions ?? [])].sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt)).at(-1);
  const headingId = useId();
  if (!session) return <section className="council-bridge-briefing"><h2>Latest council briefing</h2><p>No briefing has been published yet.</p><a href={`/${state.profile.toLowerCase()}/council`}>Open Council</a></section>;
  // Resolve the stable role from this session's saved roster, not its display name.
  const ceo = getSessionVoices(state,session).find(voice=>voice.identity.id === "CEO");
  return <section className="council-experience council-bridge-briefing" aria-label="Latest council briefing">
    <div className="council-session-brief"><div><span className="council-kicker">Latest council briefing</span><h2>{fullDate(session.publishedAt)}</h2></div><a href={`/${state.profile.toLowerCase()}/council#session-${session.id}`}>Open Council ↗</a></div>
    <div className="bridge-briefing-columns">
      <div className="bridge-council-emblem">
        <div className="council-table" aria-hidden="true"><svg className="council-orbits" viewBox="-100 -100 200 200" preserveAspectRatio="none" fill="none" stroke="currentColor"><ellipse rx="94" ry="94" vectorEffect="non-scaling-stroke"/><ellipse rx="124" ry="72" transform="rotate(28)" vectorEffect="non-scaling-stroke"/><ellipse rx="124" ry="72" transform="rotate(-28)" vectorEffect="non-scaling-stroke"/></svg></div>
        {ceo && <div className="bridge-ceo" style={accent(0)}><span className="seat-portrait"><CouncilAvatar identity={ceo.identity} size={64}/></span><strong>{ceo.identity.name}</strong></div>}
      </div>
      <article className="bridge-briefing-box" aria-labelledby={headingId}>
        <span className="council-kicker">{ceo?.sourceLabel ?? "No saved submission"}</span>
        <h3 id={headingId}>{ceo?.identity.name ?? "CEO"}’s briefing</h3>
        <div className="bridge-briefing-copy">{ceo?.submission ? ceo.submission.split(/\n\s*\n/).map((paragraph,index)=><p key={index}>{plain(paragraph)}</p>) : <p>No CEO submission was recorded for this session.</p>}</div>
      </article>
    </div>
  </section>;
}
