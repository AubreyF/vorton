import { describe, expect, it } from "vitest";
import type {
  CommandRequest,
  CommandRunner,
} from "../src/adapters/command-runner.js";
import { SshPublisherReadinessProbe } from "../src/publication/remote-publisher-readiness.js";
import type { SshWorkerPolicyVerifier } from "../src/security/ssh-worker-policy.js";

const report = {
  schemaVersion: 1 as const,
  hostId: "macos-executor-1",
  checkedAt: "2026-08-14T13:00:00.000Z",
  ready: true as const,
  runtime: {
    path: "/etc/vorton-factory/publisher-runtime.json",
    sha256: "1".repeat(64),
  },
  authorizedKeys: {
    path: "/etc/vorton-factory/ssh/publisher_authorized_keys",
    sha256: "6".repeat(64),
  },
  gateway: {
    path: "/opt/vorton-factory/current/dist/cli/publisher-ssh-gateway.js",
    sha256: "5".repeat(64),
  },
  publisher: {
    path: "/opt/vorton-factory/current/dist/cli/publish-draft-local.js",
    sha256: "2".repeat(64),
  },
  git: { executable: "/usr/bin/git", version: "git version 2.50.1" },
  node: {
    executable: "/opt/vorton-factory/node/bin/node",
    version: "v24.14.1",
  },
  privateKey: {
    path: "/etc/vorton-factory/publisher/draft-publisher-private.pem",
    ownerUid: 502,
    mode: "0600" as const,
  },
  selectedRepositories: ["freed-project/freed"],
  worktreeRoots: [
    "/Users/vorton-factory/Library/Application Support/Vorton Factory/workspaces",
  ],
};

describe("remote publisher readiness", () => {
  it("uses only the dedicated publisher alias and identity", async () => {
    const calls: CommandRequest[] = [];
    const runner: CommandRunner = {
      run: async (request) => {
        calls.push(request);
        return { stdout: `${JSON.stringify(report)}\n`, stderr: "" };
      },
    };
    const policy: SshWorkerPolicyVerifier = {
      verify: async (input) => ({
        hostId: input.hostId,
        hostname: "macos-executor.tailnet.invalid",
        user: input.expectedUser,
        identityFile: input.expectedIdentityFile,
        knownHostsFile: input.expectedKnownHostsFile,
        configSha256: "3".repeat(64),
        sshExecutableSha256: "4".repeat(64),
      }),
    };
    const result = await new SshPublisherReadinessProbe(
      runner,
      {
        sshExecutable: "/usr/bin/ssh",
        sshConfig: "/etc/vorton-factory/ssh/config",
        commandCwd: "/var/lib/vorton-factory/symphony",
        expectedUser: "vorton-factory-publisher",
        expectedIdentityFile: "/etc/vorton-factory/ssh/publisher_ed25519",
        expectedKnownHostsFile: "/etc/vorton-factory/ssh/known_hosts",
      },
      policy,
    ).probe("macos-executor-1");
    expect(result.transport).toMatchObject({
      hostId: "macos-executor-1-publisher",
      user: "vorton-factory-publisher",
    });
    expect(calls[0]?.args).toContain("macos-executor-1-publisher");
    expect(calls[0]?.args.at(-1)).toBe("probe");
    expect(calls[0]?.args).not.toContain("macos-executor-1");
  });
});
