import {
  moonbaseIncidents,
  triageMoonbaseIncidents,
  type TriagedIncident,
} from "@vorton/example-moonbase-triage";
import { Radar } from "lucide-react";
import { type MouseEvent, useState } from "react";

import { toolFromRoute, toolRegistry } from "./tool-registry.js";

export function ToolsView({
  installationName,
  view,
  navigate,
}: {
  installationName: string;
  view: string;
  navigate: (view: string) => void;
}) {
  const selected = toolFromRoute(view);

  return (
    <section
      className="tools-view"
      aria-labelledby={selected ? undefined : "tools-heading"}
      aria-label={selected?.label}
    >
      {!selected && (
        <>
          <header className="tools-page-heading">
            <h1 id="tools-heading">Tools</h1>
          </header>
          <div className="tools-grid" aria-label="Available tools">
            {toolRegistry.map((tool) => (
              <button
                type="button"
                key={tool.id}
                className="tool-tile"
                aria-label={`Open ${tool.label}`}
                aria-controls={`${tool.id}-panel`}
                onClick={() => navigate(tool.id)}
              >
                <span className="tool-tile-icon" aria-hidden="true">
                  <Radar size={68} strokeWidth={1.35} />
                </span>
                <span className="tool-tile-status">{tool.status}</span>
                <strong>{tool.label}</strong>
                <span className="tool-tile-description">
                  {tool.description}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {selected?.id === "moonbase-triage" && (
        <div className="tool-detail-full-bleed" id="moonbase-triage-panel">
          <MoonbaseTriageTool
            installationName={installationName}
            navigate={navigate}
          />
        </div>
      )}
    </section>
  );
}

function MoonbaseTriageTool({
  installationName,
  navigate,
}: {
  installationName: string;
  navigate: (view: string) => void;
}) {
  const [result, setResult] = useState<readonly TriagedIncident[]>();

  function followTools(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate("Catalog");
  }

  return (
    <article className="moonbase-tool">
      <header className="tool-detail-heading">
        <div>
          <nav className="tool-breadcrumbs" aria-label="Breadcrumb">
            <a href="#tools/Catalog" onClick={followTools}>
              Tools
            </a>
            <span className="tool-breadcrumb-caret" aria-hidden="true">
              ›
            </span>
            <span aria-current="page">Moonbase Triage</span>
          </nav>
          <h1>Moonbase Triage</h1>
        </div>
        <p>
          A complete, bounded tool preview for sorting synthetic lunar incidents
          into action lanes. It is deliberately useful without touching any
          installation data or external service.
        </p>
      </header>

      <section className="tool-brief" aria-labelledby="tool-brief-heading">
        <div>
          <p className="eyebrow">Tool contract</p>
          <h2 id="tool-brief-heading">Deterministic by design</h2>
          <p>
            Every incident receives the same score from the same input. Running
            this preview creates no authority, installation record, or durable
            organizational memory.
          </p>
        </div>
        <dl className="tool-brief-stats">
          <div>
            <dt>Network</dt>
            <dd>Offline</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>Synthetic</dd>
          </div>
          <div>
            <dt>Authority</dt>
            <dd>Preview only</dd>
          </div>
        </dl>
      </section>

      <section
        className="tool-boundary"
        aria-labelledby="tool-boundary-heading"
      >
        <h2 id="tool-boundary-heading" className="eyebrow">
          Preview boundary
        </h2>
        <div>
          <strong>Installation data</strong>
          <span>Reads no {installationName} data.</span>
        </div>
        <div>
          <strong>Execution authority</strong>
          <span>Grants no worker capability or durable record.</span>
        </div>
      </section>

      <section
        className="tool-run-workspace"
        aria-labelledby="tool-run-heading"
      >
        <header>
          <div>
            <p className="eyebrow">Synthetic incident batch</p>
            <h2 id="tool-run-heading">Four signals awaiting triage</h2>
          </div>
          <p>
            Score = urgency × 2 + impact. Higher scores receive the more urgent
            lane.
          </p>
        </header>
        <button
          type="button"
          className="primary-button tool-run-button"
          onClick={() => setResult(triageMoonbaseIncidents(moonbaseIncidents))}
        >
          Run synthetic preview
        </button>

        {result ? (
          <div className="triage-result" role="status">
            <header>
              <p className="eyebrow">Deterministic result</p>
              <span>{result.length} incidents</span>
            </header>
            <ol>
              {result.map((incident) => (
                <li key={incident.id}>
                  <span>{incident.id}</span>
                  <strong>{incident.summary}</strong>
                  <small>{incident.system}</small>
                  <b>{incident.lane}</b>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="tool-result-empty">
            <strong>No result yet</strong>
            <span>Run the preview to generate the ordered incident lanes.</span>
          </div>
        )}
      </section>
    </article>
  );
}
