import React, { useId, useState } from "react";
import type { State } from "./types";
import { CouncilExperience } from "./council-views";
import { councilReadingText } from "./council-presentation";

// Render a deliberately small Markdown subset. Record text never becomes HTML.
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\((?:https?:\/\/|\/)[^\s)]+\))/g).map((part, i) => {
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^/][^\s)]*)\)$/.exec(part);
    return link ? <a key={i} href={link[2]} rel="noreferrer">{link[1]}</a> : part;
  });
}

export function ReportBody({ text }: { text: string }) {
  const cleaned = councilReadingText(text.replace(/^\(AI Generated\)\.\s*/, ""));
  // Old receipts contain one prose line. Break at sentence boundaries without
  // rewriting their claims; the exact saved source remains available below.
  const formatted = cleaned.includes("\n") ? cleaned : cleaned.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).reduce((out, sentence, i) => out + (i && i % 2 === 0 ? "\n\n" : i ? " " : "") + sentence.trim(), "");
  const blocks = formatted.split(/\n\s*\n/).filter(Boolean);
  return <div className="council-report-body">{blocks.map((block, i) => {
    const lines = block.split("\n");
    if (lines.length >= 2 && lines[0].includes("|") && /^\s*\|?\s*:?-{3}/.test(lines[1])) {
      const cells = (line: string) => line.replace(/^\s*\||\|\s*$/g, "").split("|").map(c => c.trim());
      return <div className="report-table" key={i}><table><thead><tr>{cells(lines[0]).map((c,j)=><th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{lines.slice(2).map((line,j)=><tr key={j}>{cells(line).map((c,k)=><td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table></div>;
    }
    if (lines.every(line => /^\s*[-*]\s+/.test(line))) return <ul key={i}>{lines.map((line,j)=><li key={j}>{inline(line.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul>;
    if (lines.every(line => /^\s*\d+\.\s+/.test(line))) return <ol key={i}>{lines.map((line,j)=><li key={j}>{inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>)}</ol>;
    return <React.Fragment key={i}>{lines.map((line,j) => /^#{1,6}\s+/.test(line) ? <h4 key={j}>{inline(line.replace(/^#{1,6}\s+/, ""))}</h4> : <p key={j}>{inline(line)}</p>)}</React.Fragment>;
  })}</div>;
}

export function CouncilHistory({state}: {state: State}) {
  return <CouncilExperience state={state} renderEvidence={session => <SessionEvidence state={state} session={session}/>} />;
}

function SessionEvidence({state, session}: {state: State; session: NonNullable<State["councilSessions"]>[number]}) {
    const [expanded, setExpanded] = useState(false);
    const contentId = useId();
    const recommendations = state.recommendations.filter(r => session.recommendationIds.includes(r.id));
    const displaySummary = councilReadingText(session.summary).replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, id => state.goals.find(g=>g.id===id)?.title ?? state.tasks.find(t=>t.id===id)?.title ?? state.recommendations.find(r=>r.id===id)?.proposal.title ?? `…${id.slice(-8)}`);
    // Preview the saved report without inventing another account of the session.
    const preview = displaySummary.replace(/^\(AI Generated\)\.\s*/, "").replace(/^#{1,6}\s+/gm, "").replace(/\*\*|__/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
    const counts = ["pending", "accepted", "deferred", "rejected"].map(status => ({status, count: recommendations.filter(r=>r.status===status).length})).filter(x=>x.count);
    return <article className="panel council-session">
      <header className="record-heading"><div><p className="session-eyebrow">Council session</p><h3><time dateTime={session.publishedAt}>{new Date(session.publishedAt).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})}</time></h3></div><span className="badge">{session.status}</span></header>
      {!expanded && <p className="council-session-preview">{preview || "No report text was saved for this session."}</p>}
      <div id={contentId} className="council-report-accordion" data-expanded={expanded} inert={!expanded} aria-hidden={!expanded}><div className="council-report-accordion-inner">
      {recommendations.length > 0 && <figure className="decision-chart"><figcaption>Recommendations now · {recommendations.length.toLocaleString()} total</figcaption><div className="decision-bar" aria-hidden="true">{counts.map(x=><span className={`decision-segment ${x.status}`} style={{flex:x.count}} key={x.status}/>)}</div><ul className="decision-legend">{counts.map(x=><li key={x.status}>{x.count.toLocaleString()} {x.status}</li>)}</ul></figure>}
      {recommendations.length > 0 && <section className="session-actions"><h4>Actions from this session</h4><ol>{recommendations.map(r=><li key={r.id}><a href={`/${state.profile.toLowerCase()}/council#recommendation-${r.id}`}>{r.proposal.title}</a><span>{session.council?.identities.find(x=>x.id===r.role)?.name ?? r.role} · {r.proposal.owner} · {r.status}{"dueOn" in r.proposal && r.proposal.dueOn ? ` · Due ${r.proposal.dueOn}` : ""}</span></li>)}</ol></section>}
      {session.options?.length ? <section className="session-alternatives"><h4>Alternatives considered</h4>{session.options.map((option,i)=><div key={i}><h5>{option.title} · {option.status}</h5><p>{option.rationale}</p><p>{option.evidence}</p></div>)}</section> : null}
      <section className="session-report"><h4>Session report</h4><ReportBody text={displaySummary}/></section>
      <details className="session-source"><summary>Evidence and report text</summary><p>Evidence revision {session.basedOnRevision.toLocaleString()} · Receipt …{session.id.slice(-8)}</p><pre>{councilReadingText(session.summary)}</pre></details>
      </div></div>
      <button type="button" className="council-report-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>{expanded ? "Hide all" : "View all"}<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={expanded ? "M8 13V3M3 8l5-5 5 5" : "M8 3v10M3 8l5 5 5-5"}/></svg></button>
    </article>;
}
