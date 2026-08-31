import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CouncilRecord,
  type ExecutiveCouncilState,
  type RuntimeBootstrap,
  useBrowserRuntime,
} from "./runtime.js";

type Installation = RuntimeBootstrap["installations"][number];
type Workspace = Installation["workspaces"][number];
type WorkItem = Workspace["workItems"][number];
type EvidenceItem = Workspace["proposalBindings"][number]["evidence"][number];

export const EXECUTIVE_COUNCIL_ROLES = [
  "Chief Executive Officer",
  "Chief Marketing Officer",
  "Chief Technology Officer",
  "Chief Operating Officer",
  "Chief Financial Officer",
] as const;

interface CouncilSurfaceProps {
  workspaceName: string;
  membershipKind: Workspace["personKind"];
  workItems: WorkItem[];
  selectedWorkId: string;
  evidence: EvidenceItem[];
  council?: ExecutiveCouncilState;
  loading: boolean;
  running: boolean;
  failure?: string;
  embedded?: boolean;
  onSelectWork(workId: string): void;
  onConvene(): void;
}

export function ExecutiveCouncil({
  vortonInstallationId,
  workspace,
  embedded = false,
}: {
  vortonInstallationId: string;
  workspace?: Workspace;
  embedded?: boolean;
}) {
  const runtime = useBrowserRuntime();
  const workItems = useMemo(
    () =>
      (workspace?.workItems ?? []).filter(
        (work) => work.state !== "completed" && work.state !== "cancelled",
      ),
    [workspace],
  );
  const [selectedWorkId, setSelectedWorkId] = useState(
    workspace?.proposalBindings[0]?.workId ?? workItems[0]?.id ?? "",
  );
  const [council, setCouncil] = useState<ExecutiveCouncilState>();
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string>();
  const activeRun = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!workspace || !selectedWorkId) {
      setCouncil(undefined);
      return;
    }
    let current = true;
    const controller = new AbortController();
    setLoading(true);
    setFailure(undefined);
    setCouncil((existing) =>
      existing?.work.id === selectedWorkId ? existing : undefined,
    );
    void runtime
      .getExecutiveCouncil(
        selectedWorkId,
        vortonInstallationId,
        workspace.id,
        controller.signal,
      )
      .then((state) => {
        if (current) setCouncil(state);
      })
      .catch((error: unknown) => {
        if (!current || controller.signal.aborted) return;
        setFailure(
          error instanceof Error
            ? error.message
            : "The council state could not be loaded.",
        );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [runtime, selectedWorkId, vortonInstallationId, workspace]);

  useEffect(
    () => () => {
      activeRun.current?.abort();
      activeRun.current = null;
    },
    [selectedWorkId, vortonInstallationId, workspace?.id],
  );

  const evidence =
    workspace?.proposalBindings.find(
      (binding) => binding.workId === selectedWorkId,
    )?.evidence ?? [];

  async function convene() {
    if (!workspace || !selectedWorkId || running) return;
    const controller = new AbortController();
    activeRun.current?.abort();
    activeRun.current = controller;
    setRunning(true);
    setFailure(undefined);
    try {
      const currentCouncil =
        council?.installationId === vortonInstallationId &&
        council.workspaceId === workspace.id &&
        council.work.id === selectedWorkId
          ? council
          : undefined;
      const startingState =
        currentCouncil ??
        (await runtime.installExecutiveCouncil(
          selectedWorkId,
          vortonInstallationId,
          workspace.id,
          controller.signal,
        ));
      if (controller.signal.aborted) return;
      setCouncil(startingState);
      const completed = await advanceCouncilUntilSettled(
        startingState,
        () =>
          runtime.advanceExecutiveCouncil(
            selectedWorkId,
            vortonInstallationId,
            workspace.id,
            controller.signal,
          ),
        setCouncil,
        12,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setCouncil(completed);
      await runtime.refreshBootstrap();
    } catch (error) {
      if (controller.signal.aborted) return;
      setFailure(
        error instanceof Error
          ? error.message
          : "The council paused after a failed model call.",
      );
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null;
        setRunning(false);
      }
    }
  }

  function selectWork(workId: string) {
    if (workId === selectedWorkId) return;
    activeRun.current?.abort();
    activeRun.current = null;
    setRunning(false);
    setFailure(undefined);
    setCouncil(undefined);
    setSelectedWorkId(workId);
  }

  return (
    <CouncilSurface
      workspaceName={workspace?.displayName ?? "Private workspace"}
      membershipKind={workspace?.personKind ?? "member"}
      workItems={workItems}
      selectedWorkId={selectedWorkId}
      evidence={evidence}
      council={council}
      loading={loading}
      running={running}
      failure={failure}
      embedded={embedded}
      onSelectWork={selectWork}
      onConvene={() => void convene()}
    />
  );
}

export async function advanceCouncilUntilSettled(
  initial: ExecutiveCouncilState,
  advance: () => Promise<ExecutiveCouncilState>,
  onProgress: (state: ExecutiveCouncilState) => void,
  maximumCalls = 12,
  signal?: AbortSignal,
): Promise<ExecutiveCouncilState> {
  let current = initial;
  let calls = 0;
  while (current.phase !== "complete" && calls < maximumCalls) {
    throwIfCouncilRunAborted(signal);
    const previousTotal = current.counts.total;
    current = await advance();
    throwIfCouncilRunAborted(signal);
    calls += 1;
    onProgress(current);
    if (current.phase !== "complete" && current.counts.total <= previousTotal) {
      throw new Error(
        "The council paused because an advance call produced no durable progress.",
      );
    }
  }
  if (current.phase !== "complete") {
    throw new Error(
      `The council paused at its ${String(maximumCalls)} call safety limit. Its recorded progress is intact.`,
    );
  }
  return current;
}

function throwIfCouncilRunAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("The council run was stopped.");
  error.name = "AbortError";
  throw error;
}

export function CouncilSurface({
  workspaceName,
  membershipKind,
  workItems,
  selectedWorkId,
  evidence,
  council,
  loading,
  running,
  failure,
  embedded = false,
  onSelectWork,
  onConvene,
}: CouncilSurfaceProps) {
  const selectedWork =
    workItems.find((work) => work.id === selectedWorkId) ?? workItems[0];
  const currentCouncil =
    council?.work.id === selectedWorkId ? council : undefined;
  const objective =
    currentCouncil?.work.requestedOutcome ?? selectedWork?.requestedOutcome;
  const installedRoles = currentCouncil?.roles ?? [];
  const required = currentCouncil?.counts.required ?? 11;
  const completed = currentCouncil?.counts.total ?? 0;
  const actionLabel = running
    ? currentCouncil?.nextStep
      ? `Consulting ${currentCouncil.nextStep.roleName}`
      : "Convening council"
    : currentCouncil?.phase === "complete"
      ? "Council complete"
      : currentCouncil
        ? "Resume council"
        : "Install and convene council";
  const IntroHeading = embedded ? "h2" : "h1";
  const councilUnavailable = Boolean(failure && !currentCouncil);

  return (
    <section className="council-module">
      <header className="module-intro">
        <div>
          <p className="eyebrow">{workspaceName} / Command Bridge / Council</p>
          <IntroHeading>Executive council</IntroHeading>
          <p className="lede">
            Five role skills examine one governed agenda independently, review
            one another, and prepare a synthesis for owner judgment.
          </p>
        </div>
        <dl className="work-summary" aria-label="Council authority summary">
          <div>
            <dt>Authority</dt>
            <dd>Advisory</dd>
          </div>
          <div>
            <dt>External actions</dt>
            <dd>0</dd>
          </div>
          <div>
            <dt>Final authority</dt>
            <dd>Owner</dd>
          </div>
        </dl>
      </header>

      <section className="council-agenda checkpoint-panel">
        <div className="checkpoint-heading">
          <div>
            <p className="eyebrow">Governed agenda</p>
            <h2>Choose one Work item</h2>
            <p className="checkpoint-summary">
              The selected Work record defines the council objective. A council
              cannot create its own mandate.
            </p>
          </div>
          <span className="status-pill status-watch">
            0 external actions authorized
          </span>
        </div>
        {workItems.length > 0 ? (
          <label className="council-work-selector">
            Work
            <select
              aria-label="Council agenda"
              value={selectedWorkId}
              disabled={running}
              onChange={(event) => onSelectWork(event.target.value)}
            >
              {workItems.map((work) => (
                <option key={work.id} value={work.id}>
                  {work.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="directional-empty-state">
            <h3>No eligible Work is available</h3>
            <p>Create or restore governed Work before convening a council.</p>
          </div>
        )}
        {objective && (
          <div className="council-objective">
            <p className="eyebrow">Objective</p>
            <p>{objective}</p>
          </div>
        )}
        <details className="evidence-disclosure">
          <summary>
            Evidence and acceptance criteria · {evidence.length} records
          </summary>
          <div className="evidence-list">
            {evidence.map((item) => (
              <article key={item.id}>
                <span>{item.classification}</span>
                <div>
                  <p>{item.summary}</p>
                  <code>{item.id}</code>
                </div>
              </article>
            ))}
            {(
              currentCouncil?.work.acceptanceCriteria ??
              selectedWork?.acceptanceCriteria ??
              []
            ).map((criterion, index) => (
              <article key={`${String(index)}-${criterion}`}>
                <span>Criterion</span>
                <p>{criterion}</p>
              </article>
            ))}
            {evidence.length === 0 &&
              (currentCouncil?.work.acceptanceCriteria.length ??
                selectedWork?.acceptanceCriteria.length ??
                0) === 0 && <p>No evidence records are bound to this Work.</p>}
          </div>
        </details>
      </section>

      {councilUnavailable ? (
        <section
          className="council-controls checkpoint-panel"
          aria-live="assertive"
        >
          <div className="checkpoint-heading">
            <div>
              <p className="eyebrow">Council protocol</p>
              <h2>Council state unavailable</h2>
              <p className="checkpoint-summary">
                The runtime could not read the durable council record. No role,
                worker assignment, progress count, or result is shown until the
                authoritative state can be loaded.
              </p>
            </div>
            <span className="status-pill status-watch">Read failed</span>
          </div>
          <div className="council-failure" role="alert">
            <strong>Council state was not loaded</strong>
            <p>{failure}</p>
            <p>
              This does not mean the council is empty or uninstalled. Reload
              after the runtime is healthy.
            </p>
          </div>
        </section>
      ) : (
        <>
          <section
            className="council-roster chart-panel"
            aria-labelledby="roster-heading"
          >
            <header className="section-heading">
              <div>
                <p className="eyebrow">Council roster</p>
                <h2 id="roster-heading">Role skills and assigned workers</h2>
              </div>
              <span className="status-pill status-good">
                {installedRoles.length || 5} roles
              </span>
            </header>
            <p className="council-roster-note">
              A role is a versioned skill. A worker may inherit that skill for
              this council without becoming the office or receiving its own
              authority.
            </p>
            <div className="compact-list council-role-list">
              {(installedRoles.length > 0
                ? installedRoles
                : EXECUTIVE_COUNCIL_ROLES.map((name) => ({
                    roleId: name,
                    workerId: "",
                    name,
                    version: 0,
                    status: "awaiting_proposal" as const,
                    proposal: null,
                    review: null,
                  }))
              ).map((role) => (
                <article key={role.roleId}>
                  <div>
                    <p className="eyebrow">
                      Role skill ·{" "}
                      {role.version > 0 ? `v${role.version}` : "not installed"}
                    </p>
                    <h3>{role.name}</h3>
                    <p>
                      {role.workerId
                        ? `Assigned worker ${shortUtilityId(role.workerId)}`
                        : "No worker assigned"}
                    </p>
                  </div>
                  <div className="right-meta">
                    <span
                      className={`status-pill ${roleStatusTone(role.status)}`}
                    >
                      {formatCouncilStatus(role.status)}
                    </span>
                    {role.workerId && <code>{role.workerId}</code>}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section
            className="council-controls checkpoint-panel"
            aria-live="polite"
          >
            <div className="checkpoint-heading">
              <div>
                <p className="eyebrow">Council protocol</p>
                <h2>{progressHeading(currentCouncil, failure)}</h2>
                <p className="checkpoint-summary">
                  Each advance performs one model call and writes one durable
                  advisory record. Reloading this page resumes from the next
                  unrecorded step.
                </p>
              </div>
              <span className="status-pill status-watch">
                {completed} / {required} records
              </span>
            </div>
            <progress
              aria-label="Council progress"
              max={required}
              value={completed}
            >
              {completed} of {required}
            </progress>
            {currentCouncil?.nextStep && (
              <p className="council-next-step">
                Next: {formatCouncilStatus(currentCouncil.nextStep.phase)} by{" "}
                {currentCouncil.nextStep.roleName}
              </p>
            )}
            {failure && (
              <div className="council-failure" role="alert">
                <strong>Council paused</strong>
                <p>{failure}</p>
                <p>
                  Completed recommendations and reviews remain visible. No
                  failed role is presented as agreement.
                </p>
              </div>
            )}
            <button
              className="primary-button council-convene-button"
              type="button"
              disabled={
                loading ||
                running ||
                !selectedWork ||
                currentCouncil?.phase === "complete" ||
                membershipKind !== "owner"
              }
              onClick={onConvene}
            >
              {loading ? "Loading council" : actionLabel}
            </button>
          </section>

          <CouncilResults council={currentCouncil} />

          <section className="council-owner-review checkpoint-panel">
            <div>
              <p className="eyebrow">Owner checkpoint</p>
              <h2>Human review remains separate</h2>
              <p className="checkpoint-summary">
                The council can recommend and synthesize. It cannot approve,
                publish, spend, execute, or grant capabilities.
              </p>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled
              title="Owner review is not yet available in this interface"
            >
              Review synthesis
            </button>
          </section>
        </>
      )}
    </section>
  );
}

function CouncilResults({ council }: { council?: ExecutiveCouncilState }) {
  const proposals = council?.roles.flatMap((role) =>
    role.proposal ? [{ role, record: role.proposal }] : [],
  );
  const reviews = council?.roles.flatMap((role) =>
    role.review ? [{ role, record: role.review }] : [],
  );
  return (
    <div className="council-results">
      <nav className="segmented-control" aria-label="Council result views">
        <button
          type="button"
          onClick={() => focusCouncilResult("council-recommendations")}
        >
          Recommendations
        </button>
        <button
          type="button"
          onClick={() => focusCouncilResult("council-cross-review")}
        >
          Cross-review
        </button>
        <button
          type="button"
          onClick={() => focusCouncilResult("council-synthesis")}
        >
          Synthesis
        </button>
      </nav>
      <ResultPanel
        id="council-recommendations"
        eyebrow="Phase 1"
        title="Recommendations"
        empty="No independent recommendation has been recorded."
        records={proposals}
      />
      <ResultPanel
        id="council-cross-review"
        eyebrow="Phase 2"
        title="Cross-review"
        empty="Cross-review begins only after all five recommendations exist."
        records={reviews}
        review
      />
      <section
        id="council-synthesis"
        className="council-result-panel chart-panel"
        tabIndex={-1}
      >
        <header className="section-heading">
          <div>
            <p className="eyebrow">Phase 3</p>
            <h2>Synthesis</h2>
          </div>
          {council?.synthesis && (
            <span className="status-pill status-watch">Advisory only</span>
          )}
        </header>
        {council?.synthesis ? (
          <CouncilRecordView
            roleName="Chief Executive Officer"
            record={council.synthesis}
          />
        ) : (
          <p className="council-empty-result">
            Synthesis is withheld until the backend records all required
            recommendations and cross-reviews.
          </p>
        )}
      </section>
    </div>
  );
}

function ResultPanel({
  id,
  eyebrow,
  title,
  empty,
  records,
  review = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  empty: string;
  records?: Array<{
    role: ExecutiveCouncilState["roles"][number];
    record: CouncilRecord;
  }>;
  review?: boolean;
}) {
  return (
    <section id={id} className="council-result-panel chart-panel" tabIndex={-1}>
      <header className="section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <span className="status-pill status-good">
          {records?.length ?? 0} / 5
        </span>
      </header>
      {records && records.length > 0 ? (
        <div className="quality-grid single-column">
          {records.map(({ role, record }) => (
            <CouncilRecordView
              key={record.id}
              roleName={role.name}
              record={record}
              review={review}
            />
          ))}
        </div>
      ) : (
        <p className="council-empty-result">{empty}</p>
      )}
    </section>
  );
}

function CouncilRecordView({
  roleName,
  record,
  review = false,
}: {
  roleName: string;
  record: CouncilRecord;
  review?: boolean;
}) {
  const dissent = review && explicitlyDissents(record);
  return (
    <article className="quality-item council-record">
      <header className="quality-head">
        <div>
          <p className="eyebrow">{roleName}</p>
          <h3>{record.summary}</h3>
        </div>
        {dissent && (
          <span className="status-pill status-watch">Dissent recorded</span>
        )}
      </header>
      <p>{record.recommendation.summary}</p>
      <div className="council-recommended-action">
        <p className="eyebrow">Recommended action</p>
        <strong>{record.recommendation.recommendedAction.title}</strong>
        <p>{record.recommendation.recommendedAction.description}</p>
      </div>
      <details>
        <summary>Alternatives, risks, and uncertainty</summary>
        <div className="council-analysis-details">
          <p>
            <strong>Confidence</strong>{" "}
            {Math.round(record.recommendation.confidence * 100)}%
          </p>
          {record.recommendation.alternatives.map((alternative) => (
            <article key={`${record.id}-${alternative.title}`}>
              <h4>{alternative.title}</h4>
              <p>{alternative.description}</p>
              <p>
                <strong>Expected outcome:</strong> {alternative.expectedOutcome}
              </p>
              {alternative.risks.length > 0 && (
                <ul>
                  {alternative.risks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
          {record.recommendation.uncertainties.length > 0 && (
            <div>
              <h4>Uncertainties</h4>
              <ul>
                {record.recommendation.uncertainties.map((uncertainty) => (
                  <li key={uncertainty}>{uncertainty}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
      <details>
        <summary>Provenance and record IDs</summary>
        <dl className="council-record-provenance">
          <div>
            <dt>Record</dt>
            <dd>{record.id}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{record.roleId}</dd>
          </div>
          <div>
            <dt>Worker</dt>
            <dd>{record.actorWorkerId}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{record.inputRecordIds.join(", ") || "None recorded"}</dd>
          </div>
          <div>
            <dt>Peer records</dt>
            <dd>{record.peerRecordIds.join(", ") || "None"}</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function explicitlyDissents(record: CouncilRecord): boolean {
  return /\b(disagree|disagrees|dissent|dissents|oppose|opposes|reject|rejects|conflict)\b/i.test(
    `${record.summary} ${record.recommendation.summary} ${record.recommendation.uncertainties.join(" ")}`,
  );
}

function focusCouncilResult(id: string) {
  const result = document.getElementById(id);
  result?.scrollIntoView({ behavior: "smooth", block: "start" });
  result?.focus({ preventScroll: true });
}

function progressHeading(
  council: ExecutiveCouncilState | undefined,
  failure: string | undefined,
): string {
  if (failure) return "Recorded progress is intact";
  if (!council) return "Ready to convene";
  if (council.phase === "complete") return "Council record is complete";
  if (council.phase === "review") return "Cross-review is underway";
  if (council.phase === "synthesis") return "Synthesis is underway";
  return "Independent recommendations are underway";
}

function roleStatusTone(status: string): string {
  if (status === "complete") return "status-good";
  return "status-watch";
}

function formatCouncilStatus(status: string): string {
  return status.replaceAll("_", " ");
}

function shortUtilityId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
