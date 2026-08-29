import {
  moonbaseIncidents,
  triageMoonbaseIncidents,
} from "@aubos/example-moonbase-triage";
import {
  createSyntheticControlPlaneDataSource,
  type ControlPlaneSnapshot,
  type ModuleSummary,
} from "@aubos/control-plane";
import {
  Badge,
  Button,
  EmptyState,
  Mark,
  SectionHeading,
  StatusDot,
} from "@aubos/ui";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CirclePlus,
  Command,
  FlaskConical,
  Menu,
  Search,
  Shield,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isPageId, kernelNav, moduleNav, type PageId } from "./navigation.js";

const source = createSyntheticControlPlaneDataSource();

function initialPage(): PageId {
  const hash = window.location.hash.slice(1);
  return isPageId(hash) ? hash : "overview";
}

export function App() {
  const [snapshot, setSnapshot] = useState<ControlPlaneSnapshot>();
  const [page, setPage] = useState<PageId>(initialPage);
  const [railOpen, setRailOpen] = useState(false);
  const [newWorkOpen, setNewWorkOpen] = useState(false);

  useEffect(() => {
    void source.getSnapshot().then(setSnapshot);
  }, []);
  useEffect(() => {
    const onHash = () => setPage(initialPage());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(next: PageId) {
    window.location.hash = next;
    setPage(next);
    setRailOpen(false);
  }

  async function createWork(input: { title: string; module: string }) {
    await source.createWork(input);
    setSnapshot(await source.getSnapshot());
  }

  if (!snapshot)
    return (
      <div className="boot">
        <Mark />
        <p>Opening control plane…</p>
      </div>
    );

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="menu-button"
          onClick={() => setRailOpen(true)}
          aria-label="Open navigation"
        >
          <Menu />
        </button>
        <Mark />
        <div className="installation-switcher">
          <span className="installation-switcher__label">Installation</span>
          <button>
            Moonbase Lab <ChevronDown size={14} />
          </button>
        </div>
        <div className="topbar__search">
          <Search size={16} />
          <span>Search work, records, people</span>
          <kbd>⌘ K</kbd>
        </div>
        <div className="topbar__person" title="Synthetic installation owner">
          <span>AN</span>
          <div>
            <strong>Ada North</strong>
            <small>Owner</small>
          </div>
        </div>
      </header>

      <aside className={`rail ${railOpen ? "rail--open" : ""}`}>
        <button
          className="rail__close"
          onClick={() => setRailOpen(false)}
          aria-label="Close navigation"
        >
          <X />
        </button>
        <NavGroup
          label="Control plane"
          items={kernelNav}
          page={page}
          navigate={navigate}
        />
        <NavGroup
          label="Modules"
          items={moduleNav}
          page={page}
          navigate={navigate}
        />
        <div className="rail__foot">
          <StatusDot />
          <span>
            <strong>Local fixture</strong>
            <small>No external connections</small>
          </span>
        </div>
      </aside>

      {railOpen && (
        <button
          className="rail-scrim"
          onClick={() => setRailOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <div className="horizon">
        <div>
          <StatusDot />
          <strong>Moonbase Lab</strong>
          <span>Synthetic mode</span>
        </div>
        <div>
          <span>Authority</span>
          <strong>Local fixture only</strong>
        </div>
        <div>
          <span>Release</span>
          <strong>{snapshot.installation.release}</strong>
        </div>
        <div>
          <span>Region</span>
          <strong>{snapshot.installation.region}</strong>
        </div>
      </div>

      <main className="main">
        <Page
          page={page}
          snapshot={snapshot}
          navigate={navigate}
          onNewWork={() => setNewWorkOpen(true)}
        />
      </main>

      {newWorkOpen && (
        <NewWorkDialog
          onClose={() => setNewWorkOpen(false)}
          onCreate={createWork}
        />
      )}
    </div>
  );
}

function NavGroup({
  label,
  items,
  page,
  navigate,
}: {
  label: string;
  items: readonly { id: PageId; label: string; icon: typeof Command }[];
  page: PageId;
  navigate: (page: PageId) => void;
}) {
  return (
    <nav className="nav-group" aria-label={label}>
      <p>{label}</p>
      {items.map(({ id, label: itemLabel, icon: Icon }) => (
        <button
          key={id}
          className={page === id ? "is-active" : ""}
          onClick={() => navigate(id)}
        >
          <Icon size={17} />
          <span>{itemLabel}</span>
          {id === "tools" && <small>0</small>}
        </button>
      ))}
    </nav>
  );
}

function Page({
  page,
  snapshot,
  navigate,
  onNewWork,
}: {
  page: PageId;
  snapshot: ControlPlaneSnapshot;
  navigate: (page: PageId) => void;
  onNewWork: () => void;
}) {
  if (page === "overview")
    return (
      <Overview snapshot={snapshot} navigate={navigate} onNewWork={onNewWork} />
    );
  if (page === "people") return <People snapshot={snapshot} />;
  if (page === "workers") return <Workers snapshot={snapshot} />;
  if (page === "work")
    return <Work snapshot={snapshot} onNewWork={onNewWork} />;
  if (page === "records") return <Records snapshot={snapshot} />;
  if (page === "tools") return <Tools />;
  if (page === "command") return <CommandBridge />;
  return (
    <ModulePage
      module={snapshot.modules.find((module) => module.id === page)!}
      snapshot={snapshot}
      navigate={navigate}
    />
  );
}

function Overview({
  snapshot,
  navigate,
  onNewWork,
}: {
  snapshot: ControlPlaneSnapshot;
  navigate: (page: PageId) => void;
  onNewWork: () => void;
}) {
  return (
    <>
      <SectionHeading
        eyebrow="Friday · 28 August"
        title="The installation is quiet."
        description="Two items need human attention. Workers cannot approve, publish, or spend from this fixture."
        action={
          <Button onClick={onNewWork}>
            <CirclePlus size={17} /> Create work
          </Button>
        }
      />
      <section className="attention-grid">
        <button
          className="attention-card attention-card--signal"
          onClick={() => navigate("work")}
        >
          <span className="attention-card__index">01</span>
          <div>
            <Badge tone="orange">Review</Badge>
            <h2>Lunar supply risk register</h2>
            <p>Seven evidence records are ready for an owner decision.</p>
          </div>
          <ArrowRight />
        </button>
        <button className="attention-card" onClick={() => navigate("admin")}>
          <span className="attention-card__index">02</span>
          <div>
            <Badge tone="blue">Policy</Badge>
            <h2>Quiet hours need authority</h2>
            <p>A worker proposed a boundary. Only an owner can adopt it.</p>
          </div>
          <ArrowRight />
        </button>
      </section>
      <section className="overview-grid">
        <div className="panel">
          <PanelTitle
            eyebrow="Operational field"
            title="Work in motion"
            action="Open all"
            onAction={() => navigate("work")}
          />
          <WorkTable rows={snapshot.work.slice(0, 3)} />
        </div>
        <div className="panel">
          <PanelTitle
            eyebrow="Worker topology"
            title="Three known workers"
            action="Inspect"
            onAction={() => navigate("workers")}
          />
          <div className="worker-orbit">
            {snapshot.workers.map((worker, index) => (
              <button
                key={worker.id}
                className={`worker-node worker-node--${index}`}
                onClick={() => navigate("workers")}
              >
                <span>
                  <StatusDot
                    tone={
                      worker.health === "healthy"
                        ? "ok"
                        : worker.health === "degraded"
                          ? "warn"
                          : "idle"
                    }
                  />
                </span>
                <strong>{worker.name}</strong>
                <small>{worker.runtime}</small>
              </button>
            ))}
            <div className="worker-orbit__line" />
          </div>
        </div>
      </section>
      <section className="module-field">
        <PanelTitle
          eyebrow="First-party modules"
          title="One system, nine lenses"
        />
        <div className="module-grid">
          {snapshot.modules.map((module) => (
            <button
              key={module.id}
              onClick={() => navigate(module.id as PageId)}
            >
              <span>{module.name}</span>
              <small>{module.countLabel}</small>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function People({ snapshot }: { snapshot: ControlPlaneSnapshot }) {
  return (
    <>
      <SectionHeading
        eyebrow="Kernel / People"
        title="People grant authority."
        description="Roles teach competence. People and policy decide what may happen."
        action={<Button variant="outline">Invite person</Button>}
      />
      <div className="card-grid">
        {snapshot.people.map((person) => (
          <article className="person-card" key={person.id}>
            <div className="person-card__avatar">
              {person.name
                .split(" ")
                .map((part) => part[0])
                .join("")}
            </div>
            <div>
              <Badge tone={person.authority === "owner" ? "blue" : "neutral"}>
                {person.authority}
              </Badge>
              <h2>{person.name}</h2>
              <p>{person.role}</p>
            </div>
            <span className="person-card__state">
              <StatusDot tone={person.state === "active" ? "ok" : "idle"} />
              {person.state}
            </span>
          </article>
        ))}
      </div>
    </>
  );
}

function Workers({ snapshot }: { snapshot: ControlPlaneSnapshot }) {
  return (
    <>
      <SectionHeading
        eyebrow="Kernel / Workers"
        title="Bounded workers, visible custody."
        description="Health is observation. Capabilities still require policy and explicit Work."
      />
      <div className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>Worker</th>
              <th>Runtime</th>
              <th>Capability</th>
              <th>Custody</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.workers.map((worker) => (
              <tr key={worker.id}>
                <td>
                  <span className="table-primary">
                    <StatusDot
                      tone={
                        worker.health === "healthy"
                          ? "ok"
                          : worker.health === "degraded"
                            ? "warn"
                            : "idle"
                      }
                    />
                    <span>
                      <strong>{worker.name}</strong>
                      <small>{worker.health}</small>
                    </span>
                  </span>
                </td>
                <td>
                  {worker.runtime}
                  <small>{worker.model}</small>
                </td>
                <td>{worker.capability}</td>
                <td>{worker.custody}</td>
                <td>{worker.lastSeen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Work({
  snapshot,
  onNewWork,
}: {
  snapshot: ControlPlaneSnapshot;
  onNewWork: () => void;
}) {
  return (
    <>
      <SectionHeading
        eyebrow="Kernel / Work"
        title="Every outcome has custody."
        description="Requested outcomes, authority, dependencies, and evidence stay together."
        action={
          <Button onClick={onNewWork}>
            <CirclePlus size={17} /> Create work
          </Button>
        }
      />
      <div className="state-strip">
        {["proposed", "ready", "leased", "blocked", "review", "completed"].map(
          (state) => (
            <span key={state}>
              <strong>
                {snapshot.work.filter((work) => work.state === state).length}
              </strong>
              {state}
            </span>
          ),
        )}
      </div>
      <div className="panel table-panel">
        <WorkTable rows={snapshot.work} />
      </div>
    </>
  );
}

function WorkTable({ rows }: { rows: ControlPlaneSnapshot["work"] }) {
  return (
    <div className="work-list">
      {rows.map((work) => (
        <button className="work-row" key={work.id}>
          <span>
            <small>
              {work.id} · {work.module}
            </small>
            <strong>{work.title}</strong>
          </span>
          <Badge
            tone={
              work.state === "blocked"
                ? "orange"
                : work.state === "leased"
                  ? "blue"
                  : work.state === "completed"
                    ? "green"
                    : "neutral"
            }
          >
            {work.state}
          </Badge>
          <span className="work-row__owner">
            {work.owner}
            <small>
              {work.evidenceCount} records · {work.updatedAt}
            </small>
          </span>
          <ArrowRight size={16} />
        </button>
      ))}
    </div>
  );
}

function Records({ snapshot }: { snapshot: ControlPlaneSnapshot }) {
  return (
    <>
      <SectionHeading
        eyebrow="Kernel / Records"
        title="Claims keep their provenance."
        description="Evidence and authority remain attributable, inspectable, and explicitly superseded."
      />
      <div className="record-stack">
        {snapshot.records.map((record) => (
          <article key={record.id}>
            <span className="record-stack__line" />
            <Badge
              tone={
                record.kind === "approval"
                  ? "blue"
                  : record.kind === "decision"
                    ? "orange"
                    : "neutral"
              }
            >
              {record.kind}
            </Badge>
            <div>
              <small>{record.id}</small>
              <h2>{record.title}</h2>
              <p>Source: {record.source}</p>
            </div>
            <time>{record.recordedAt}</time>
          </article>
        ))}
      </div>
    </>
  );
}

function Tools() {
  const [labOpen, setLabOpen] = useState(false);
  return (
    <>
      <SectionHeading
        eyebrow="Module / Tools"
        title="Tools start blank."
        description="Installations define their own utilities. Examples are inert until a person reviews and installs them."
        action={
          <Button onClick={() => setLabOpen(true)}>
            <FlaskConical size={17} /> Open Tool Lab
          </Button>
        }
      />
      {!labOpen ? (
        <EmptyState eyebrow="Installed tools / 0" title="No tools installed">
          <p>
            This upstream installation contains no personal tools, data, assets,
            configuration, financial information, or transcripts.
          </p>
          <Button variant="outline" onClick={() => setLabOpen(true)}>
            Preview an offline example
          </Button>
        </EmptyState>
      ) : (
        <ToolLab onClose={() => setLabOpen(false)} />
      )}
    </>
  );
}

function ToolLab({ onClose }: { onClose: () => void }) {
  const incidents = useMemo(
    () => triageMoonbaseIncidents(moonbaseIncidents),
    [],
  );
  return (
    <section className="tool-lab">
      <header>
        <button onClick={onClose}>
          <ArrowLeft size={16} /> Installed tools
        </button>
        <Badge tone="orange">Uninstalled preview</Badge>
      </header>
      <div className="tool-lab__intro">
        <div>
          <p className="eyebrow">Tool Lab / Offline example</p>
          <h2>Moonbase Triage</h2>
          <p>
            Deterministic incident sorting against bundled synthetic fixtures.
            No network, installation data, or mutation access.
          </p>
        </div>
        <div className="permission-plate">
          <Shield size={22} />
          <span>
            <strong>Preview boundary</strong>
            <small>Network denied · synthetic data only</small>
          </span>
        </div>
      </div>
      <div className="triage-board">
        {["Immediate", "Next watch", "Monitor"].map((lane) => (
          <section key={lane}>
            <header>
              <span>{lane}</span>
              <small>
                {incidents.filter((incident) => incident.lane === lane).length}
              </small>
            </header>
            {incidents
              .filter((incident) => incident.lane === lane)
              .map((incident) => (
                <article key={incident.id}>
                  <small>
                    {incident.id} · score {incident.score}
                  </small>
                  <strong>{incident.summary}</strong>
                  <span>{incident.system}</span>
                </article>
              ))}
          </section>
        ))}
      </div>
      <footer>
        <span>
          <Check size={15} /> Same input, same result
        </span>
        <Button disabled title="Example installation is not part of Wave 1">
          Install unavailable in preview
        </Button>
      </footer>
    </section>
  );
}

function CommandBridge() {
  return (
    <>
      <SectionHeading
        eyebrow="Module / Command Bridge"
        title="Conversation cannot smuggle authority."
        description="Ask questions, inspect records, and draft proposals. Consequential actions still require policy and approval."
      />
      <section className="command-bridge">
        <div className="command-bridge__mark">
          <Command />
        </div>
        <p className="eyebrow">Synthetic session</p>
        <h2>What needs attention?</h2>
        <div className="prompt-grid">
          <button>Summarize open Work</button>
          <button>Show blocked decisions</button>
          <button>Inspect worker health</button>
        </div>
        <label>
          <span>Message Command Bridge</span>
          <textarea placeholder="Ask about this installation…" />
          <Button>Send</Button>
        </label>
        <small>
          No provider connected. Messages remain in this browser session.
        </small>
      </section>
    </>
  );
}

function ModulePage({
  module,
  snapshot,
  navigate,
}: {
  module: ModuleSummary;
  snapshot: ControlPlaneSnapshot;
  navigate: (page: PageId) => void;
}) {
  const factory = module.id === "factory";
  return (
    <>
      <SectionHeading
        eyebrow={`Module / ${module.name}`}
        title={module.name}
        description={module.description}
      />
      <section className="module-hero">
        <div>
          <Badge
            tone={
              module.state === "ready"
                ? "green"
                : module.state === "preview"
                  ? "blue"
                  : "neutral"
            }
          >
            {module.state}
          </Badge>
          <p className="eyebrow">Current signal</p>
          <h2>{module.countLabel}</h2>
          <p>
            {factory
              ? "Factory uses the kernel Work, Policy, Records, and worker topology. It is not a sibling system and does not replace an external repository's authority."
              : "This Wave 1 surface establishes the module boundary with synthetic, inspectable state. Provider integrations arrive behind explicit adapters."}
          </p>
        </div>
        <div className="module-hero__diagram">
          <span>People</span>
          <span>Policy</span>
          <strong>{module.name}</strong>
          <span>Work</span>
          <span>Records</span>
        </div>
      </section>
      <section className="panel">
        <PanelTitle
          eyebrow="Related kernel state"
          title={factory ? "Software work is still Work" : "No hidden ledger"}
          action="Inspect Work"
          onAction={() => navigate("work")}
        />
        <WorkTable
          rows={snapshot.work
            .filter((work) =>
              factory
                ? ["Admin", "Records"].includes(work.module)
                : work.module === module.name,
            )
            .slice(0, 2)}
        />
        {snapshot.work.filter((work) => work.module === module.name).length ===
          0 && (
          <p className="panel__empty">
            No module-specific Work in the synthetic fixture.
          </p>
        )}
      </section>
    </>
  );
}

function PanelTitle({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <header className="panel-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {action && (
        <button onClick={onAction}>
          {action} <ArrowRight size={14} />
        </button>
      )}
    </header>
  );
}

function NewWorkDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: { title: string; module: string }) => Promise<void>;
}) {
  const [created, setCreated] = useState(false);
  const [title, setTitle] = useState("");
  const [module, setModule] = useState("Tasks");

  async function submit() {
    if (!title.trim()) return;
    await onCreate({ title: title.trim(), module });
    setCreated(true);
  }
  return (
    <div className="modal-scrim" role="presentation">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-work-title"
      >
        <button className="modal__close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        {created ? (
          <div className="modal__success">
            <span>
              <Check />
            </span>
            <p className="eyebrow">Local draft created</p>
            <h2 id="new-work-title">Work is ready for review.</h2>
            <p>
              This fixture did not dispatch a worker or write to an external
              authority.
            </p>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            <p className="eyebrow">Kernel / New Work</p>
            <h2 id="new-work-title">Request an outcome</h2>
            <p>
              Creating Work records intent. It grants no capability by itself.
            </p>
            <label>
              Outcome
              <input
                autoFocus
                placeholder="What should become true?"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="form-grid">
              <label>
                Module
                <select
                  value={module}
                  onChange={(event) => setModule(event.target.value)}
                >
                  <option value="Tasks">Tasks</option>
                  <option value="Goals">Goals</option>
                  <option value="Factory">Factory</option>
                </select>
              </label>
              <label>
                Initial state
                <select defaultValue="proposed">
                  <option value="proposed">Proposed</option>
                  <option value="ready">Ready</option>
                </select>
              </label>
            </div>
            <label>
              Acceptance evidence
              <textarea placeholder="How will a reviewer know this is complete?" />
            </label>
            <footer>
              <Button variant="quiet" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!title.trim()}>
                Create local draft
              </Button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
