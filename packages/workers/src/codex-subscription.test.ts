import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  CodexSubscriptionAdapter,
  createCodexSubscriptionAdapterFromEnv,
  type CodexExecInvocation,
  type CodexExecResult,
  type CodexExecRunner,
  NodeCodexExecRunner,
} from "./codex-subscription.js";

const evidenceRecordId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
const request = {
  installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
  workId: "7fb46f09-3894-4c24-933c-77c7a403341c",
  workerId: "b5611dc4-07e4-4388-a7d0-ddf7bb452499",
  role: {
    roleId: "d37f356b-6297-4cd1-902d-c2755423a612",
    name: "Synthetic reviewer",
    version: 1,
    contentSha256: "a".repeat(64),
    skillMarkdown: "# Synthetic reviewer\n\nRecommend. Never execute.",
  },
  objective: "Assess the moonbase fixture",
  evidence: [
    {
      recordId: evidenceRecordId,
      summary: "Synthetic pressure reading",
      sourceUri: null,
      classification: "synthetic" as const,
    },
  ],
  background: false,
};

const recommendation = {
  summary: "Review the synthetic evidence.",
  evidenceRecordIds: [evidenceRecordId],
  alternatives: [
    {
      title: "Inspect",
      description: "Inspect the supplied fixture.",
      expectedOutcome: "A reviewable receipt exists.",
      risks: ["The fixture may be incomplete."],
    },
  ],
  recommendedAction: {
    title: "Inspect fixture",
    description: "Inspect only the supplied fixture.",
    capability: "executive.synthetic.check",
    mode: "diagnose" as const,
    externalEffect: false,
  },
  confidence: 0.8,
  uncertainties: ["No external sources were consulted."],
};

function adapter(
  runner: CodexExecRunner,
  codexHome = "/tmp/vorton-codex-home",
) {
  return new CodexSubscriptionAdapter({
    model: "gpt-test",
    reasoningEffort: "high",
    codexHome,
    codexPath: "/synthetic/bin/codex",
    cwd: process.cwd(),
    executionTimeoutMs: 60_000,
    runner,
  });
}

describe("CodexSubscriptionAdapter", () => {
  it("runs an ephemeral, read-only, tool-free structured invocation", async () => {
    let invocation: CodexExecInvocation | undefined;
    const runner: CodexExecRunner = {
      run: vi.fn(async (received) => {
        invocation = received;
        const schemaPath =
          received.args[received.args.indexOf("--output-schema") + 1];
        expect(schemaPath).toBeTruthy();
        const schema = JSON.parse(await readFile(schemaPath!, "utf8")) as {
          required: string[];
        };
        expect(schema.required).toContain("recommendedAction");
        return { outputText: JSON.stringify(recommendation) };
      }),
    };

    const job = await adapter(runner).submit(request);

    expect(invocation).toBeDefined();
    expect(invocation!.command).toBe("/synthetic/bin/codex");
    expect(invocation!.args.slice(0, 2)).toEqual(["exec", "-"]);
    expect(invocation!.args).toEqual(
      expect.arrayContaining([
        "--sandbox",
        "read-only",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        'approval_policy="never"',
        "model_reasoning_effort=high",
        "tools.web_search=false",
      ]),
    );
    for (const feature of [
      "shell_tool",
      "apps",
      "enable_mcp_apps",
      "plugins",
      "remote_plugin",
      "tool_suggest",
      "standalone_web_search",
      "web_search_request",
      "web_search_cached",
      "browser_use",
      "browser_use_external",
      "in_app_browser",
      "computer_use",
      "memories",
      "multi_agent",
      "multi_agent_v2",
      "unbounded_connection_retries",
    ]) {
      const index = invocation!.args.indexOf(feature);
      expect(invocation!.args[index - 1]).toBe("--disable");
    }
    expect(Object.keys(invocation!.env).sort()).toEqual(["CODEX_HOME", "PATH"]);
    expect(invocation!.env.CODEX_HOME).toBe("/tmp/vorton-codex-home");
    expect(invocation!.stdin).toContain(request.objective);
    expect(invocation!.stdin).toContain(evidenceRecordId);
    expect(job).toMatchObject({
      provider: "codex-subscription",
      model: "gpt-test",
      status: "completed",
      store: false,
      background: false,
      recommendation,
    });
  });

  it("rejects background and retrieval without running Codex", async () => {
    const runner = { run: vi.fn() } as unknown as CodexExecRunner;
    const provider = adapter(runner);

    await expect(
      provider.submit({ ...request, background: true }),
    ).rejects.toThrow("do not support background jobs");
    await expect(
      provider.retrieve({} as Parameters<typeof provider.retrieve>[0]),
    ).rejects.toThrow("cannot be retrieved");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("enforces the evidence ceiling before invoking the runner", async () => {
    const runner = { run: vi.fn() } as unknown as CodexExecRunner;
    const provider = new CodexSubscriptionAdapter({
      model: "gpt-test",
      reasoningEffort: "high",
      codexHome: "/tmp/vorton-codex-home",
      codexPath: "/synthetic/bin/codex",
      cwd: process.cwd(),
      executionTimeoutMs: 60_000,
      dataClassificationCeiling: "internal",
      runner,
    });

    await expect(
      provider.submit({
        ...request,
        evidence: [{ ...request.evidence[0]!, classification: "restricted" }],
      }),
    ).rejects.toThrow("exceeds the worker provider ceiling");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("rejects a restricted derived observation before invoking Codex", async () => {
    const runner = { run: vi.fn() } as unknown as CodexExecRunner;
    const provider = new CodexSubscriptionAdapter({
      model: "gpt-test",
      reasoningEffort: "high",
      codexHome: "/tmp/vorton-codex-home",
      codexPath: "/synthetic/bin/codex",
      cwd: process.cwd(),
      executionTimeoutMs: 60_000,
      dataClassificationCeiling: "internal",
      runner,
    });

    await expect(
      provider.submit({
        ...request,
        derivedContext: [
          {
            text: "Restricted derived observation",
            trust: "untrusted",
            derived: true,
            classification: "restricted",
            citations: [
              {
                sourceRevisionId: evidenceRecordId,
                sourceUri: "urn:vorton:synthetic",
                revisionHash: "b".repeat(64),
                locator: "fixture:restricted",
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow("exceeds the worker provider ceiling");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("rejects citations outside the supplied evidence", async () => {
    const runner: CodexExecRunner = {
      run: vi.fn(async () => ({
        outputText: JSON.stringify({
          ...recommendation,
          evidenceRecordIds: ["a037f814-3572-4dcb-8a56-f2968c22bdcf"],
        }),
      })),
    };

    const job = await adapter(runner).submit(request);
    expect(job).toMatchObject({
      status: "failed",
      error: expect.stringContaining("outside the authoritative request"),
    });
    expect(job.recommendation).toBeUndefined();
  });

  it("does not expose malformed model output through its error", async () => {
    const runner: CodexExecRunner = {
      run: vi.fn(async () => ({
        outputText: "private-output-that-must-not-escape",
      })),
    };

    const job = await adapter(runner).submit(request);
    expect(job).toMatchObject({
      status: "failed",
      error: "Codex CLI returned an invalid executive recommendation",
    });
    expect(job.recommendation).toBeUndefined();
    expect(job.error).not.toContain("private-output");
  });

  it("serializes invocations that share auth.json", async () => {
    let calls = 0;
    let active = 0;
    let maximumActive = 0;
    let releaseFirst = (): void => undefined;
    let markStarted = (): void => undefined;
    const firstStarted = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted;
    });
    const firstGate = new Promise<void>((resolveFirst) => {
      releaseFirst = resolveFirst;
    });
    const runner: CodexExecRunner = {
      async run() {
        calls += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (calls === 1) {
          markStarted();
          await firstGate;
        }
        active -= 1;
        return { outputText: JSON.stringify(recommendation) };
      },
    };
    const provider = adapter(runner, "/tmp/vorton-shared-codex-home");

    const first = provider.submit(request);
    await firstStarted;
    const second = provider.submit(request);
    await Promise.resolve();
    expect(calls).toBe(1);
    releaseFirst();
    await Promise.all([first, second]);

    expect(calls).toBe(2);
    expect(maximumActive).toBe(1);
  });

  it("bounds a hung runner and releases the serialized auth queue", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      let firstSignal: AbortSignal | undefined;
      let markStarted = (): void => undefined;
      const firstStarted = new Promise<void>((resolveStarted) => {
        markStarted = resolveStarted;
      });
      const runner: CodexExecRunner = {
        run: vi.fn(async (invocation) => {
          calls += 1;
          if (calls === 1) {
            firstSignal = invocation.signal;
            markStarted();
            return await new Promise<CodexExecResult>(() => undefined);
          }
          return { outputText: JSON.stringify(recommendation) };
        }),
      };
      const provider = adapter(runner, "/tmp/vorton-timeout-codex-home");

      const first = provider.submit(request);
      await firstStarted;
      const second = provider.submit(request);
      const firstRejection = expect(first).rejects.toThrow(
        "exceeded its execution timeout",
      );
      const secondRejection = expect(second).rejects.toThrow(
        "exceeded its execution timeout",
      );
      await vi.advanceTimersByTimeAsync(66_001);

      await firstRejection;
      await secondRejection;
      expect(firstSignal?.aborted).toBe(true);
      expect(calls).toBe(1);

      await expect(provider.submit(request)).resolves.toMatchObject({
        status: "completed",
      });
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates an aborted Codex process", async () => {
    const runner = new NodeCodexExecRunner();
    const controller = new AbortController();
    const running = runner.run({
      command: process.execPath,
      args: ["-e", "setInterval(() => undefined, 1000)"],
      stdin: "",
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      outputFile: "/tmp/vorton-output-that-must-not-exist",
      signal: controller.signal,
    });

    controller.abort();

    await expect(running).rejects.toThrow("exceeded its execution timeout");
  });

  it("reports a safe spawn error code when the Codex process cannot start", async () => {
    const runner = new NodeCodexExecRunner();
    const controller = new AbortController();

    await expect(
      runner.run({
        command: "/path/that/does/not/exist/codex",
        args: [],
        stdin: "",
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "" },
        outputFile: "/tmp/vorton-output-that-must-not-exist",
        signal: controller.signal,
      }),
    ).rejects.toThrow("Unable to start the Codex CLI (ENOENT)");
  });

  it("requires an explicit supported reasoning effort from configuration", () => {
    expect(
      () =>
        new CodexSubscriptionAdapter({
          model: "gpt-test",
          reasoningEffort: "extreme" as "high",
          codexHome: "/tmp/vorton-codex-home",
          executionTimeoutMs: 60_000,
        }),
    ).toThrow("reasoning effort must be one of");
    expect(() =>
      createCodexSubscriptionAdapterFromEnv({
        VORTON_CODEX_MODEL: "gpt-test",
        VORTON_CODEX_HOME: "/tmp/vorton-codex-home",
      }),
    ).toThrow("reasoning effort must be one of");
    expect(
      () =>
        new CodexSubscriptionAdapter({
          model: "gpt-test",
          reasoningEffort: "high",
          codexHome: "/tmp/vorton-codex-home",
          executionTimeoutMs: 59_999,
        }),
    ).toThrow("execution timeout must be an integer");
  });
});
