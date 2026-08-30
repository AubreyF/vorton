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
