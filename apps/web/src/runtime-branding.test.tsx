import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RuntimeState, SignIn } from "./runtime.js";

describe("installation-branded runtime gates", () => {
  it("presents the configured installation before authentication", () => {
    const html = renderToStaticMarkup(
      <SignIn client={{} as SupabaseClient} installationName="FreedOS" />,
    );

    expect(html).toContain('data-installation-name="FreedOS"');
    expect(html).toContain("FreedOS / Control plane");
    expect(html).toContain("Sign in to FreedOS");
    expect(html).not.toContain("Vorton");
  });

  it("keeps pre-bootstrap runtime states inside the installation identity", () => {
    const html = renderToStaticMarkup(
      <RuntimeState
        installationName="FreedOS"
        title="Opening secure session"
        detail="Checking authentication."
      />,
    );

    expect(html).toContain('data-installation-name="FreedOS"');
    expect(html).toContain("FreedOS / Runtime");
    expect(html).not.toContain("Vorton");
  });

  it("renders an explicit recovery action for authenticated gate failures", () => {
    const html = renderToStaticMarkup(
      <RuntimeState
        installationName="FreedOS"
        title="Installation unavailable"
        detail="This account cannot enter FreedOS."
        actions={<button type="button">Sign out</button>}
      />,
    );

    expect(html).toContain("Sign out");
    expect(html).toContain('class="runtime-gate__actions"');
  });
});
