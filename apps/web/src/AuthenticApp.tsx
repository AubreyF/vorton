import { useEffect, useMemo, useState } from "react";
import { factoryModuleManifest } from "@vorton/factory";
import { AgentPromptButton } from "./design-system/agent-prompt-button.js";
import { AccountMenu } from "./design-system/account-menu.js";
import { BackgroundAtmosphere } from "./design-system/background-atmosphere.js";
import { HorizontalNavigation } from "./design-system/horizontal-navigation.js";
import {
  resolveSelectedWorkspace,
  WorkspaceSwitcher,
} from "./design-system/workspace-switcher.js";
import {
  SectionNavigator,
  type SectionNavigationItem,
} from "./design-system/section-navigator.js";
import { ExecutiveCouncil } from "./executive-council.js";
import { useBrowserRuntime, type RuntimeBootstrap } from "./runtime.js";
import { ToolsView } from "./tools/tools-view.js";

const primarySections = [
  ["command", "Command Bridge"],
  ["opportunities", "Opportunities"],
  ["goals", "Goals"],
  ["tasks", "Tasks"],
  ["tools", "Tools"],
  ["factory", "Factory"],
  ["admin", "Admin"],
] as const;

type SectionId = (typeof primarySections)[number][0];
type Installation = RuntimeBootstrap["installations"][number];
type Workspace = Installation["workspaces"][number];
type WorkItem = Workspace["workItems"][number];

export const WORKSPACE_SELECTION_STORAGE_PREFIX = "vorton.selected-workspace";

export function workspaceSelectionStorageKey(installationId: string) {
  return `${WORKSPACE_SELECTION_STORAGE_PREFIX}:${installationId}`;
}

const secondarySections: Record<SectionId, readonly string[]> = {
  command: ["Briefing", "Council", "Decisions", "Activity"],
  opportunities: ["Workbench", "Selected", "Signals", "Pipeline"],
  goals: ["Active", "Guardrails", "Execution", "Calendar"],
  tasks: ["Priority", "Blocked", "All open", "History"],
  tools: ["Catalog", "moonbase-triage"],
  factory: ["Tickets", "Workers", "Pull requests", "Receipts"],
  admin: ["People", "Workers", "Policy", "Records", "Conversations", "Sources"],
};

const legacySectionRoutes: Record<
  string,
  { section: SectionId; subsection: string }
> = {
  conversations: { section: "admin", subsection: "Conversations" },
};

export const commandBridgeSections = [
  {
    id: "command-briefing",
    label: "Briefing",
    route: "Briefing",
    detail: "What matters now",
  },
  {
    id: "command-council",
    label: "Council",
    route: "Council",
    detail: "Executive recommendations",
  },
  {
    id: "command-decisions",
    label: "Decisions",
    route: "Decisions",
    detail: "Owner judgment",
  },
  {
    id: "command-activity",
    label: "Activity",
    route: "Activity",
    detail: "Governed change",
  },
] as const satisfies readonly SectionNavigationItem[];

export function sectionFromHash(hash: string): SectionId {
  const value = hash.slice(1).split("/")[0] ?? "";
  const legacyRoute = legacySectionRoutes[value];
  if (legacyRoute) return legacyRoute.section;
  return primarySections.some(([id]) => id === value)
    ? (value as SectionId)
    : "command";
}

export function subsectionFromHash(section: SectionId, hash: string): string {
  const [requestedSection = "", encodedSubsection] = hash.slice(1).split("/");
  const legacyRoute = legacySectionRoutes[requestedSection];
  if (legacyRoute?.section === section) return legacyRoute.subsection;
  const requested = decodeURIComponent(encodedSubsection ?? "");
  return secondarySections[section].includes(requested)
    ? requested
    : secondarySections[section][0]!;
}

function initialSection(): SectionId {
  return sectionFromHash(window.location.hash);
}

function initialSubsection(section: SectionId): string {
  return subsectionFromHash(section, window.location.hash);
}

export function AuthenticApp() {
  const runtime = useBrowserRuntime();
  const installation = runtime.bootstrap.installations[0]!;
  const workspaceStorageKey = workspaceSelectionStorageKey(installation.id);
  const [section, setSection] = useState<SectionId>(initialSection);
  const [subsection, setSubsection] = useState(() =>
    initialSubsection(initialSection()),
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    () => localStorage.getItem(workspaceStorageKey),
  );
  const workspace = resolveSelectedWorkspace(
    installation.workspaces,
    selectedWorkspaceId,
  )!;
  const workspaceName = workspace.displayName;

  useEffect(() => {
    const onHashChange = () => {
      const nextSection = initialSection();
      setSection(nextSection);
      setSubsection(initialSubsection(nextSection));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    document.title = workspaceName;
  }, [workspaceName]);

  useEffect(() => {
    if (selectedWorkspaceId === workspace.id) return;
    setSelectedWorkspaceId(workspace.id);
    localStorage.setItem(workspaceStorageKey, workspace.id);
  }, [selectedWorkspaceId, workspace.id, workspaceStorageKey]);

  function navigate(next: SectionId) {
    const nextSubsection = secondarySections[next][0]!;
    window.location.hash = `${next}/${encodeURIComponent(nextSubsection)}`;
    setSection(next);
    setSubsection(nextSubsection);
  }

  function navigateSubsection(next: string) {
    window.location.hash = `${section}/${encodeURIComponent(next)}`;
    setSubsection(next);
  }

  function selectWorkspace(workspaceId: string) {
    const next = resolveSelectedWorkspace(installation.workspaces, workspaceId);
    if (!next || next.id !== workspaceId) return;
    localStorage.setItem(workspaceStorageKey, workspaceId);
    setSelectedWorkspaceId(workspaceId);
  }

  return (
    <div
      className={`dashboard-shell ${section === "command" || section === "tools" ? "single-level-navigation" : ""}`}
    >
      <BackgroundAtmosphere />
      <a className="skip-link" href="#dashboard-content">
        Skip to dashboard content
      </a>
      <header className="topbar">
        <div className="brand-block">
          <WorkspaceSwitcher
            workspaces={installation.workspaces}
            selectedWorkspace={workspace}
            onSelect={selectWorkspace}
          />
        </div>
        <PrimaryNavigation
          workspaceName={workspaceName}
          section={section}
          navigate={navigate}
        />
        <div className="topbar-actions">
          <AccountMenu
            email={runtime.session.user.email}
            installationName={workspaceName}
            onSignOut={() => runtime.signOut()}
          />
        </div>
      </header>
      {section !== "command" && section !== "tools" && (
        <SecondaryNavigation
          section={section}
          subsection={subsection}
          navigate={navigateSubsection}
        />
      )}
      <PrivacyState workspace={workspaceName} />
      <main
        key={workspace.id}
        id="dashboard-content"
        className="view-frame"
        tabIndex={-1}
      >
        {section === "command" ? (
          <CommandBridgePage
            vortonInstallationId={installation.id}
            workspace={workspace}
            subsection={subsection}
            navigate={navigateSubsection}
          />
        ) : section === "tasks" ? (
          <WorkModule workspace={workspace} view={subsection} />
        ) : section === "tools" ? (
          <ToolsView
            installationName={workspaceName}
            view={subsection}
            navigate={navigateSubsection}
          />
        ) : section === "factory" ? (
          <FactoryModule installationName={workspaceName} view={subsection} />
        ) : (
          <ModuleFoundation
            installationName={workspaceName}
            section={section}
            view={subsection}
          />
        )}
      </main>
    </div>
  );
}

function FactoryModule({
  installationName,
  view,
}: {
  installationName: string;
  view: string;
}) {
  const manifest = factoryModuleManifest;
  return (
    <section className="factory-module">
      <header className="module-intro">
        <div>
          <p className="eyebrow">
            {installationName} / Factory / {view}
          </p>
          <h1>Factory</h1>
          <p className="lede">
            Governed software work across repositories and enrolled workers. The
            {manifest.connector} is installed in {installationName}. Live
            execution remains under Freed task authority and stays closed until
            its pilot gates pass.
          </p>
        </div>
        <dl className="work-summary" aria-label="Factory integration summary">
          <div>
            <dt>Runtime</dt>
            <dd>Integrated</dd>
          </div>
          <div>
            <dt>Projection</dt>
            <dd>Read only</dd>
          </div>
          <div>
            <dt>Writer</dt>
            <dd>Closed</dd>
          </div>
        </dl>
      </header>

      <div className="factory-authority-grid">
        {Object.entries(manifest.authority).map(([name, owner]) => (
          <article key={name}>
            <p className="eyebrow">{name}</p>
            <h2>
              {owner === "Vorton Postgres"
                ? `${installationName} Postgres`
                : owner}
            </h2>
          </article>
        ))}
      </div>

      <article className="factory-connector-card">
        <header>
          <div>
            <p className="eyebrow">Installed connector</p>
            <h2>{manifest.connector}</h2>
          </div>
          <span className="work-state">{manifest.mode}</span>
        </header>
        <p>
          This connector imports the proven admission, custody, routing,
          checkpoint, review, and draft publication machinery. It does not copy
          credentials, mutable host state, OAuth caches, worktrees, or a second
          authority ledger into {installationName}.
        </p>
        <ul className="factory-capabilities">
          {manifest.capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
        <footer>
          <span>Source {manifest.sourceRepository}</span>
          <code>{manifest.sourceCommit.slice(0, 12)}</code>
        </footer>
      </article>

      <div className="directional-empty-state">
        <h2>Live Factory projection is the next gate</h2>
        <p>
          Tickets, workers, pull requests, and receipts will appear after the
          live connector exposes a fresh read-only snapshot. {installationName}{" "}
          will not infer execution state from stale or synthetic evidence.
        </p>
      </div>
    </section>
  );
}

function PrimaryNavigation({
  workspaceName,
  section,
  navigate,
}: {
  workspaceName: string;
  section: SectionId;
  navigate: (section: SectionId) => void;
}) {
  return (
    <HorizontalNavigation
      activeKey={section}
      label={`${workspaceName} sections`}
      shellClassName="primary-nav-shell"
      navigationClassName="primary-navigation"
      trackClassName="primary-navigation__track"
    >
      {primarySections.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`nav-button ${section === id ? "active" : ""}`}
          aria-current={section === id ? "page" : undefined}
          aria-controls="dashboard-content"
          onClick={() => navigate(id)}
        >
          {label}
        </button>
      ))}
    </HorizontalNavigation>
  );
}

function SecondaryNavigation({
  section,
  subsection,
  navigate,
}: {
  section: SectionId;
  subsection: string;
  navigate: (subsection: string) => void;
}) {
  return (
    <div className="section-nav-bar">
      <HorizontalNavigation
        activeKey={`${section}:${subsection}`}
        label={`${section} sections`}
        shellClassName="secondary-nav-shell"
        navigationClassName="secondary-navigation"
        trackClassName="secondary-navigation__track"
      >
        {secondarySections[section].map((label) => (
          <button
            key={label}
            type="button"
            className={`nav-button secondary-nav-link ${subsection === label ? "active" : ""}`}
            aria-current={subsection === label ? "page" : undefined}
            aria-controls="dashboard-content"
            onClick={() => navigate(label)}
          >
            {label}
          </button>
        ))}
      </HorizontalNavigation>
    </div>
  );
}

function WorkModule({
  workspace,
  view,
}: {
  workspace?: Workspace;
  view: string;
}) {
  const workspaceName = workspace?.displayName ?? "Private workspace";
  const allWork = workspace?.workItems ?? [];
  const openWork = allWork.filter(
    (work) => work.state !== "completed" && work.state !== "cancelled",
  );
  const visibleWork = allWork.filter((work) => {
    if (view === "Blocked") return work.state === "blocked";
    if (view === "History")
      return work.state === "completed" || work.state === "cancelled";
    return work.state !== "completed" && work.state !== "cancelled";
  });
  const blockedCount = allWork.filter(
    (work) => work.state === "blocked",
  ).length;
  const leasedCount = allWork.filter((work) => work.state === "leased").length;

  return (
    <section className="work-module">
      <header className="module-intro">
        <div>
          <p className="eyebrow">{workspaceName} / Work</p>
          <h1>Tasks</h1>
          <p className="lede">
            Governed commitments across people and workers, ordered by declared
            priority. This view observes Work. It does not silently create,
            lease, complete, or approve anything.
          </p>
        </div>
        <dl className="work-summary" aria-label="Work summary">
          <div>
            <dt>Open</dt>
            <dd>{openWork.length}</dd>
          </div>
          <div>
            <dt>Blocked</dt>
            <dd>{blockedCount}</dd>
          </div>
          <div>
            <dt>Leased</dt>
            <dd>{leasedCount}</dd>
          </div>
        </dl>
      </header>

      {visibleWork.length > 0 ? (
        <div className="work-list" aria-label={`${view} Work`}>
          {visibleWork.map((work) => (
            <WorkCard
              key={work.id}
              installationName={workspace?.displayName ?? "Workspace"}
              work={work}
            />
          ))}
        </div>
      ) : (
        <div className="directional-empty-state">
          <h2>{emptyWorkHeading(view)}</h2>
          <p>{emptyWorkDetail(view, workspaceName)}</p>
        </div>
      )}
    </section>
  );
}

function WorkCard({
  installationName,
  work,
}: {
  installationName: string;
  work: WorkItem;
}) {
  const updated = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(work.updatedAt));
  const statusLabel = work.state.replaceAll("_", " ");
  const custody = work.custodianName
    ? `${work.custodianName} · ${work.custodianKind ?? "custodian"}`
    : "Unassigned";

  return (
    <article className={`work-card state-${work.state}`}>
      <header>
        <div
          className="work-card__priority"
          aria-label={`Priority ${work.priority}`}
        >
          <span>{work.priority}</span>
          <small>Priority</small>
        </div>
        <div className="work-card__title">
          <p className="eyebrow">Work {shortId(work.id)}</p>
          <h2>{work.title}</h2>
        </div>
        <span className="work-state">{statusLabel}</span>
      </header>
      <div className="work-card__body">
        <div>
          <p className="work-label">Requested outcome</p>
          <p className="work-outcome">{work.requestedOutcome}</p>
        </div>
        <dl className="work-metadata">
          <div>
            <dt>Custody</dt>
            <dd>{custody}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{updated}</dd>
          </div>
          <div>
            <dt>Parent</dt>
            <dd>{work.parentWorkId ? shortId(work.parentWorkId) : "None"}</dd>
          </div>
        </dl>
      </div>
      <details className="work-criteria">
        <summary>
          Acceptance criteria · {work.acceptanceCriteria.length}
        </summary>
        {work.acceptanceCriteria.length > 0 ? (
          <ol>
            {work.acceptanceCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ol>
        ) : (
          <p>No acceptance criteria have been recorded.</p>
        )}
      </details>
      <AgentPromptButton
        compact
        spec={{
          installationName,
          kind: "work item",
          id: work.id,
          title: work.title,
          state: work.state,
          objective: work.requestedOutcome,
          closureEvidence: work.acceptanceCriteria.join(" "),
          currentEvidence: `Priority ${work.priority}. Custody: ${custody}. Updated ${updated}.`,
          authorityBoundary:
            "Analyze and recommend only. Do not change state, custody, lease, priority, acceptance criteria, or external systems without applicable authority.",
          relatedRecords: work.parentWorkId ? [work.parentWorkId] : [],
        }}
      />
    </article>
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function emptyWorkHeading(view: string): string {
  if (view === "Blocked") return "Nothing is blocked";
  if (view === "History") return "No Work has reached history";
  return "No open Work is visible";
}

function emptyWorkDetail(view: string, installationName: string): string {
  if (view === "Blocked")
    return "No visible Work item currently declares the blocked state.";
  if (view === "History")
    return "Completed and cancelled Work will appear here with its durable state intact.";
  return `Create Work through an authorized planning flow. ${installationName} will not manufacture tasks from silence.`;
}

function PrivacyState({ workspace }: { workspace?: string }) {
  return (
    <div className="privacy-state" aria-label="Private workspace">
      <span className="privacy-shield" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 3 19 6v5c0 5-3.1 8.3-7 10-3.9-1.7-7-5-7-10V6l7-3Z" />
        </svg>
      </span>
      {workspace ?? "Private workspace"}
    </div>
  );
}

export function commandSectionIdFromSubsection(subsection: string) {
  return (
    commandBridgeSections.find((item) => item.route === subsection)?.id ??
    commandBridgeSections[0].id
  );
}

function CommandBridgePage({
  vortonInstallationId,
  workspace,
  subsection,
  navigate,
}: {
  vortonInstallationId: string;
  workspace?: Workspace;
  subsection: string;
  navigate(subsection: string): void;
}) {
  const workspaceName = workspace?.displayName ?? "Private workspace";
  return (
    <SectionNavigator
      items={commandBridgeSections}
      label="Command Bridge sections"
      requestedId={commandSectionIdFromSubsection(subsection)}
      onNavigate={navigate}
    >
      <section
        id="command-briefing"
        className="command-page-section command-page-section-briefing"
        aria-label="Briefing"
      >
        <CommandBriefing
          vortonInstallationId={vortonInstallationId}
          workspace={workspace}
        />
      </section>
      <section
        id="command-council"
        className="command-page-section command-page-section-council"
        aria-label="Council"
      >
        <ExecutiveCouncil
          vortonInstallationId={vortonInstallationId}
          workspace={workspace}
          embedded
        />
      </section>
      <CommandDecisions />
      <CommandActivity workspace={workspace} workspaceName={workspaceName} />
    </SectionNavigator>
  );
}

function CommandDecisions() {
  return (
    <section
      id="command-decisions"
      className="command-page-section command-page-register"
      aria-labelledby="command-decisions-heading"
    >
      <header className="command-section-heading">
        <div>
          <p className="eyebrow">Decision register</p>
          <h2 id="command-decisions-heading">Owner decisions</h2>
          <p>
            Council recommendations remain advisory until the owner records a
            separate decision. No recommendation silently becomes authority.
          </p>
        </div>
        <span className="status-pill status-watch">0 recorded</span>
      </header>
      <div className="directional-empty-state">
        <h3>No owner decision has been recorded</h3>
        <p>
          Completed council recommendations will remain visible above. A future
          decision workflow will bind an owner judgment to the exact advisory
          records it accepts or rejects.
        </p>
      </div>
    </section>
  );
}

function CommandActivity({
  workspace,
  workspaceName,
}: {
  workspace?: Workspace;
  workspaceName: string;
}) {
  const recentWork = [...(workspace?.workItems ?? [])]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 6);

  return (
    <section
      id="command-activity"
      className="command-page-section command-page-register"
      aria-labelledby="command-activity-heading"
    >
      <header className="command-section-heading">
        <div>
          <p className="eyebrow">Governed activity</p>
          <h2 id="command-activity-heading">Current organizational change</h2>
          <p>
            This is the {workspaceName} Work projection. It observes declared
            state and custody without manufacturing an execution log.
          </p>
        </div>
        <span className="status-pill status-good">
          {recentWork.length} visible
        </span>
      </header>
      {recentWork.length > 0 ? (
        <div className="compact-list command-activity-list">
          {recentWork.map((work) => (
            <article key={work.id}>
              <div>
                <p className="eyebrow">Work · P{work.priority}</p>
                <h3>{work.title}</h3>
                <p>{work.requestedOutcome}</p>
              </div>
              <div className="right-meta">
                <span className="status-pill status-watch">{work.state}</span>
                <time dateTime={work.updatedAt}>
                  {new Intl.DateTimeFormat(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(work.updatedAt))}
                </time>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="directional-empty-state">
          <h3>No governed activity is available</h3>
          <p>Work will appear here after it enters this workspace.</p>
        </div>
      )}
    </section>
  );
}

function CommandBriefing({
  vortonInstallationId,
  workspace,
}: {
  vortonInstallationId: string;
  workspace?: Workspace;
}) {
  const runtime = useBrowserRuntime();
  const workspaceName = workspace?.displayName ?? "Private workspace";
  const binding = workspace?.proposalBindings[0];
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
    if (!workspace || !binding || !objective.trim()) return;
    setBusy(true);
    setStatus(undefined);
    try {
      const payload = (await runtime.submitExecutive("proposals", {
        installationId: vortonInstallationId,
        workspaceId: workspace.id,
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
              : "No governed executive lane is available for this workspace."}
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
                  installationName: workspaceName,
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
  installationName,
  section,
  view,
}: {
  installationName: string;
  section: Exclude<SectionId, "command">;
  view: string;
}) {
  const sectionLabel =
    primarySections.find(([id]) => id === section)?.[1] ?? section;
  const pageLabel = section === "admin" ? view : sectionLabel;
  return (
    <section className="module-foundation">
      <p className="eyebrow">
        {installationName} / {sectionLabel}
        {section === "admin" ? ` / ${view}` : ""}
      </p>
      <h1>{pageLabel}</h1>
      <p className="lede">
        This {section === "admin" ? "Admin area" : "module"} is being translated
        into {installationName} from the proven personal interface. The previous
        generic preview has been removed rather than presented as finished
        product.
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
