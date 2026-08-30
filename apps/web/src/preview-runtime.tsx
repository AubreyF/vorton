import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { RuntimeProvider, type RuntimeContextValue } from "./runtime.js";

const previewRuntime: RuntimeContextValue = {
  session: {
    access_token: "synthetic-preview-token",
    refresh_token: "synthetic-preview-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-08-30T00:00:00.000Z",
      email: "owner@example.invalid",
    },
  } as Session,
  bootstrap: {
    installations: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        displayName: "FreedOS",
        personKind: "owner",
        workItems: [
          {
            id: "00000000-0000-4000-8000-000000000003",
            title: "Choose the next product decision",
            requestedOutcome:
              "Select one decision that creates the most useful evidence for Freed.",
            acceptanceCriteria: [
              "The recommendation cites current evidence.",
              "The owner makes the consequential decision.",
            ],
            state: "ready",
            priority: 86,
            parentWorkId: null,
            custodianName: "Executive advisor",
            custodianKind: "worker",
            updatedAt: "2026-08-30T01:02:03.000Z",
          },
          {
            id: "00000000-0000-4000-8000-000000000008",
            title: "Resolve the launch evidence gap",
            requestedOutcome:
              "Identify the missing owner evidence before launch authority is considered.",
            acceptanceCriteria: ["The blocker names the missing evidence."],
            state: "blocked",
            priority: 74,
            parentWorkId: null,
            custodianName: null,
            custodianKind: null,
            updatedAt: "2026-08-29T22:00:00.000Z",
          },
          {
            id: "00000000-0000-4000-8000-000000000009",
            title: "Record the initial installation boundary",
            requestedOutcome:
              "Preserve the founding authority boundary as durable evidence.",
            acceptanceCriteria: ["The record names its source and owner."],
            state: "completed",
            priority: 62,
            parentWorkId: null,
            custodianName: "Owner",
            custodianKind: "person",
            updatedAt: "2026-08-28T18:00:00.000Z",
          },
        ],
        proposalBindings: [
          {
            workId: "00000000-0000-4000-8000-000000000003",
            workTitle: "Choose the next product decision",
            workerId: "00000000-0000-4000-8000-000000000004",
            workerName: "Executive advisor",
            roleId: "00000000-0000-4000-8000-000000000005",
            roleName: "Strategic reviewer",
            evidence: [
              {
                id: "00000000-0000-4000-8000-000000000006",
                summary:
                  "The owner asked for one prioritized recommendation grounded in current product evidence.",
                classification: "synthetic",
              },
              {
                id: "00000000-0000-4000-8000-000000000007",
                summary:
                  "No external action may occur without a separate review and approval.",
                classification: "synthetic",
              },
            ],
          },
        ],
      },
    ],
  },
  signOut: async () => undefined,
  submitExecutive: async () => ({
    proposal: { id: "synthetic-preview-proposal" },
  }),
};

export function PreviewRuntime({ children }: { children: ReactNode }) {
  return <RuntimeProvider value={previewRuntime}>{children}</RuntimeProvider>;
}
