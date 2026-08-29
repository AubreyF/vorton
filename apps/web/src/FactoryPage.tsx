import type { FactorySnapshot } from "@aubos/factory";
import { Badge, SectionHeading, StatusDot } from "@aubos/ui";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  GitPullRequest,
} from "lucide-react";

export function FactoryPage({ snapshot }: { snapshot: FactorySnapshot }) {
  return (
    <>
      <SectionHeading
        eyebrow="Module / Factory"
        title="Software authority, reconciled."
        description="Factory is an AubOS module. This pilot observes GitHub and Freed's declared execution machinery without creating a second queue or changing either authority."
      />
      <section className="factory-boundary" aria-label="Connector boundary">
        <div>
          <Badge tone="blue">Read only</Badge>
          <strong>{snapshot.installation}</strong>
          <span>{snapshot.repository}</span>
        </div>
        <dl>
          <div>
            <dt>Ticket authority</dt>
            <dd>GitHub Issues</dd>
          </div>
          <div>
            <dt>Execution authority</dt>
            <dd>Freed claim, lease, recovery, and publication</dd>
          </div>
          <div>
            <dt>Connector authority</dt>
            <dd>Observe and reconcile only</dd>
          </div>
        </dl>
      </section>
      <div className="factory-ticket-stack">
        {snapshot.tickets.map((ticket) => {
          const pullRequest = ticket.pullRequest;
          const checks = pullRequest?.checks ?? [];
          const passed = checks.filter(
            (check) => check.state === "passed",
          ).length;
          const pending = checks.filter(
            (check) => check.state === "pending",
          ).length;
          const failed = checks.filter(
            (check) => check.state === "failed",
          ).length;
          return (
            <article className="factory-ticket" key={ticket.ticket.id}>
              <header>
                <div>
                  <span className="factory-ticket__identity">
                    {ticket.installationWorkId} / GitHub #{ticket.ticket.number}
                  </span>
                  <h2>{ticket.ticket.title}</h2>
                </div>
                <Badge
                  tone={
                    ticket.authorityState === "observed" ? "green" : "orange"
                  }
                >
                  {ticket.authorityState}
                </Badge>
              </header>

              {ticket.authorityState === "conflict" && (
                <div className="authority-alert" role="alert">
                  <AlertTriangle size={19} />
                  <div>
                    <strong>Conflicting claims. Authority is closed.</strong>
                    <p>
                      No worker was selected. Factory preserves every witness
                      for owner review and never chooses by timestamp.
                    </p>
                  </div>
                </div>
              )}
              {ticket.authorityState === "blocked" && (
                <div className="authority-alert" role="status">
                  <AlertTriangle size={19} />
                  <div>
                    <strong>Execution authority is unavailable.</strong>
                    <p>
                      The canonical Freed reader failed closed. Factory reports
                      the blocker and makes no claim, lease, or recovery change.
                    </p>
                  </div>
                </div>
              )}

              <div className="factory-facts">
                <Fact
                  label="Claimed worker"
                  value={ticket.claimedWorker ?? "None observed"}
                  detail={
                    ticket.claimWitnesses.length > 0
                      ? `${ticket.claimWitnesses.length} active witnesses`
                      : "Claim read failed closed"
                  }
                />
                <Fact
                  label="Lease / recovery"
                  value={`${ticket.lease.state} / ${ticket.lease.recovery}`}
                  detail={ticket.lease.detail}
                />
                <Fact
                  label="Branch"
                  value={pullRequest?.branch ?? "No branch observed"}
                  detail={
                    pullRequest ? `PR #${pullRequest.number}` : "No draft"
                  }
                />
              </div>

              {pullRequest && (
                <section className="factory-pr">
                  <div className="factory-pr__heading">
                    <GitPullRequest size={18} />
                    <div>
                      <span>
                        Pull request #{pullRequest.number} /{" "}
                        {pullRequest.draft ? "Draft" : "Ready"}
                      </span>
                      <strong>{pullRequest.title}</strong>
                    </div>
                  </div>
                  <div className="check-summary" aria-label="Check summary">
                    <span className="check-summary__passed">
                      <CheckCircle2 size={14} /> {passed} passed
                    </span>
                    <span>
                      <Clock3 size={14} /> {pending} pending
                    </span>
                    {failed > 0 && (
                      <span className="check-summary__failed">
                        <AlertTriangle size={14} /> {failed} failed
                      </span>
                    )}
                  </div>
                  <details className="factory-checks">
                    <summary>Inspect all {checks.length} checks</summary>
                    <ul>
                      {checks.map((check) => (
                        <li key={check.name}>
                          <span>{check.name}</span>
                          <strong>{check.state}</strong>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <div className="source-head">
                    <span>Exact source head</span>
                    <code>{pullRequest.sourceHead}</code>
                  </div>
                </section>
              )}

              <section className="factory-receipt">
                <div>
                  <p className="eyebrow">Reconciliation receipt</p>
                  <strong>{ticket.receipt.outcome}</strong>
                </div>
                <dl>
                  <div>
                    <dt>Ticket cursor</dt>
                    <dd>{ticket.receipt.cursor.ticketRevision}</dd>
                  </div>
                  <div>
                    <dt>Execution cursor</dt>
                    <dd>{ticket.receipt.cursor.executionRevision}</dd>
                  </div>
                  <div>
                    <dt>Observed</dt>
                    <dd>{ticket.receipt.cursor.observedAt}</dd>
                  </div>
                </dl>
              </section>

              <footer className="factory-blockers">
                <strong>Blockers</strong>
                <ul>
                  {ticket.blockers.map((blocker) => (
                    <li key={blocker}>{blocker.replaceAll("_", " ")}</li>
                  ))}
                </ul>
                <a href={ticket.ticket.url} target="_blank" rel="noreferrer">
                  Open canonical ticket
                </a>
              </footer>
            </article>
          );
        })}
      </div>
      <p className="factory-observation-note">
        <StatusDot tone="idle" /> Deterministic read-only fixture observed{" "}
        {snapshot.observedAt}. No provider traffic occurs from this view.
      </p>
    </>
  );
}

function Fact({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
