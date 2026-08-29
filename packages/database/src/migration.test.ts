import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../supabase/migrations/20260828000100_kernel.sql",
  import.meta.url,
);

describe("kernel migration contract", () => {
  it("enforces RLS on every kernel authority table", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const table of [
      "people",
      "workers",
      "worker_credentials",
      "roles",
      "work",
      "policies",
      "capability_grants",
      "records",
    ]) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("keeps records immutable and worker credentials short-lived", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain(
      "Records are append-only; append a superseding record instead",
    );
    expect(sql).toContain("expires_at <= issued_at + interval '15 minutes'");
    expect(sql).toContain("Roles never grant capabilities or authority");
    expect(sql).toContain(
      "grant execute on function public.worker_transition_work",
    );
    expect(sql).not.toContain(
      "grant select, update on public.work to aubos_worker",
    );
  });

  it("does not provision people from editable Auth metadata", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).not.toContain("raw_user_meta_data");
    expect(sql).toContain("revoke all on function public.provision_person");
  });
});
