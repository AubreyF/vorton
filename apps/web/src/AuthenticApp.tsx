import { useEffect, useMemo, useState } from "react";
import { ThemeControls } from "./design-system/theme-controls.js";
import { AgentPromptButton } from "./design-system/agent-prompt-button.js";
import { BackgroundAtmosphere } from "./design-system/background-atmosphere.js";
import { ExportControls } from "./design-system/export-controls.js";
import { useBrowserRuntime } from "./runtime.js";

const primarySections = [
  ["command", "Command Bridge"],
  ["opportunities", "Opportunities"],
  ["goals", "Goals"],
  ["tasks", "Tasks"],
  ["finance", "Finance"],
  ["tools", "Tools"],
  ["conversations", "Conversations"],
  ["factory", "Factory"],
  ["admin", "Admin"],
] as const;

type SectionId = (typeof primarySections)[number][0];

const secondarySections: Record<SectionId, readonly string[]> = {
  command: ["Briefing", "Evidence", "Decisions", "Activity"],
  opportunities: ["Workbench", "Selected", "Signals", "Pipeline"],
  goals: ["Active", "Guardrails", "Execution", "Calendar"],
  tasks: ["Priority", "Blocked", "All open", "History"],
  finance: ["Cash flow", "Runway", "Debt", "Capital", "Tax", "Risk"],
  tools: ["Catalog", "Build", "Runs"],
  conversations: ["Inbox", "Meet", "Omi", "Sources"],
  factory: ["Tickets", "Workers", "Pull requests", "Receipts"],
  admin: ["People", "Workers", "Policy", "Records", "Sources"],
};

function initialSection(): SectionId {
  const value = window.location.hash.slice(1).split("/")[0];
  return primarySections.some(([id]) => id === value)
    ? (value as SectionId)
    : "command";
}

export function AuthenticApp() {
  const runtime = useBrowserRuntime();
  const [section, setSection] = useState<SectionId>(initialSection);
  const installationName =
    runtime.bootstrap.installations[0]?.displayName ?? "Private installation";

  useEffect(() => {
    const onHashChange = () => setSection(initialSection());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    document.title = installationName;
  }, [installationName]);

  function navigate(next: SectionId) {
    window.location.hash = next;
    setSection(next);
  }

  return (
    <div className="dashboard-shell">
      <BackgroundAtmosphere />
      <a className="skip-link" href="#dashboard-content">
        Skip to dashboard content
      </a>
      <header className="topbar">
        <div className="brand-block">
          <button
            className="brand-mark"
            type="button"
            onClick={() => navigate("command")}
            aria-label={`${installationName} Command Bridge`}
          >
            {installationName}
          </button>
        </div>
        <PrimaryNavigation
          installationName={installationName}
          section={section}
          navigate={navigate}
        />
        <div className="topbar-actions">
          <button
            className="identity-control"
            type="button"
            onClick={() => void runtime.signOut()}
            title="Sign out"
          >
            <span aria-hidden="true">
              {(runtime.session.user.email?.[0] ?? "?").toUpperCase()}
            </span>
            <span className="identity-control__label">
              {runtime.session.user.email ?? installationName}
            </span>
          </button>
          <ExportControls />
          <ThemeControls />
        </div>
      </header>
      <SecondaryNavigation section={section} />
      <PrivacyState
        installation={runtime.bootstrap.installations[0]?.displayName}
      />
      <main id="dashboard-content" className="view-frame" tabIndex={-1}>
        {section === "command" ? (
          <CommandBridge installationName={installationName} />
        ) : (
          <ModuleFoundation section={section} />
        )}
      </main>
    </div>
  );
}

function PrimaryNavigation({
  installationName,
  section,
  navigate,
}: {
  installationName: string;
  section: SectionId;
  navigate: (section: SectionId) => void;
}) {
  return (
    <nav
      className="primary-navigation"
      aria-label={`${installationName} sections`}
    >
      <div className="primary-navigation__track">
        {primarySections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`nav-button ${section === id ? "active" : ""}`}
            aria-current={section === id ? "page" : undefined}
            onClick={() => navigate(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function SecondaryNavigation({ section }: { section: SectionId }) {
  return (
    <div className="section-nav-bar">
      <nav className="secondary-navigation" aria-label={`${section} sections`}>
        {secondarySections[section].map((label, index) => (
          <button
            key={label}
            type="button"
            className={`nav-button secondary-nav-link ${index === 0 ? "active" : ""}`}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function PrivacyState({ installation }: { installation?: string }) {
  return (
    <div
      className="privacy-state"
      aria-label="Private organizational installation"
    >
      <span className="privacy-shield" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 3 19 6v5c0 5-3.1 8.3-7 10-3.9-1.7-7-5-7-10V6l7-3Z" />
        </svg>
      </span>
      {installation ?? "Private installation"}
    </div>
  );
}

function CommandBridge({ installationName }: { installationName: string }) {
  const runtime = useBrowserRuntime();
  const installation = runtime.bootstrap.installations[0];
  const binding = installation?.proposalBindings[0];
  const evidence = binding?.evidence ?? [];
  const [objective, setObjective] = useState("");
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const currentDate = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    [],
  );

  async function requestRecommendation() {
    if (!installation || !binding || !objective.trim()) return;
    setBusy(true);
    setStatus(undefined);
    try {
      const payload = (await runtime.submitExecutive("proposals", {
        installationId: installation.id,
        workId: binding.workId,
        workerId: binding.workerId,
        roleId: binding.roleId,
        objective: objective.trim(),
        evidenceRecordIds: evidence.map((item) => item.id),
        background: false,
      })) as { proposal?: { id?: string } };
      setStatus(
        payload.proposal?.id
          ? `Recommendation recorded as ${payload.proposal.id}. No action was authorized.`
          : "The recommendation is still running. No action was authorized.",
      );
    } catch {
      setStatus(
        "The executive worker could not complete this recommendation. Your request was not converted into authority or Work.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="command-intro">
        <div>
          <p className="eyebrow">{currentDate}</p>
          <h1>Today</h1>
          <p className="lede">
            One place to understand what matters, ask for judgment, and decide
            what deserves authority next.
          </p>
        </div>
        <aside className="daily-focus-card">
          <p className="eyebrow">Daily focus</p>
          <strong>{binding ? "Current" : "Needs configuration"}</strong>
          <p>
            {binding
              ? "One governed executive lane is ready. Zero external actions are authorized."
              : "No governed executive lane is available for this installation."}
          </p>
        </aside>
      </section>

      <section
        className="executive-briefing"
        aria-labelledby="executive-briefing-heading"
      >
        <header className="section-heading">
          <div>
            <p className="eyebrow">Executive brief</p>
            <h2 id="executive-briefing-heading">Decisions that matter now</h2>
          </div>
          <span className="authority-boundary">
            0 external actions authorized
          </span>
        </header>

        {binding ? (
          <div className="briefing-grid">
            <article className="briefing-card tone-priority">
              <p className="eyebrow">Current work</p>
              <h3>{binding.workTitle}</h3>
              <p>
                This is the active governed lane. A recommendation remains
                advisory until a separate human review, decision, and approval.
              </p>
              <AgentPromptButton
                compact
                spec={{
                  installationName,
                  kind: "work item",
                  id: binding.workId,
                  title: binding.workTitle,
                  state: "active",
                  objective: binding.workTitle,
                  closureEvidence:
                    "A reviewed outcome receipt cites the approved intent and accepted evidence.",
                  currentEvidence: evidence
                    .map((item) => item.summary)
                    .join(" "),
                  authorityBoundary:
                    "The worker may recommend. A human review and approval are required before consequential action.",
                  relatedRecords: evidence.map((item) => item.id),
                }}
              />
            </article>
            <article className="briefing-card tone-constraint">
              <p className="eyebrow">Evidence boundary</p>
              <h3>
                {evidence.length} authoritative source
                {evidence.length === 1 ? "" : "s"}
              </h3>
              <p>
                The worker may reason from these records. It may not invent an
                approval, policy, capability, or task.
              </p>
            </article>
            <article className="briefing-card tone-option">
              <p className="eyebrow">Assigned judgment</p>
              <h3>{binding.roleName}</h3>
              <p>
                {binding.workerName} can recommend. You retain every
                consequential decision.
              </p>
            </article>
          </div>
        ) : (
          <div className="directional-empty-state">
            <h3>No executive lane is available</h3>
            <p>Connect a worker, role, Work item, and recommendation grant.</p>
          </div>
        )}

        <details className="evidence-disclosure">
          <summary>Full evidence and authority</summary>
          <div className="evidence-list">
            {evidence.map((item) => (
              <article key={item.id}>
                <span>{item.classification}</span>
                <p>{item.summary}</p>
              </article>
            ))}
          </div>
        </details>
      </section>

      <section className="daily-command-grid" aria-label="Daily command lanes">
        <CommandLane
          eyebrow="Advance"
          title="Opportunities"
          empty="No opportunity has been promoted into today’s governed view."
        />
        <CommandLane
          eyebrow="Protect"
          title="Goals"
          empty="No goal has been promoted into today’s governed view."
        />
        <CommandLane
          eyebrow="Do"
          title="Tasks"
          empty="No task has been promoted into today’s governed view."
        />
      </section>

      <section
        className="recommendation-composer"
        aria-labelledby="recommendation-heading"
      >
        <div>
          <p className="eyebrow">Command Bridge</p>
          <h2 id="recommendation-heading">Ask for a governed recommendation</h2>
          <p>
            The worker can analyze and propose. It cannot approve its own
            recommendation or execute a consequential action.
          </p>
        </div>
        <label>
          What judgment do you need?
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Review the current evidence and recommend the single highest priority next decision."
            rows={5}
          />
        </label>
        <button
          className="primary-button"
          type="button"
          disabled={!binding || !objective.trim() || busy}
          onClick={() => void requestRecommendation()}
        >
          {busy ? "Requesting judgment" : "Request recommendation"}
        </button>
        {status && (
          <p className="composer-status" role="status">
            {status}
          </p>
        )}
      </section>
    </>
  );
}

function CommandLane({
  eyebrow,
  title,
  empty,
}: {
  eyebrow: string;
  title: string;
  empty: string;
}) {
  return (
    <article className="command-lane">
      <header>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <button type="button" className="text-button">
          Open
        </button>
      </header>
      <div className="command-lane__empty">
        <span aria-hidden="true">+</span>
        <p>{empty}</p>
      </div>
    </article>
  );
}

function ModuleFoundation({
  section,
}: {
  section: Exclude<SectionId, "command">;
}) {
  const label = primarySections.find(([id]) => id === section)?.[1] ?? section;
  return (
    <section className="module-foundation">
      <p className="eyebrow">Vorton / {label}</p>
      <h1>{label}</h1>
      <p className="lede">
        This module is being translated from the canonical AubOS interface onto
        the reusable Vorton kernel. The previous generic preview has been
        removed rather than presented as finished product.
      </p>
      <div className="directional-empty-state">
        <h2>The interface migration is in progress</h2>
        <p>
          The module will inherit the canonical themes, controls, navigation,
          evidence disclosures, authority language, responsive behavior, and
          real installation data.
        </p>
      </div>
    </section>
  );
}
