import React, { useEffect, useState, type ReactNode } from "react";
import type { State, Recommendation, TaskFields } from "./types";
import { recommendationResultKind } from "./types";
import "./council-decisions.css";

const pretty = (value: string) => value.replaceAll(".", " ").replaceAll("-", " ");
const roleName = (state: State, role: string) => state.council?.identities.find(identity=>identity.id === role)?.name ?? role;
const formatDate = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
type QueueTab = "pending" | "deferred" | "history";

export function CouncilDecisions({ state, busy, act, edit, renderRecommendationPrompt }: {
  state: State;
  busy: boolean;
  act: (action: string, payload: unknown) => Promise<boolean | undefined>;
  edit: (recommendation: Recommendation) => void;
  renderRecommendationPrompt?: (recommendation: Recommendation) => ReactNode;
}) {
  const [tab, setTab] = useState<QueueTab>("pending");
  const [targetId, setTargetId] = useState("");
  useEffect(()=> {
    function followHash() {
      const group = location.hash === "#recommendations" ? "pending" : location.hash === "#deferred-decisions" ? "deferred" : location.hash === "#decision-history" ? "history" : null;
      if (group) { setTab(group); setTargetId(""); return; }
      const id = location.hash.replace(/^#recommendation-/, "");
      const record = state.recommendations.find(r=>r.id === id);
      if (record) {
        setTab(record.status === "pending" ? "pending" : record.status === "deferred" ? "deferred" : "history");
        setTargetId(record.id);
      }
    }
    followHash();
    window.addEventListener("hashchange",followHash);
    return ()=>window.removeEventListener("hashchange",followHash);
  }, [state.profile, state.recommendations]);
  useEffect(()=> {
    if (targetId) document.getElementById(`recommendation-${targetId}`)?.scrollIntoView({block:"center"});
  }, [tab, targetId]);
  const groups = {
    pending: state.recommendations.filter(r=>r.status === "pending"),
    deferred: state.recommendations.filter(r=>r.status === "deferred"),
    history: state.recommendations.filter(r=>["accepted","rejected"].includes(r.status)).slice().reverse(),
  };
  return <section className="council-decisions" id="recommendations" aria-labelledby="decision-queue-heading">
    <div className="decision-queue-heading"><div><span className="decision-queue-eyebrow">{state.profile} · Across all sessions</span><h2 id="decision-queue-heading">Needs your decision</h2></div><span className="decision-queue-count">{groups.pending.length}</span></div>
    <p className="decision-queue-description">Unresolved proposals stay here as the council meets. Changing the session keeps this queue intact.</p>
    <div className="decision-queue-tabs" role="group" aria-label="Decision queue status">{([["pending","Pending"],["deferred","Deferred"],["history","Decision history"]] as const).map(([id,label])=><button type="button" key={id} id={id === "deferred" ? "deferred-decisions" : id === "history" ? "decision-history" : undefined} aria-pressed={tab === id} onClick={()=>{setTab(id);setTargetId("");history.replaceState(null,"",`${location.pathname}${location.search}#${id === "pending" ? "recommendations" : id === "deferred" ? "deferred-decisions" : "decision-history"}`);}}>{label}<span>{groups[id].length}</span></button>)}</div>
    <p className="quiet">Accepting saves a planning record. It does not start execution.</p>
    {!groups[tab].length && <p className="decision-queue-empty">{tab === "pending" ? "No pending decisions. Deferred proposals and past decisions remain in their own tabs." : tab === "deferred" ? "No deferred proposals." : "No decisions recorded yet."}</p>}
    {groups[tab].map(r=> {
      const origin = state.councilSessions?.find(session=>session.recommendationIds.includes(r.id));
      const target = r.kind.startsWith("idea") ? state.ideas?.find(i=>i.id===r.targetId) : r.kind.startsWith("goal") ? state.goals.find(g=>g.id===r.targetId) : state.tasks.find(t=>t.id===r.targetId);
      const changes = r.kind.endsWith("-review") && target ? Object.entries(r.proposal).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify((target as unknown as Record<string,unknown>)[key])) : [];
      const competing = Boolean(r.targetId && ["pending","deferred"].includes(r.status) && state.recommendations.some(other=>other.id !== r.id && other.targetId === r.targetId && ["pending","deferred"].includes(other.status)));
      return (<article
                  className="panel recommendation decision-queue-card"
                  key={r.id}
                  id={`recommendation-${r.id}`}
                >
                  <div className="record-heading">
                    <div>
                      <p>
                        {origin?.council?.identities.find(identity => identity.id === r.role)?.name ?? roleName(state, r.role)} · {pretty(r.kind)}
                      </p>
                      <h3>{r.proposal.title}</h3>
                    </div>
                    <span className="badge">{r.status}</span>
                  </div>
                  <p className="decision-origin">{origin ? <a href={`#session-${origin.id}`}>Council session · {formatDate(origin.publishedAt)}</a> : <span>Imported outside a session · {formatDate(r.createdAt)}</span>}</p>
                  <p className="prose">{r.rationale}</p>
                  <details className="decision-support"><summary>Evidence and proposed record</summary>
                  {changes.length>0&&<div style={{overflowX:"auto"}}><table><caption>Proposed changes</caption><thead><tr><th>Property</th><th>Current</th><th>Proposed</th></tr></thead><tbody>{changes.map(([key,value])=><tr key={key}><th>{key}</th><td>{JSON.stringify((target as unknown as Record<string,unknown>)[key])??"Not set"}</td><td>{JSON.stringify(value)}</td></tr>)}</tbody></table></div>}
                  {r.kind === "idea-graduate" && target && <p>Graduate idea: <a href={`/${state.profile.toLowerCase()}/forge/ideas#idea-${target.id}`}>{target.title}</a></p>}
                  <div className="goal-columns">
                    <div>
                      <h4>Tradeoffs</h4>
                      <p>{r.tradeoffs || "No tradeoffs supplied."}</p>
                    </div>
                    <div>
                      <h4>Evidence and confidence</h4>
                      <p>{r.evidence || "No evidence supplied."}</p>
                      <p>Confidence: {r.confidence}</p>
                    </div>
                  </div>
                  {!["accepted", "rejected"].includes(r.status) && renderRecommendationPrompt?.(r)}
                  <details>
                    <summary>Proposed record</summary>
                    <dl>
                      <dt>Owner</dt>
                      <dd>{r.proposal.owner}</dd>
                      <dt>Priority</dt>
                      <dd>{"priority" in r.proposal ? pretty(r.proposal.priority) : "Not applicable"}</dd>
                      {"description" in r.proposal ? <><dt>Description</dt><dd>{r.proposal.description}</dd><dt>Readiness</dt><dd>{r.proposal.status}</dd><dt>Value / complexity / confidence</dt><dd>{r.proposal.value} / {r.proposal.complexity} / {r.proposal.confidence}</dd><dt>Start when</dt><dd>{r.proposal.startCondition || "Not set"}</dd><dt>Smallest useful test</dt><dd>{r.proposal.experiment || "Not set"}</dd><dt>Projects / tags</dt><dd>{[...r.proposal.projects,...r.proposal.tags].join(", ") || "None"}</dd></> : "notes" in r.proposal ? (
                        <>
                          <dt>Due</dt>
                          <dd>{r.proposal.dueOn || "Not set"}</dd>
                          <dt>Goal</dt>
                          <dd>
                            {state.goals.find(
                              (g) => g.id === (r.proposal as TaskFields).goalId,
                            )?.title || "No linked goal"}
                          </dd>
                          <dt>Action and completion evidence</dt>
                          <dd className="prose">
                            {r.proposal.notes || "Not supplied"}
                          </dd>
                        </>
                      ) : (
                        <>
                          <dt>Intent</dt>
                          <dd className="prose">{r.proposal.intent}</dd>
                          <dt>Success criteria</dt>
                          <dd className="prose">
                            {r.proposal.successCriteria}
                          </dd>
                          <dt>Review date</dt>
                          <dd>{r.proposal.reviewOn || "Not set"}</dd>
                        </>
                      )}
                    </dl>
                  </details>
                  </details>
                  {competing && <p className="decision-conflict">Another unresolved proposal targets this same record. Compare them before accepting a change.</p>}
                  {!["accepted", "rejected"].includes(r.status) && <div className="actions">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        act("recommendation.resolve", {
                          id: r.id,
                          decision: "accepted",
                        })
                      }
                    >
                      Accept
                    </button>
                    <button disabled={busy} onClick={() => edit(r)}>
                      Edit and accept
                    </button>
                    <button
                      disabled={busy || r.status === "deferred"}
                      onClick={() =>
                        act("recommendation.resolve", {
                          id: r.id,
                          decision: "deferred",
                        })
                      }
                    >
                      Defer
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        act("recommendation.resolve", {
                          id: r.id,
                          decision: "rejected",
                        })
                      }
                    >
                      Reject
                    </button>
                  </div>}
                  {r.resultId && (()=>{const kind=recommendationResultKind(r.kind);return <a className="decision-result" href={`/${state.profile.toLowerCase()}/forge/${kind}s#${kind}-${r.resultId}`}>Open resulting {kind}</a>;})()}
                  {r.ownerNote && <p className="quiet">{r.ownerNote}</p>}
                </article>);
    })}
  </section>;
}
