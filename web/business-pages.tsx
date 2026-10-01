import { useState, type FormEvent, type ReactNode } from "react";
import type {
  State,
  Opportunity,
  OpportunityFields,
  LedgerEntry,
  LedgerFields,
  FinancePlan,
  TaskFields,
} from "./types";
import { emptyPlan, financeSummary, money } from "./finance-model";
import "./business-pages.css";
import { AdminSave } from "./admin-save";

type Actions = {
  state: State;
  busy: boolean;
  error: string;
  act: (action: string, payload: unknown) => Promise<boolean | undefined>;
};
const str = (data: FormData, name: string) => String(data.get(name) ?? "");
const cents = (data: FormData, name: string) =>
  Math.round(Number(data.get(name)) * 100);
function Field({
  label,
  name,
  value = "",
  type = "text",
  required = false,
  maxLength = 180,
  min,
  step,
  max,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  maxLength?: number;
  min?: number;
  step?: string;
  max?: number;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
        autoFocus={name === "title"}
      />
    </label>
  );
}
function EditForm({
  title,
  busy,
  error,
  onSave,
  onCancel,
  children,
  admin = false,
}: {
  title: string;
  busy: boolean;
  error: string;
  onSave: (data: FormData) => Promise<void>;
  onCancel?: () => void;
  children: ReactNode;
  admin?: boolean;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave(new FormData(event.currentTarget));
  }
  return (
    <form
      className="panel business-editor"
      onSubmit={submit}
      aria-label={title}
    >
      <h2>{title}</h2>
      <fieldset disabled={busy}>
        {children}
        {admin ? <AdminSave busy={busy}/> : <div className="business-actions">
          <button type="submit" className="primary">
            {busy ? "Saving…" : "Save"}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>}
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function Opportunities({
  state,
  busy,
  error,
  act,
  draftTask,
}: Actions & { draftTask: (draft: TaskFields) => void }) {
  const [editing, setEditing] = useState<Opportunity | null | undefined>();
  const [filter, setFilter] = useState("open");
  const rows = state.opportunities ?? [];
  const open = rows.filter((row) => !["won", "lost"].includes(row.status));
  const shown = rows.filter(
    (row) =>
      filter === "all" ||
      (filter === "open"
        ? !["won", "lost"].includes(row.status)
        : row.status === filter),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Opportunities</h1>
          <p>Promising arrivals. No revenue until someone actually pays.</p>
        </div>
        <button className="primary" onClick={() => setEditing(null)}>
          New opportunity
        </button>
      </div>
      <div className="business-metrics">
        <div>
          <strong>{open.length}</strong>
          <span>Open opportunities</span>
        </div>
        <div>
          <strong>
            {money(open.reduce((sum, row) => sum + row.valueCents, 0))}
          </strong>
          <span>Unweighted pipeline estimate · USD</span>
        </div>
      </div>
      {editing !== undefined && (
        <EditForm
          key={editing?.id ?? "new"}
          title={editing ? "Edit opportunity" : "New opportunity"}
          busy={busy}
          error={error}
          onCancel={() => setEditing(undefined)}
          onSave={async (data) => {
            const fields: OpportunityFields = {
              title: str(data, "title"),
              owner: str(data, "owner"),
              contact: str(data, "contact"),
              kind: str(data, "kind") as OpportunityFields["kind"],
              status: str(data, "status") as OpportunityFields["status"],
              valueCents: cents(data, "value"),
              nextAction: str(data, "nextAction"),
              followUpOn: str(data, "followUpOn"),
              notes: str(data, "notes"),
              goalId: str(data, "goalId"),
            };
            if (
              await act(`opportunity.${editing ? "update" : "create"}`, {
                id: editing?.id,
                fields,
              })
            )
              setEditing(undefined);
          }}
        >
          <Field label="Title" name="title" value={editing?.title} required />
          <div className="business-fields">
            <Field
              label="Owner"
              name="owner"
              value={editing?.owner ?? state.settings?.defaultOwner ?? "Owner"}
              required
              maxLength={120}
            />
            <Field
              label="Contact"
              name="contact"
              value={editing?.contact}
              maxLength={160}
            />
            <label>
              Kind
              <select name="kind" defaultValue={editing?.kind ?? "booking"}>
                {["booking", "event", "partnership"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Stage
              <select name="status" defaultValue={editing?.status ?? "new"}>
                {["new", "qualified", "proposed", "won", "lost"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <Field
              label="Estimated value (USD)"
              name="value"
              type="number"
              min={0}
              max={100000000}
              step="0.01"
              value={(editing?.valueCents ?? 0) / 100}
              required
            />
            <Field
              label="Follow-up date"
              name="followUpOn"
              type="date"
              value={editing?.followUpOn}
            />
          </div>
          <Field
            label="Next action"
            name="nextAction"
            value={editing?.nextAction}
            maxLength={500}
          />
          <label>
            Linked goal
            <select name="goalId" defaultValue={editing?.goalId ?? ""}>
              <option value="">No linked goal</option>
              {state.goals.map((goal) => (
                <option value={goal.id} key={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <textarea
              name="notes"
              defaultValue={editing?.notes}
              maxLength={4000}
            />
          </label>
        </EditForm>
      )}
      <label className="business-filter">
        Show opportunities
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          {["open", "new", "qualified", "proposed", "won", "lost", "all"].map(
            (x) => (
              <option key={x}>{x}</option>
            ),
          )}
        </select>
      </label>
      <div className="business-cards">
        {shown.map((row) => (
          <article className="panel" key={row.id} id={`opportunity-${row.id}`}>
            <div className="business-actions">
              <span className="badge">{row.status}</span>
              <span className="quiet">{row.kind}</span>
            </div>
            <h2>{row.title}</h2>
            <p>
              {row.contact || "No contact recorded"} · {row.owner}
            </p>
            <p>
              <strong>{money(row.valueCents)}</strong> estimated value
            </p>
            {row.nextAction && (
              <p>
                <strong>Next:</strong> {row.nextAction}
              </p>
            )}
            {row.followUpOn && (
              <p>
                Follow up{" "}
                <time dateTime={row.followUpOn}>{row.followUpOn}</time>
              </p>
            )}
            {row.notes && <p>{row.notes}</p>}
            <div className="business-actions">
              <button onClick={() => setEditing(row)}>Edit opportunity</button>
              {row.nextAction && (
                <button
                  onClick={() =>
                    draftTask({
                      title: row.nextAction.slice(0, 180),
                      notes: `Opportunity: ${row.title}\n${row.nextAction}\n${row.notes}`,
                      owner: row.owner,
                      goalId: row.goalId,
                      dueOn: row.followUpOn,
                      priority: "normal",
                      status: "todo",
                    })
                  }
                >
                  Draft next task
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!shown.length && <p>No opportunities in this view.</p>}
    </>
  );
}

export function Finance({ state, busy, error, act }: Actions) {
  const [editing, setEditing] = useState<LedgerEntry | null | undefined>();
  const [notice, setNotice] = useState("");
  const plan = state.financePlan ?? emptyPlan,
    entries = state.ledger ?? [],
    summary = financeSummary(plan, entries);
  const fields: [keyof FinancePlan, string, number, number, boolean][] = [
    ["openingCashCents", "Opening cash (USD)", 0, 100000000, true],
    ["rooms", "Sellable rooms", 1, 500, false],
    ["days", "Days in forecast period", 1, 31, false],
    ["occupancy", "Occupancy (%)", 0, 100, false],
    ["rateCents", "Rate per occupied room-night (USD)", 0, 1000000, true],
    ["variableCents", "Cost per occupied room-night (USD)", 0, 1000000, true],
    ["fixedCents", "Fixed costs per period (USD)", 0, 100000000, true],
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Finance</h1>
          <p>Finite money. Infinite opinions about the minibar.</p>
        </div>
        <button className="primary" onClick={() => setEditing(null)}>
          New entry
        </button>
      </div>
      <section aria-label="Recorded cash" className="business-metrics">
        <div>
          <strong>{money(summary.cash)}</strong>
          <span>Opening cash + all recorded income − expenses</span>
        </div>
        <div>
          <strong>{money(summary.income)}</strong>
          <span>Recorded income · USD</span>
        </div>
        <div>
          <strong>{money(summary.expenses)}</strong>
          <span>Recorded expenses · USD</span>
        </div>
      </section>
      {editing !== undefined && (
        <EditForm
          key={editing?.id ?? "new-entry"}
          title={editing ? "Edit ledger entry" : "New ledger entry"}
          busy={busy}
          error={error}
          onCancel={() => setEditing(undefined)}
          onSave={async (data) => {
            const fields: LedgerFields = {
              title: str(data, "title"),
              kind: str(data, "kind") as LedgerFields["kind"],
              amountCents: cents(data, "amount"),
              date: str(data, "date"),
              category: str(data, "category"),
              notes: str(data, "notes"),
            };
            if (
              await act(`entry.${editing ? "update" : "create"}`, {
                id: editing?.id,
                fields,
              })
            )
              setEditing(undefined);
          }}
        >
          <Field label="Title" name="title" value={editing?.title} required />
          <div className="business-fields">
            <label>
              Entry kind
              <select name="kind" defaultValue={editing?.kind ?? "expense"}>
                <option>expense</option>
                <option>income</option>
              </select>
            </label>
            <Field
              label="Amount (USD)"
              name="amount"
              value={(editing?.amountCents ?? 0) / 100}
              type="number"
              min={0.01}
              max={100000000}
              step="0.01"
              required
            />
            <Field
              label="Date"
              name="date"
              type="date"
              value={editing?.date}
              required
            />
            <Field
              label="Category"
              name="category"
              value={editing?.category}
              required
              maxLength={120}
            />
          </div>
          <label>
            Notes
            <textarea
              name="notes"
              defaultValue={editing?.notes}
              maxLength={4000}
            />
          </label>
        </EditForm>
      )}
      <section className="panel">
        <h2>Ledger</h2>
        <p className="quiet">
          All entries in USD. Edits retain history in the export. Pipeline
          estimates are excluded.
        </p>
        {entries.length ? (
          <div className="business-table" tabIndex={0} role="region" aria-label="Ledger entries, scroll for all columns">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Record</th>
                  <th>Kind</th>
                  <th>Amount</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {entries
                  .slice()
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.date}</td>
                      <td>
                        <strong>{entry.title}</strong>
                        <br />
                        {entry.category}
                      </td>
                      <td>{entry.kind}</td>
                      <td>{money(entry.amountCents)}</td>
                      <td>
                        <button
                          aria-label={`Edit ${entry.title}`}
                          onClick={() => setEditing(entry)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No entries recorded.</p>
        )}
      </section>
      <div className="business-columns">
        <EditForm
          title="Forecast assumptions"
          busy={busy}
          error={error}
          onSave={async (data) => {
            const next = Object.fromEntries(
              fields.map(([name, , , , isMoney]) => [
                name,
                isMoney ? cents(data, name) : Number(data.get(name)),
              ]),
            ) as FinancePlan;
            if (await act("finance.plan.update", next))
              setNotice("Forecast assumptions saved.");
          }}
        >
          {fields.map(([name, label, min, max, isMoney]) => (
            <Field
              key={name}
              name={name}
              label={label}
              value={isMoney ? plan[name] / 100 : plan[name]}
              type="number"
              min={min}
              max={max}
              step={isMoney ? "0.01" : "1"}
              required
            />
          ))}
          <p role="status">{notice}</p>
        </EditForm>
        <section className="panel" aria-label="Saved forecast">
          <h2>Saved forecast</h2>
          {!state.financePlan && (
            <p>Save your assumptions to establish a forecast.</p>
          )}
          <p className="quiet">
            Uses saved assumptions for a {plan.days}-day period. This is a
            scenario, not recorded income.
          </p>
          <dl className="facts">
            <dt>Occupied room-nights</dt>
            <dd>{summary.nights.toFixed(1)}</dd>
            <dt>Revenue</dt>
            <dd>{money(summary.revenue)}</dd>
            <dt>Variable costs</dt>
            <dd>{money(summary.variable)}</dd>
            <dt>Fixed costs</dt>
            <dd>{money(plan.fixedCents)}</dd>
            <dt>Net per period</dt>
            <dd>{money(summary.net)}</dd>
            <dt>Contribution per room-night</dt>
            <dd>{money(plan.rateCents - plan.variableCents)}</dd>
            <dt>Break-even occupancy</dt>
            <dd>
              {summary.breakEven === null
                ? "Not achievable at this room contribution"
                : summary.breakEven > 100
                  ? `${summary.breakEven.toFixed(1)}% · above capacity`
                  : `${summary.breakEven.toFixed(1)}%`}
            </dd>
            <dt>Cash runway</dt>
            <dd>
              {summary.runway === null
                ? "No cash burn in this scenario"
                : `${summary.runway.toFixed(1)} forecast periods`}
            </dd>
          </dl>
          <details>
            <summary>Calculation assumptions</summary>
            <p>
              Room-nights = rooms × days × occupancy. Net = room revenue −
              variable costs − fixed costs. Runway = current recorded cash ÷
              forecast loss per period. No taxes, debt payments, payment delays,
              or seasonal changes are modeled unless included in your costs.
              Opening cash should precede the ledger entries to avoid double
              counting.
            </p>
          </details>
        </section>
      </div>
    </>
  );
}

export function WorkspacePreferences({ state, busy, error, act }: Actions) {
  const [notice, setNotice] = useState("");
  return (
    <EditForm
      title="Workspace settings"
      admin
      busy={busy}
      error={error}
      onSave={async (data) => {
        if (
          await act("settings.update", {
            defaultOwner: str(data, "defaultOwner"),
            purpose: str(data, "purpose"),
          })
        )
          setNotice("Workspace settings saved.");
      }}
    >
      <Field
        label="Default task and opportunity owner"
        name="defaultOwner"
        value={state.settings?.defaultOwner ?? "Owner"}
        required
        maxLength={120}
      />
      <label htmlFor="workspace-purpose">Workspace purpose</label>
        <textarea
          id="workspace-purpose"
          name="purpose"
          defaultValue={state.settings?.purpose ?? ""}
          maxLength={1000}
        />
      <p className="quiet">
        Purpose appears on Organization. Appearance and zoom are shared across
        workspaces in the upper-left menu.
      </p>
      <p role="status">{notice}</p>
    </EditForm>
  );
}
