import { useId, useMemo, useState } from "react";

export interface AgentPromptSpec {
  installationName: string;
  kind: string;
  id: string;
  title: string;
  state?: string;
  objective: string;
  closureEvidence: string;
  currentEvidence?: string;
  authorityBoundary: string;
  relatedRecords?: string[];
  sourceReference?: string;
}

function field(label: string, value?: string) {
  const normalized = value?.trim();
  return normalized ? `${label}: ${normalized}` : null;
}

export function buildAgentDialoguePrompt(spec: AgentPromptSpec) {
  const context = [
    field("Installation", spec.installationName),
    field("Item type", spec.kind),
    field("Item ID", spec.id),
    field("Title", spec.title),
    field("Current state", spec.state),
    field("Objective", spec.objective),
    field("Closure evidence", spec.closureEvidence),
    field("Current evidence", spec.currentEvidence),
    field("Related records", spec.relatedRecords?.filter(Boolean).join(", ")),
    field("Primary source", spec.sourceReference),
    field("Authority boundary", spec.authorityBoundary),
  ].filter(Boolean);

  return [
    `Work with me to close this governed ${spec.installationName} ${spec.kind}.`,
    "",
    ...context,
    "",
    "Start by inspecting the evidence available to you for this item. List every remaining closure gate. Separate confirmed facts, missing evidence, blocked dependencies, and choices only I can make.",
    "",
    "Work with me until each gate is closed with evidence, explicitly blocked, deliberately carried, replaced, or rejected. Ask focused questions when my judgment or private evidence is required. Complete safe, reversible work when it is already authorized. Do not outsource inspection or mechanical work back to me.",
    "",
    "When the item is genuinely closed, update its governed records, linked work, outcome evidence, and installation projection. Do not claim completion without direct evidence. Preserve history by superseding records instead of deleting them.",
    "",
    "Copying this prompt grants no source access, outreach, message, application, payment, financial action, legal action, source mutation, or other external authority. Ask for exact approval before any such action.",
  ].join("\n");
}

export function AgentPromptButton({
  spec,
  compact = false,
}: {
  spec: AgentPromptSpec;
  compact?: boolean;
}) {
  const statusId = useId();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "blocked">(
    "idle",
  );
  const prompt = useMemo(() => buildAgentDialoguePrompt(spec), [spec]);
  const status =
    copyState === "copied"
      ? "Agent prompt copied. No authority changed."
      : copyState === "blocked"
        ? "Clipboard access was blocked. Select the prompt below. No authority changed."
        : "";

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
    } catch {
      setCopyState("blocked");
    }
  }

  return (
    <div
      className={
        compact ? "agent-prompt-control compact" : "agent-prompt-control"
      }
    >
      <button
        className="agent-prompt-button"
        type="button"
        aria-label={`Copy agent prompt for ${spec.title}`}
        aria-describedby={statusId}
        onClick={() => void copyPrompt()}
      >
        Copy agent prompt
      </button>
      <span
        id={statusId}
        className="agent-prompt-status"
        role="status"
        aria-live="polite"
      >
        {status}
      </span>
      {copyState === "blocked" && (
        <textarea
          className="agent-prompt-fallback"
          aria-label={`Agent prompt for ${spec.title}`}
          readOnly
          rows={8}
          value={prompt}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}
