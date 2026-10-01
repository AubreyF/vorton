import React, { lazy, Suspense, useEffect, type ReactNode } from "react";
import type { State } from "./types";
import { LoadingIndicator } from "./loading-indicator";
import "./admin-page.css";

const OmiAdmin = lazy(() => import("./omi-admin").then(module => ({ default: module.OmiAdmin })));
export type AdminDestination = { id: string; title: string; description: string; href: string };
export const adminSections = ["settings", "integrations", "integrations/omi", "exports", "activity", "decisions"];

function AdminIcon({ kind }: { kind: string }) {
  const shapes: Record<string, ReactNode> = {
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
    integrations: <><path d="M9 3v5m6-5v5M7 8h10v4a5 5 0 0 1-10 0V8Zm5 9v4"/></>,
    exports: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></>,
    activity: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  };
  return <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[kind] ?? <><path d="M6 3h12v18H6zM9 8h6m-6 4h6m-6 4h4"/></>}</svg>;
}

/** The shared Admin directory owns layout. Native adapters supply links only. */
export function AdminPage({ state, section = "", token, preferences, activity, decisions, destinations = [] }: {
  state: State; section?: string; token: string; preferences?: ReactNode;
  activity: ReactNode; decisions?: ReactNode; destinations?: AdminDestination[];
}) {
  const base = `/${state.profile.toLowerCase()}/admin`;
  useEffect(() => {
    // Preserve previously shared links without keeping their long mixed page.
    const legacy = location.hash.slice(1);
    if (!section && (legacy === "activity" || (legacy === "decisions" && decisions))) location.replace(`${base}/${legacy}`);
  }, [base, section, Boolean(decisions)]);
  const entries: AdminDestination[] = [
    { id: "settings", title: "Workspace settings", description: "Purpose, defaults and the records behind this organization.", href: `${base}/settings` },
    { id: "integrations", title: "Integrations", description: "Connect Omi and manage access to this workspace's services.", href: `${base}/integrations` },
    { id: "exports", title: "Data & exports", description: "Download your workspace records and understand what each export contains.", href: `${base}/exports` },
    { id: "activity", title: "Activity", description: "See what changed, when it changed and how it was recorded.", href: `${base}/activity` },
    ...(decisions ? [{ id: "decisions", title: "Decision history", description: "Revisit the decisions saved for this organization.", href: `${base}/decisions` }] : []),
  ];
  const selected = entries.find(entry => entry.id === section.split("/")[0]);
  const omi = section === "integrations/omi";
  const title = omi ? "Omi" : selected?.title ?? "Admin";
  const tiles = (items: AdminDestination[]) => <div className="admin-grid">{items.map(entry => <a className="admin-card" href={entry.href} key={entry.id}>
    <span className="admin-icon"><AdminIcon kind={entry.id}/></span>
    <h3>{entry.title}</h3><p>{entry.description}</p><span className="admin-open">Open {entry.title.toLowerCase()} <span aria-hidden="true">↗</span></span>
  </a>)}</div>;
  if (section && (!adminSections.includes(section) || !selected)) return <div className="workspace-admin"><h1>Admin page not found</h1><a href={base}>Back to Admin</a></div>;
  return <div className="workspace-admin">
    {section && <nav className="admin-breadcrumb" aria-label="Breadcrumb"><a href={base}>Admin</a><span aria-hidden="true">/</span>{omi && <><a href={`${base}/integrations`}>Integrations</a><span aria-hidden="true">/</span></>}<span aria-current="page">{title}</span></nav>}
    <header className="admin-heading"><p className="admin-eyebrow">{state.profile === "LastResort" ? "The Last Resort" : state.profile}</p><h1>{title}</h1><p>{section ? (omi ? "Connection, conversation history and daily Council intelligence." : selected?.description) : "Manage your workspace, connected services and records."}</p></header>
    {!section ? <>
      <section aria-labelledby="admin-workspace-heading"><h2 id="admin-workspace-heading">Workspace</h2>{tiles(entries)}</section>
      {destinations.length > 0 && <section aria-labelledby="admin-evidence-heading"><h2 id="admin-evidence-heading">Review & evidence</h2><p>Inspect the sources and review practices specific to this organization.</p>{tiles(destinations)}</section>}
    </> : <div className="admin-content">
      {section === "settings" && <>{preferences ?? <section className="panel"><h2>Workspace settings</h2><p>This organization's settings are maintained in its authoritative workspace records.</p></section>}<section className="panel"><h2>Workspace record</h2><dl className="facts"><dt>Organization</dt><dd>{state.profile}</dd><dt>Record revision</dt><dd>{state.revision}</dd><dt>Record source</dt><dd>{state.canonical ? "The original governed registers. Evidence and history are preserved." : "This organization's own saved records."}</dd></dl><p className="quiet">Appearance, fonts and zoom are shared across organizations through the workspace menu.</p></section></>}
      {section === "integrations" && tiles([{ id: "integrations", title: "Omi", description: "Connect conversation history to your daily Council. Manage your Developer key and retained transcripts.", href: `${base}/integrations/omi` }])}
      {omi && <Suspense fallback={<LoadingIndicator label="Loading Omi settings"/>}><OmiAdmin key={state.profile} profile={state.profile} token={token}/></Suspense>}
      {section === "exports" && <section className="panel"><h2>Export workspace records</h2><p>{state.settings ? "Includes planning records, opportunities, ledger, saved forecast, settings and history." : "Includes goals, tasks, recommendations and history."}</p><p>Omi credentials and retained transcripts are not included in this planning export.</p><a className="admin-download" href={`/api/${state.profile.toLowerCase()}/export`} download>Download workspace records</a><p className="quiet">Exports contain private information. Store them securely outside source control.</p></section>}
      {section === "activity" && <section className="panel"><h2>Recent activity</h2><p className="quiet">Latest 50 changes. Full history is included in your workspace export.</p>{activity}</section>}
      {section === "decisions" && decisions}
    </div>}
  </div>;
}
