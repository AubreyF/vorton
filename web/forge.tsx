import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { WorkspaceNavigation } from "./design/workspace-navigation";
import type {
  State,
  Idea,
  IdeaFields,
  TaskFields,
  Recommendation,
} from "./types";
import "./forge.css";

export const forgeViews = ["overview", "tasks", "goals", "ideas"] as const;
export const workspaceSections = [
  "bridge",
  "council",
  "forge",
  "finance",
  "tools",
  "admin",
];
export const workspaceLinks = (profile: string) =>
  workspaceSections.map((id) => ({
    id,
    label: id[0].toUpperCase() + id.slice(1),
    path: `/${profile.toLowerCase()}/${id}`,
  }));
const bands = ["unknown", "low", "medium", "high"];
const stages = [
  "inbox",
  "exploring",
  "ready",
  "parked",
  "graduated",
  "archived",
];
const assessments = {
  value: "Potential value",
  complexity: "Complexity",
  effort: "Initial effort",
  upkeep: "Ongoing upkeep",
  confidence: "Confidence",
  pull: "Personal pull",
} as const;
const split = (value: FormDataEntryValue | null) => [
  ...new Set(
    String(value ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];
const emptyIdea: IdeaFields = {
  title: "",
  description: "",
  owner: "Owner",
  status: "inbox",
  projects: [],
  tags: [],
  goalIds: [],
  value: "unknown",
  complexity: "unknown",
  effort: "unknown",
  upkeep: "unknown",
  confidence: "unknown",
  pull: "unknown",
  startCondition: "",
  experiment: "",
  reviewOn: "",
  evidence: "",
};
type Act = (action: string, payload: unknown) => Promise<boolean | undefined>;
export function OrganizationInputs({
  value,
  state,
}: {
  value: { projects?: string[]; tags?: string[] };
  state: State;
}) {
  const records = [...state.goals, ...state.tasks, ...(state.ideas ?? [])];
  return (
    <div className="form-grid">
      {(["projects", "tags"] as const).map((key) => (
        <label key={key}>
          {key === "projects" ? "Projects" : "Tags"}
          <input
            name={key}
            defaultValue={value[key]?.join(", ")}
            list={`forge-${key}`}
            placeholder="Separate with commas"
          />
          <datalist id={`forge-${key}`}>
            {[...new Set(records.flatMap((r) => r[key] ?? []))]
              .sort()
              .map((v) => (
                <option key={v} value={v} />
              ))}
          </datalist>
        </label>
      ))}
    </div>
  );
}
export function RecordLabels({
  record,
}: {
  record: { projects?: string[]; tags?: string[] };
}) {
  return (
    <div className="forge-labels">
      {record.projects?.map((p) => (
        <span className="badge" key={`p:${p}`}>
          {p}
        </span>
      ))}
      {record.tags?.map((t) => (
        <span className="quiet" key={`t:${t}`}>
          #{t}
        </span>
      ))}
    </div>
  );
}
export function CouncilOrigin({ state, id }: { state: State; id: string }) {
  const proposal = [...state.recommendations]
    .reverse()
    .find((r) => r.status === "accepted" && r.resultId === id);
  return proposal ? (
    <p>
      <a
        href={`/${state.profile.toLowerCase()}/council#recommendation-${proposal.id}`}
      >
        Council recommendation
      </a>
    </p>
  ) : null;
}
export function Forge({
  state,
  view,
  busy,
  error,
  act,
  goals,
  tasks,
  draftTask,
}: {
  state: State;
  view: string;
  busy: boolean;
  error: string;
  act: Act;
  goals: (state: State) => ReactNode;
  tasks: (state: State) => ReactNode;
  draftTask: (fields: TaskFields) => void;
}) {
  const selected = forgeViews.includes(view as (typeof forgeViews)[number])
    ? view
    : "overview";
  const [query, setQuery] = useState(
    () => new URLSearchParams(location.search).get("q") ?? "",
  );
  const [project, setProject] = useState(
    () => new URLSearchParams(location.search).get("project") ?? "",
  );
  const [tag, setTag] = useState(
    () => new URLSearchParams(location.search).get("tag") ?? "",
  );
  const [stage, setStage] = useState(
    location.hash.startsWith("#idea-") ? "all" : "open",
  );
  const [group, setGroup] = useState("readiness");
  const [capture, setCapture] = useState("");
  const [editing, setEditing] = useState<Idea | null | undefined>();
  const [graduate, setGraduate] = useState<Idea | null>(null);
  const [notice, setNotice] = useState("");
  const base = `/${state.profile.toLowerCase()}/forge`;
  useEffect(() => {
    const key = `vorton:forge:${state.profile}`;
    try {
      if (!view) {
        const last = localStorage.getItem(key);
        if (
          last &&
          forgeViews.includes(last as (typeof forgeViews)[number]) &&
          last !== "overview"
        ) {
          location.replace(`${base}/${last}${location.search}${location.hash}`);
          return;
        }
      }
      localStorage.setItem(key, selected);
    } catch {
      /* Storage can be disabled; explicit navigation still works. */
    }
  }, [state.profile, selected, view, base]);
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (project) params.set("project", project);
  if (tag) params.set("tag", tag);
  const suffix = params.size ? `?${params}` : "";
  useEffect(() => {
    history.replaceState(
      null,
      "",
      `${location.pathname}${suffix}${location.hash}`,
    );
  }, [suffix]);
  const all = [...state.goals, ...state.tasks, ...(state.ideas ?? [])];
  const matches = (r: {
    title: string;
    projects?: string[];
    tags?: string[];
    description?: string;
    intent?: string;
    notes?: string;
    owner?: string;
  }) =>
    (!project || r.projects?.includes(project)) &&
    (!tag || r.tags?.includes(tag)) &&
    (!query ||
      [
        r.title,
        r.description,
        r.intent,
        r.notes,
        r.owner,
        ...(r.projects ?? []),
        ...(r.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()));
  const filtered = {
    ...state,
    goals: state.goals.filter(matches),
    tasks: state.tasks.filter(matches),
    ideas: (state.ideas ?? []).filter(matches),
  };
  const shown = filtered.ideas.filter(
    (i) =>
      stage === "all" ||
      (stage === "open"
        ? !["archived", "graduated"].includes(i.status)
        : i.status === stage),
  );
  const groups =
    group === "readiness"
      ? stages.filter((s) => shown.some((i) => i.status === s))
      : group === "project"
        ? [
            ...new Set(
              shown.flatMap((i) =>
                i.projects.length ? i.projects : ["No project"],
              ),
            ),
          ].sort()
        : ["All ideas"];
  const cards = (items: Idea[]) =>
    items.map((idea) => (
      <article
        className="panel forge-card"
        id={`idea-${idea.id}`}
        key={idea.id}
      >
        <div className="record-heading">
          <h3>
            <button className="title-button" onClick={() => setEditing(idea)}>
              {idea.title}
            </button>
          </h3>
          <span className="badge">{idea.status}</span>
        </div>
        <RecordLabels record={idea} />
        <p className="prose forge-description">
          {idea.description ||
            "An idea worth keeping. Add detail when you are ready."}
        </p>
        <CouncilOrigin state={state} id={idea.id} />
        <dl className="forge-assessments">
          <div>
            <dt>Value</dt>
            <dd>{idea.value}</dd>
          </div>
          <div>
            <dt>Complexity</dt>
            <dd>{idea.complexity}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{idea.confidence}</dd>
          </div>
        </dl>
        {idea.sourceChanged && (
          <p role="status">
            Source evidence changed. Current source details are shown; review
            your earlier edits in history.
          </p>
        )}
        {idea.startCondition && (
          <p>
            <strong>Start when:</strong> {idea.startCondition}
          </p>
        )}
        {idea.reviewOn && <p>Review {idea.reviewOn}</p>}
        {idea.goalIds.map((id) => (
          <a key={id} href={`${base}/goals#goal-${id}`}>
            {state.goals.find((g) => g.id === id)?.title ?? "Linked goal"}
          </a>
        ))}
        <div className="actions">
          <button disabled={busy} onClick={() => setEditing(idea)}>
            Edit idea
          </button>
          {!["graduated", "archived"].includes(idea.status) && (
            <button disabled={busy} onClick={() => setGraduate(idea)}>
              Graduate to goal
            </button>
          )}
          {idea.experiment && (
            <button
              onClick={() =>
                draftTask({
                  title: idea.experiment.slice(0, 180),
                  notes: idea.experiment,
                  owner: idea.owner,
                  goalId: "",
                  ideaIds: [idea.id],
                  projects: idea.projects,
                  tags: idea.tags,
                  dueOn: "",
                  status: "todo",
                  priority: "normal",
                })
              }
            >
              Draft experiment
            </button>
          )}
        </div>
      </article>
    ));
  return (
    <div className="forge">
      <header className="page-heading">
        <div>
          <h1>Forge</h1>
          <p>Keep the spark. Choose the work. Build what matters.</p>
        </div>
      </header>
      <WorkspaceNavigation
        profile="Forge"
        level="secondary"
        page={selected}
        links={forgeViews.map((id) => ({
          id,
          label: id[0].toUpperCase() + id.slice(1),
          path: `${base}/${id}${suffix}`,
        }))}
      />
      <form
        className="forge-capture"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act("idea.create", {
              fields: {
                title: capture,
                owner: state.settings?.defaultOwner ?? "Owner",
                projects: project ? [project] : [],
                tags: tag ? [tag] : [],
              },
            })
          ) {
            setCapture("");
            setNotice("Idea saved to Inbox.");
          }
        }}
      >
        <label htmlFor="forge-capture">Capture an idea</label>
        <div>
          <input
            id="forge-capture"
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            required
            maxLength={180}
            placeholder="A thought is enough. You can shape it later."
          />
          <button disabled={busy || !capture.trim()}>Save idea</button>
        </div>
      </form>
      {notice && <p role="status">{notice}</p>}
      <div className="filters forge-filters">
        <label>
          Search Forge
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find ideas, goals or tasks"
          />
        </label>
        {(["project", "tag"] as const).map((key) => (
          <label key={key}>
            {key === "project" ? "Project" : "Tag"}
            <select
              value={key === "project" ? project : tag}
              onChange={(e) =>
                (key === "project" ? setProject : setTag)(e.target.value)
              }
            >
              <option value="">All {key}s</option>
              {[
                ...new Set(
                  all.flatMap(
                    (r) => r[key === "project" ? "projects" : "tags"] ?? [],
                  ),
                ),
              ]
                .sort()
                .map((v) => (
                  <option key={v}>{v}</option>
                ))}
            </select>
          </label>
        ))}
        {(query || project || tag) && (
          <button
            onClick={() => {
              setQuery("");
              setProject("");
              setTag("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {selected === "tasks" && tasks(filtered)}
      {selected === "goals" && goals(filtered)}
      {selected === "ideas" && (
        <>
          <div className="page-heading">
            <div>
              <h2>Ideas</h2>
              <p>
                Possibilities you can explore without committing to build them.
              </p>
            </div>
            <button onClick={() => setEditing(null)}>
              New idea with details
            </button>
          </div>
          <div className="filters">
            <label>
              Readiness
              <select value={stage} onChange={(e) => setStage(e.target.value)}>
                {["open", ...stages, "all"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Group by
              <select value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="readiness">Readiness</option>
                <option value="project">Project</option>
                <option value="none">No grouping</option>
              </select>
            </label>
            <span>{shown.length} ideas</span>
          </div>
          {!shown.length && (
            <p>
              No ideas in this view. Capture one above or adjust your filters.
            </p>
          )}
          {groups.map((g) => (
            <section key={g}>
              <h2 className="forge-group">{g}</h2>
              <div className="forge-grid">
                {cards(
                  shown.filter((i) =>
                    group === "readiness"
                      ? i.status === g
                      : group === "project"
                        ? (i.projects.length
                            ? i.projects
                            : ["No project"]
                          ).includes(g)
                        : true,
                  ),
                )}
              </div>
            </section>
          ))}
        </>
      )}
      {selected === "overview" && (
        <div className="forge-overview">
          <section>
            <header className="record-heading">
              <h2>In motion</h2>
              <a href={`${base}/goals${suffix}`}>All goals</a>
            </header>
            <div className="forge-grid">
              {filtered.goals
                .filter((g) => g.status === "active")
                .slice(0, 6)
                .map((g) => (
                  <article className="panel" key={g.id}>
                    <h3>
                      <a href={`${base}/goals#goal-${g.id}`}>{g.title}</a>
                    </h3>
                    <RecordLabels record={g} />
                    <p>{g.intent}</p>
                    <p>
                      <strong>Next milestone:</strong>{" "}
                      {g.milestones.find((m) => !m.done)?.title ||
                        g.successCriteria ||
                        "Define the next milestone"}
                    </p>
                    {state.tasks
                      .filter(
                        (t) => t.goalId === g.id && t.status === "blocked",
                      )
                      .map((t) => (
                        <p key={t.id}>
                          <strong>Blocked:</strong> {t.title}
                        </p>
                      ))}
                  </article>
                ))}
            </div>
            {!filtered.goals.some((g) => g.status === "active") && (
              <p>No active goals in this view.</p>
            )}
          </section>
          <section>
            <header className="record-heading">
              <h2>Needs action</h2>
              <a href={`${base}/tasks${suffix}`}>All tasks</a>
            </header>
            <div className="forge-grid">
              {filtered.tasks
                .filter((t) => !["done", "cancelled"].includes(t.status))
                .sort(
                  (a, b) =>
                    Number(b.status === "blocked") -
                      Number(a.status === "blocked") ||
                    (a.dueOn || "9999").localeCompare(b.dueOn || "9999"),
                )
                .slice(0, 6)
                .map((t) => (
                  <article className="panel" key={t.id}>
                    <h3>
                      <a href={`${base}/tasks#task-${t.id}`}>{t.title}</a>
                    </h3>
                    <RecordLabels record={t} />
                    <p>
                      {t.status} · {t.owner}
                      {t.dueOn && ` · Due ${t.dueOn}`}
                    </p>
                  </article>
                ))}
            </div>
            {!filtered.tasks.some(
              (t) => !["done", "cancelled"].includes(t.status),
            ) && <p>No open tasks in this view.</p>}
          </section>
          <section>
            <header className="record-heading">
              <h2>Worth revisiting</h2>
              <a href={`${base}/ideas${suffix}`}>All ideas</a>
            </header>
            <p>
              Ready ideas and ideas whose review date has arrived. Start
              conditions still need your judgment.
            </p>
            <div className="forge-grid">
              {cards(
                filtered.ideas
                  .filter(
                    (i) =>
                      !["graduated", "archived"].includes(i.status) &&
                      (i.status === "ready" ||
                        (i.reviewOn &&
                          i.reviewOn <=
                            new Date().toLocaleDateString("en-CA"))),
                  )
                  .slice(0, 4),
              )}
            </div>
          </section>
          <section>
            <h2>Council proposals</h2>
            <p>
              {
                state.recommendations.filter((r) =>
                  ["pending", "deferred"].includes(r.status),
                ).length
              }{" "}
              awaiting your decision.
            </p>
            <a href={`/${state.profile.toLowerCase()}/council#recommendations`}>
              Review recommendations
            </a>
          </section>
        </div>
      )}
      {editing !== undefined && (
        <IdeaEditor
          key={editing?.id ?? "new"}
          state={state}
          idea={editing ?? undefined}
          busy={busy}
          error={error}
          close={() => setEditing(undefined)}
          save={async (fields) => {
            if (
              await act(`idea.${editing ? "update" : "create"}`, {
                id: editing?.id,
                fields,
              })
            )
              setEditing(undefined);
          }}
        />
      )}
      {graduate && (
        <GraduateIdea
          state={state}
          idea={graduate}
          busy={busy}
          error={error}
          act={act}
          close={() => setGraduate(null)}
        />
      )}
    </div>
  );
}

export function IdeaEditor({
  state,
  idea,
  recommendation,
  busy,
  error,
  close,
  save,
}: {
  state: State;
  idea?: Idea;
  recommendation?: Recommendation;
  busy: boolean;
  error: string;
  close: () => void;
  save: (fields: IdeaFields) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const value = {
    ...emptyIdea,
    ...(recommendation?.proposal ?? idea),
  } as IdeaFields;
  useEffect(() => {
    ref.current?.showModal();
    ref.current
      ?.querySelector<HTMLInputElement>('input[name="title"]')
      ?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else close();
      }}
      aria-labelledby="idea-editor-heading"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const fields = { ...value };
          for (const key of Object.keys(value) as (keyof IdeaFields)[]) {
            if (["projects", "tags"].includes(key)) continue;
            if (data.has(key))
              Object.assign(fields, { [key]: String(data.get(key)) });
          }
          fields.projects = split(data.get("projects"));
          fields.tags = split(data.get("tags"));
          const clean = Object.fromEntries(
            Object.keys(emptyIdea).map((k) => [
              k,
              fields[k as keyof IdeaFields],
            ]),
          ) as IdeaFields;
          await save(clean);
        }}
      >
        <div className="dialog-heading">
          <h2 id="idea-editor-heading">
            {recommendation
              ? "Edit and accept idea"
              : idea
                ? "Edit idea"
                : "New idea"}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={close}
            aria-label="Close editor"
          >
            ×
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        <label>
          Title
          <input
            name="title"
            defaultValue={value.title}
            required
            maxLength={180}
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            defaultValue={value.description}
            maxLength={8000}
            rows={4}
          />
        </label>
        <OrganizationInputs value={value} state={state} />
        <div className="form-grid">
          <label>
            Owner
            <input
              name="owner"
              defaultValue={value.owner}
              required
              maxLength={120}
            />
          </label>
          <label>
            Readiness
            <select name="status" defaultValue={value.status}>
              {(value.status === "graduated"
                ? ["graduated"]
                : stages.filter((s) => s !== "graduated")
              ).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="quiet">
          Estimates are optional. Unknown is useful information.
        </p>
        <div className="form-grid">
          {Object.entries(assessments).map(([key, label]) => (
            <label key={key}>
              {label}
              <select
                name={key}
                defaultValue={String(value[key as keyof IdeaFields])}
              >
                {bands.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label>
          Start when
          <textarea
            name="startCondition"
            defaultValue={value.startCondition}
            maxLength={4000}
            placeholder="What needs to become true before you begin?"
          />
        </label>
        <label>
          Smallest useful test
          <textarea
            name="experiment"
            defaultValue={value.experiment}
            maxLength={4000}
          />
        </label>
        <label>
          Review on
          <input name="reviewOn" type="date" defaultValue={value.reviewOn} />
        </label>
        <label>
          Evidence and value notes
          <textarea
            name="evidence"
            defaultValue={value.evidence}
            maxLength={12000}
          />
        </label>
        {idea && (
          <details>
            <summary>Original capture and history</summary>
            <p className="prose">{idea.original}</p>
            {idea.legacy && <pre>{JSON.stringify(idea.legacy, null, 2)}</pre>}
            {idea.history.map((h) => (
              <details key={h.version}>
                <summary>Version {h.version}</summary>
                <pre>{JSON.stringify(h.fields, null, 2)}</pre>
              </details>
            ))}
          </details>
        )}
        <div className="actions">
          <button className="primary" disabled={busy}>
            {recommendation ? "Accept edited idea" : "Save idea"}
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
function GraduateIdea({
  state,
  idea,
  busy,
  error,
  act,
  close,
}: {
  state: State;
  idea: Idea;
  busy: boolean;
  error: string;
  act: Act;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [existing, setExisting] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else close();
      }}
      aria-labelledby="graduate-heading"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const get = (k: string) => String(f.get(k) ?? "");
          if (
            await act("idea.graduate", {
              id: idea.id,
              targetVersion: idea.version,
              ...(existing
                ? { goalId: existing }
                : {
                    fields: {
                      title: get("title"),
                      intent: get("intent"),
                      successCriteria: get("successCriteria"),
                      owner: idea.owner,
                      status: "active",
                      projects: idea.projects,
                      tags: idea.tags,
                      evidence: idea.evidence,
                      milestones: get("milestone")
                        ? [{ title: get("milestone"), done: false }]
                        : [],
                    },
                  }),
            })
          )
            close();
        }}
      >
        <h2 id="graduate-heading">Graduate to goal</h2>
        <p>{idea.title}</p>
        <p>
          Keep this idea and its history connected to the outcome you choose to
          pursue.
        </p>
        {error && <p role="alert">{error}</p>}
        <label>
          Destination
          <select
            value={existing}
            onChange={(e) => setExisting(e.target.value)}
          >
            <option value="">Create a new goal</option>
            {state.goals
              .filter((g) => ["active", "paused"].includes(g.status))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
          </select>
        </label>
        {!existing && (
          <>
            <label>
              Goal title
              <input
                name="title"
                required
                maxLength={180}
                defaultValue={idea.title}
              />
            </label>
            <label>
              Desired outcome
              <textarea
                name="intent"
                defaultValue={idea.description}
                maxLength={4000}
              />
            </label>
            <label>
              Success criteria
              <textarea
                name="successCriteria"
                required
                maxLength={4000}
                placeholder="What observable result will mean this succeeded?"
              />
            </label>
            <label>
              First milestone
              <input name="milestone" maxLength={240} />
            </label>
          </>
        )}
        <p className="quiet">
          Consider the time this needs and what current work it would displace.
        </p>
        <div className="actions">
          <button className="primary" disabled={busy}>
            Graduate idea
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
