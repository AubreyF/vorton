import { describe, expect, it } from "vitest";
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "../src/adapters/command-runner.js";
import { SshExecutorReadinessProbe } from "../src/execution/remote-executor-readiness.js";
import type { SshWorkerPolicyVerifier } from "../src/security/ssh-worker-policy.js";

const report = {
  schemaVersion: 1 as const,
  hostId: "linux-control-1",
  repository: { owner: "freed-project", name: "freed", defaultBranch: "dev" },
  checkedAt: "2026-08-13T22:00:00.000Z",
  ready: true as const,
  repositoryRoot: "/srv/freed/repository",
  worktreeRoot: "/var/lib/vorton-factory/workspaces",
  handoffRoot: "/var/lib/vorton-factory/executor/handoffs",
  baseHead: "a".repeat(40),
  git: { executable: "/usr/bin/git", version: "git version 2.50.1" },
  node: {
    executable: "/opt/vorton-factory/node/bin/node",
    version: "v24.14.1",
  },
  helper: {
    path: "/srv/freed/repository/scripts/worktree-add.sh",
    sha256: "b".repeat(64),
  },
  preparer: {
    path: "/opt/vorton-factory/releases/test/prepare-symphony-workspace.js",
    sha256: "c".repeat(64),
  },
  completer: {
    path: "/opt/vorton-factory/releases/test/complete-symphony-workspace.js",
    sha256: "f".repeat(64),
  },
  completionReader: {
    path: "/opt/vorton-factory/releases/test/read-symphony-completion.js",
    sha256: "9".repeat(64),
  },
  adjudicator: {
    path: "/opt/vorton-factory/releases/test/adjudicate-symphony-completion.js",
    sha256: "8".repeat(64),
  },
  reviewer: {
    config: {
      path: "/etc/vorton-factory/reviewer-runtime.json",
      sha256: "7".repeat(64),
    },
    accountId: "codex-pro-1",
    codexExecutable: "/opt/vorton-factory/codex/bin/codex",
    codexHome: "/var/lib/vorton-factory-executor/reviewer/codex",
    model: "review-model",
    effort: "high" as const,
    quotaSampleIntervalMs: 30_000,
  },
};

const transport = {
  hostId: "linux-control-1",
  hostname: "linux-control-1.tailnet.example",
  user: "vorton-factory-executor",
  identityFile: "/etc/vorton-factory/ssh/worker_ed25519",
  knownHostsFile: "/etc/vorton-factory/ssh/known_hosts",
  configSha256: "d".repeat(64),
  sshExecutableSha256: "e".repeat(64),
};
const policy: SshWorkerPolicyVerifier = {
  verify: async (input) => ({ ...transport, hostId: input.hostId }),
};

class Runner implements CommandRunner {
  request?: CommandRequest;
  constructor(private readonly output: unknown = report) {}
  async run(request: CommandRequest): Promise<CommandResult> {
    this.request = request;
    return { stdout: `${JSON.stringify(this.output)}\n`, stderr: "" };
  }
}

function probe(runner: CommandRunner): SshExecutorReadinessProbe {
  return new SshExecutorReadinessProbe(
    runner,
    {
      sshExecutable: "/usr/bin/ssh",
      sshConfig: "/etc/vorton-factory/ssh/config",
      commandCwd: "/var/lib/vorton-factory/symphony",
      remoteNodeExecutable: "/opt/vorton-factory/node/bin/node",
      remoteProbeExecutable: "/opt/vorton-factory/releases/test/probe.js",
      remoteRuntimeConfig: "/etc/vorton-factory/worker-runtime.json",
      remoteReviewerRuntimeConfig: "/etc/vorton-factory/reviewer-runtime.json",
      remoteWorkspacePreparer: "/opt/vorton-factory/releases/test/preparer.js",
      remoteWorkspaceCompleter:
        "/opt/vorton-factory/releases/test/completer.js",
      remoteCompletionReader: "/opt/vorton-factory/releases/test/reader.js",
      remoteAdjudicator: "/opt/vorton-factory/releases/test/adjudicator.js",
      expectedUser: "vorton-factory-executor",
      expectedIdentityFile: "/etc/vorton-factory/ssh/worker_ed25519",
      expectedKnownHostsFile: "/etc/vorton-factory/ssh/known_hosts",
    },
    policy,
  );
}

describe("remote executor readiness", () => {
  it("runs one fixed probe through the selected Symphony SSH alias", async () => {
    const runner = new Runner();
    await expect(probe(runner).probe("linux-control-1")).resolves.toEqual({
      ...report,
      transport,
    });
    expect(runner.request).toMatchObject({
      executable: "/usr/bin/ssh",
      args: [
        "-F",
        "/etc/vorton-factory/ssh/config",
        "--",
        "linux-control-1",
        "/opt/vorton-factory/node/bin/node",
        "/opt/vorton-factory/releases/test/probe.js",
        "/etc/vorton-factory/worker-runtime.json",
        "/etc/vorton-factory/reviewer-runtime.json",
        "/opt/vorton-factory/releases/test/preparer.js",
        "/opt/vorton-factory/releases/test/completer.js",
        "/opt/vorton-factory/releases/test/reader.js",
        "/opt/vorton-factory/releases/test/adjudicator.js",
      ],
    });
  });

  it("rejects a report from another host", async () => {
    await expect(
      probe(new Runner({ ...report, hostId: "macos-executor-1" })).probe(
        "linux-control-1",
      ),
    ).rejects.toThrow("another host identity");
  });
});
