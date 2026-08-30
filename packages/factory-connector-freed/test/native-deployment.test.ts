import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

async function fixture(relative: string): Promise<string> {
  return await readFile(path.join(root, relative), "utf8");
}

describe("native Linux deployment", () => {
  it("builds one clean manifest-bound host release", async () => {
    const packageJson = await fixture("package.json");
    const cleaner = await fixture("scripts/clean-dist.mjs");
    const release = await fixture("src/deployment/release-manifest.ts");
    const builder = await fixture("src/cli/build-release-bundle.ts");
    const verifier = await fixture("src/cli/verify-release-install.ts");
    const installer = await fixture("src/deployment/linux-host-installer.ts");
    const installerCli = await fixture("src/cli/install-linux-host.ts");
    const readiness = await fixture("src/pilot/readiness.ts");

    expect(packageJson).toContain(
      '"build": "node scripts/clean-dist.mjs && tsc',
    );
    expect(packageJson).toContain('"release:bundle"');
    expect(packageJson).toContain('"release:verify-install"');
    expect(cleaner).toContain('path.basename(target) !== "dist"');
    expect(release).toContain('"--omit=dev"');
    expect(release).toContain('"--ignore-scripts"');
    expect(release).toContain("Release contains a symbolic link");
    expect(release).toContain("Release file differs from its manifest");
    expect(builder).toContain("buildReleaseBundle");
    expect(verifier).toContain("requiredUid: 0");
    expect(installer).toContain("verifyInstalledRelease");
    expect(installer).toContain("servicesEnabled: false");
    expect(installer).toContain("servicesStarted: false");
    expect(installerCli).toContain('value === "--plan" || value === "--apply"');
    expect(installerCli).not.toMatch(/\benable\b|\bstart\b/u);
    expect(readiness).toContain('check("runtime:release-manifest"');
    expect(readiness).toContain("verifyInstalledRelease");
  });
  it("runs one pinned Symphony coordinator without containers or Restate", async () => {
    const unit = await fixture(
      "deploy/systemd/vorton-factory-symphony.service",
    );
    expect(unit).toContain(
      "/opt/vorton-factory/symphony/298a877e/8001b52e3062495a16e520e4ceaf8f9de868c4d0/symphony",
    );
    expect(unit).toContain("/etc/vorton-factory/WORKFLOW.md");
    expect(unit).toContain("--port 7080");
    expect(unit).toContain("--logs-root /var/lib/vorton-factory/logs/symphony");
    expect(unit).toContain(
      "PATH=/opt/vorton-factory/beam/.elixir-install/installs/otp/28.5.0.5/bin",
    );
    expect(unit).not.toContain("/var/log/vorton-factory");
    expect(unit).toContain("Requires=vorton-factory-github-token.service");
    expect(unit).not.toMatch(/docker|compose|restate/iu);
  });

  it("ships a Freed workflow with fail-closed admission and helper-only workspaces", async () => {
    const workflow = await fixture("config/symphony/freed.WORKFLOW.md");
    expect(workflow).toContain("kind: github");
    expect(workflow).toContain('required_labels: [debt, "factory:ready"]');
    expect(workflow).toContain("max_concurrent_agents: 1");
    expect(workflow).toContain("symphony-prelaunch.js");
    expect(workflow).toContain("timeout_ms: 900000");
    expect(workflow).toContain("symphony-active-run-guard.js");
    expect(workflow).toContain("interrupt_grace_ms: 5000");
    expect(workflow).toContain("reject-unprepared-symphony-workspace.js");
    expect(workflow).toContain("verify-symphony-workspace.js");
    expect(workflow).toContain("complete-symphony-workspace.js");
    expect(workflow).toContain("linux-control-1");
    expect(workflow).toContain("macos-executor-1");
    expect(workflow).not.toMatch(/docker|compose|restate/iu);
  });

  it("prepares exact Freed worktrees over the existing Symphony SSH lane", async () => {
    const environment = await fixture("deploy/systemd/symphony.env.example");
    const runtime = JSON.parse(
      await fixture("config/hosts/worker-runtime.example.json"),
    ) as Record<string, unknown>;
    const macRuntime = JSON.parse(
      await fixture("config/hosts/worker-runtime.macos.example.json"),
    ) as Record<string, unknown>;
    const reviewerRuntime = JSON.parse(
      await fixture("config/hosts/reviewer-runtime.example.json"),
    ) as Record<string, unknown>;
    const macReviewerRuntime = JSON.parse(
      await fixture("config/hosts/reviewer-runtime.macos.example.json"),
    ) as Record<string, unknown>;
    const publisherRuntime = JSON.parse(
      await fixture("config/hosts/publisher-runtime.example.json"),
    ) as Record<string, unknown>;
    const macPublisherRuntime = JSON.parse(
      await fixture("config/hosts/publisher-runtime.macos.example.json"),
    ) as Record<string, unknown>;
    expect(environment).toContain("VORTON_FACTORY_SSH_EXECUTABLE=/usr/bin/ssh");
    expect(environment).toContain(
      "PATH=/opt/vorton-factory/beam/.elixir-install/installs/otp/28.5.0.5/bin",
    );
    expect(environment).toContain("prepare-symphony-workspace.js");
    expect(environment).toContain("complete-symphony-workspace.js");
    expect(environment).toContain("read-symphony-completion.js");
    expect(environment).toContain("adjudicate-symphony-completion.js");
    expect(environment).toContain(
      "VORTON_FACTORY_REMOTE_WORKER_RUNTIME_CONFIG=",
    );
    expect(environment).not.toContain(
      "VORTON_FACTORY_REMOTE_PUBLISHER_RUNTIME_CONFIG=",
    );
    expect(runtime).toMatchObject({
      hostId: "linux-control-1",
      repository: {
        owner: "freed-project",
        name: "freed",
        defaultBranch: "dev",
      },
      handoffRoot: "/var/lib/vorton-factory/executor/handoffs",
      worktreeHelper: "/srv/freed/repository/scripts/worktree-add.sh",
    });
    expect(macRuntime).toMatchObject({
      hostId: "macos-executor-1",
      repository: {
        owner: "freed-project",
        name: "freed",
        defaultBranch: "dev",
      },
      handoffRoot:
        "/Users/vorton-factory/Library/Application Support/Vorton Factory/executor/handoffs",
      worktreeHelper: "/Users/vorton-factory/freed/scripts/worktree-add.sh",
    });
    expect(reviewerRuntime).toMatchObject({
      hostId: "linux-control-1",
      accountId: "codex-pro-1",
      codexHome: "/var/lib/vorton-factory/executor/reviewer/codex",
      homeDirectory: "/var/lib/vorton-factory/executor/reviewer",
      quotaSampleIntervalMs: 30_000,
    });
    expect(macReviewerRuntime).toMatchObject({
      hostId: "macos-executor-1",
      accountId: "codex-pro-1",
      quotaSampleIntervalMs: 30_000,
    });
    expect(publisherRuntime).toMatchObject({
      hostId: "linux-control-1",
      nodeVersion: "v24.14.1",
      selectedRepositories: ["freed-project/freed"],
      worktreeRoots: ["/var/lib/vorton-factory/workspaces"],
    });
    expect(macPublisherRuntime).toMatchObject({
      hostId: "macos-executor-1",
      nodeVersion: "v24.14.1",
      selectedRepositories: ["freed-project/freed"],
      worktreeRoots: [
        "/Users/vorton-factory/Library/Application Support/Vorton Factory/workspaces",
      ],
    });
    expect(await fixture("package.json")).toContain(
      '"symphony:publish-draft-local"',
    );
    expect(await fixture("package.json")).toContain('"publisher:ssh-gateway"');
  });

  it("reconciles trusted completion downstream of Symphony without another scheduler", async () => {
    const service = await fixture(
      "deploy/systemd/vorton-factory-completion-reconciliation.service",
    );
    const timer = await fixture(
      "deploy/systemd/vorton-factory-completion-reconciliation.timer",
    );
    const environment = await fixture("deploy/systemd/symphony.env.example");
    const command = await fixture("src/cli/reconcile-symphony-completion.ts");
    const packageJson = await fixture("package.json");
    expect(service).toContain("User=vorton-factory-symphony");
    expect(service).toContain("dist/cli/reconcile-symphony-completion.js");
    expect(service).toContain(
      "ReadWritePaths=/var/lib/vorton-factory/admission",
    );
    expect(timer).toContain("OnUnitActiveSec=1min");
    expect(environment).toContain("VORTON_FACTORY_ACTIVE_TURN_ROOT=");
    expect(environment).toContain(
      "VORTON_FACTORY_COMPLETION_RECONCILIATION_ROOT=",
    );
    expect(environment).toContain("VORTON_FACTORY_VALIDATION_PROFILE_FILE=");
    expect(environment).toContain("VORTON_FACTORY_REMOTE_ADJUDICATOR=");
    expect(environment).toContain(
      "VORTON_FACTORY_REMOTE_REVIEWER_RUNTIME_CONFIG=",
    );
    expect(environment).toContain("VORTON_FACTORY_TRUSTED_ADJUDICATION_ROOT=");
    expect(environment).toContain(
      "VORTON_FACTORY_PUBLICATION_TRANSACTION_ROOT=",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_SSH_PUBLISHER_USER=vorton-factory-publisher",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_SSH_PUBLISHER_IDENTITY_FILE=/etc/vorton-factory/ssh/publisher_ed25519",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_GITHUB_MACHINE_AUTHOR_LOGIN=",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_LIFECYCLE_PROJECTION_ENABLED=false",
    );
    expect(command).toContain("SymphonyCompletionReconciler");
    expect(command).toContain("SshAdjudicationRunner");
    expect(command).toContain("TrustedAdjudicationResultStore");
    expect(command).toContain("DurablePublicationCoordinator");
    expect(command).toContain("PublicationTransactionStore");
    expect(command).toContain("SshDraftPublisher");
    expect(command).toContain("GitHubProjectionWriter");
    expect(command).toContain("BlockedHandoffCoordinator");
    expect(command).toContain("GitHubLivePlanningReader");
    expect(command).toContain("FreedAuthorityBridge");
    expect(packageJson).toContain('"symphony:adjudicate-completion"');
    expect(`${service}\n${timer}\n${command}`).not.toMatch(
      /docker|compose|restate/iu,
    );
  });

  it("ships a noninteractive pinned-host SSH worker profile", async () => {
    const config = await fixture("config/hosts/ssh_config.example");
    const linuxPublisherKey = await fixture(
      "config/hosts/publisher_authorized_keys.example",
    );
    const macPublisherKey = await fixture(
      "config/hosts/publisher_authorized_keys.macos.example",
    );
    const linuxSshd = await fixture(
      "deploy/sshd/vorton-factory-publisher.conf.example",
    );
    const macSshd = await fixture(
      "deploy/sshd/vorton-factory-publisher.macos.conf.example",
    );
    for (const required of [
      "Host linux-control-1 macos-executor-1",
      "User vorton-factory-executor",
      "IdentityFile /etc/vorton-factory/ssh/worker_ed25519",
      "UserKnownHostsFile /etc/vorton-factory/ssh/known_hosts",
      "GlobalKnownHostsFile /dev/null",
      "BatchMode yes",
      "StrictHostKeyChecking yes",
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "PreferredAuthentications publickey",
      "GSSAPIAuthentication no",
      "HostbasedAuthentication no",
      "ForwardAgent no",
      "ClearAllForwardings yes",
      "ControlMaster no",
      "UpdateHostKeys no",
    ]) {
      expect(config).toContain(required);
    }
    for (const authorizedKey of [linuxPublisherKey, macPublisherKey]) {
      expect(authorizedKey).toContain("restrict,command=");
      expect(authorizedKey).toContain("publisher-ssh-gateway.js");
      expect(authorizedKey).toContain("publish-draft-local.js");
      expect(authorizedKey).toContain("publisher_authorized_keys");
      expect(authorizedKey).toContain("ssh-ed25519");
      expect(authorizedKey).not.toMatch(/\b(?:bash|sh|zsh)\b/u);
    }
    expect(linuxPublisherKey).toContain(
      "/etc/vorton-factory/publisher-runtime.json",
    );
    expect(macPublisherKey).toContain(
      "'/Library/Application Support/Vorton Factory/publisher-runtime.json'",
    );
    for (const sshd of [linuxSshd, macSshd]) {
      expect(sshd).toContain("Match User vorton-factory-publisher");
      expect(sshd).toContain("AuthenticationMethods publickey");
      expect(sshd).toContain("ForceCommand");
      expect(sshd).toContain("publisher-ssh-gateway.js");
      expect(sshd).toContain("DisableForwarding yes");
      expect(sshd).toContain("PermitTTY no");
      expect(sshd).toContain("PasswordAuthentication no");
      expect(sshd).toContain("KbdInteractiveAuthentication no");
    }
    expect(config).toContain("HostKeyAlias linux-control-1");
    expect(config).toContain("HostKeyAlias macos-executor-1");
    for (const required of [
      "Host linux-control-1-publisher macos-executor-1-publisher",
      "User vorton-factory-publisher",
      "IdentityFile /etc/vorton-factory/ssh/publisher_ed25519",
      "HostKeyAlias linux-control-1-publisher",
      "HostKeyAlias macos-executor-1-publisher",
    ]) {
      expect(config).toContain(required);
    }
  });

  it("refreshes the coordinator token natively before expiry", async () => {
    const service = await fixture(
      "deploy/systemd/vorton-factory-github-token.service",
    );
    const timer = await fixture(
      "deploy/systemd/vorton-factory-github-token.timer",
    );
    expect(service).toContain("User=vorton-factory-symphony");
    expect(service).toContain("dist/cli/refresh-github-token.js");
    expect(service).toContain("UMask=0077");
    expect(service).toContain(
      "ReadWritePaths=/var/lib/vorton-factory/symphony/secrets",
    );
    expect(timer).toContain("OnUnitActiveSec=35min");
    expect(timer).toContain("RandomizedDelaySec=2min");
    expect(service).not.toMatch(/docker|compose|restate/iu);
  });

  it("runs a loopback-only signed host observation gateway", async () => {
    const service = await fixture(
      "deploy/systemd/vorton-factory-host-gateway.service",
    );
    const environment = await fixture(
      "deploy/systemd/host-gateway.env.example",
    );
    const symphony = await fixture(
      "deploy/systemd/vorton-factory-symphony.service",
    );
    expect(service).toContain("User=vorton-factory-symphony");
    expect(service).toContain("dist/host-gateway.js");
    expect(service).toContain("StateDirectory=vorton-factory/coordinator");
    expect(environment).toContain("VORTON_FACTORY_BIND_HOST=127.0.0.1");
    expect(environment).toContain("PORT=8090");
    expect(environment).toContain(
      "VORTON_FACTORY_HOST_OBSERVATION_JOURNAL_FILE=/var/lib/vorton-factory/coordinator/host-observations.json",
    );
    expect(symphony).toContain(
      "Requires=vorton-factory-github-token.service vorton-factory-host-gateway.service",
    );
    expect(`${service}\n${environment}`).not.toMatch(
      /docker|compose|restate/iu,
    );
    const hostAgent = await fixture("deploy/systemd/host-agent.env.example");
    expect(hostAgent).toContain(
      "VORTON_FACTORY_HOST_GATEWAY_URL=http://127.0.0.1:8090",
    );
    expect(hostAgent).toContain("VORTON_FACTORY_QUOTA_SAMPLE_SECONDS=60");
    expect(hostAgent).not.toMatch(
      /EXECUTION_JOURNAL|ADJUDICATION_JOURNAL|CHECKPOINT|WORKTREE/iu,
    );
    expect(hostAgent).not.toMatch(
      /replace-with-private-key|BEGIN PRIVATE KEY/iu,
    );
  });

  it("deploys telemetry without a second worker scheduler", async () => {
    const service = await fixture(
      "deploy/systemd/vorton-factory-host-agent.service",
    );
    const environment = await fixture("deploy/systemd/host-agent.env.example");
    const monitor = await fixture("src/host-monitor.ts");
    const launchd = await fixture(
      "deploy/launchd/vorton-factory.host-agent.plist",
    );
    expect(service).toContain("User=vorton-factory-symphony");
    expect(service).toContain("Group=vorton-factory-symphony");
    expect(service).toContain("dist/host-monitor.js");
    expect(service).not.toContain("dist/host-agent.js");
    expect(environment).toContain(
      "CODEX_HOME=/var/lib/vorton-factory/symphony/codex",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_HOST_SEQUENCE_FILE=/var/lib/vorton-factory/symphony/host-envelope.sequence",
    );
    expect(environment).not.toContain("/var/lib/vorton-factory/executor/codex");
    expect(launchd).toContain("dist/host-monitor.js");
    expect(monitor).toContain("CodexQuotaSource");
    expect(monitor).toContain("host-telemetry-sampled");
    expect(monitor).not.toMatch(
      /HostExecutionSupervisor|HostWorkspaceSupervisor|pollExecutor|worker\.start/iu,
    );
  });

  it("collects read-only planning evidence every minute without containers", async () => {
    const service = await fixture(
      "deploy/systemd/vorton-factory-planning-snapshot.service",
    );
    const timer = await fixture(
      "deploy/systemd/vorton-factory-planning-snapshot.timer",
    );
    const environment = await fixture("deploy/systemd/symphony.env.example");
    expect(service).toContain("User=vorton-factory-symphony");
    expect(service).toContain("dist/cli/collect-planning-snapshot.js");
    expect(service).toContain(
      "ReadOnlyPaths=/etc/vorton-factory /srv/freed /var/lib/freed/automation",
    );
    expect(service).toContain(
      "ReadWritePaths=/var/lib/vorton-factory/coordinator /var/lib/freed/automation/control/.guards/tasks.lock/kernel.lock /var/lib/freed/automation/control/.guards/events.lock/kernel.lock",
    );
    expect(service).toContain(
      "After=vorton-factory-github-token.service vorton-factory-host-gateway.service vorton-factory-freed-broker-conformance.service",
    );
    expect(timer).toContain("OnUnitActiveSec=1min");
    expect(environment).toContain(
      "VORTON_FACTORY_PLANNING_SNAPSHOT_FILE=/var/lib/vorton-factory/coordinator/planning-snapshot.json",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_DISPATCH_INTENTION_FILE=/var/lib/vorton-factory/coordinator/dispatch-intention.json",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_ACCOUNT_PROFILES_FILE=/etc/vorton-factory/account-profiles.json",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_HOST_WORKSPACE_ROOTS_FILE=/etc/vorton-factory/host-workspaces.json",
    );
    expect(environment).toContain("VORTON_FACTORY_PILOT_ISSUE_NUMBER=");
    expect(`${service}\n${timer}`).not.toMatch(/docker|compose|restate/iu);
  });

  it("heartbeats active claims and reconciles stale custody without containers", async () => {
    const symphony = await fixture(
      "deploy/systemd/vorton-factory-symphony.service",
    );
    const service = await fixture(
      "deploy/systemd/vorton-factory-claim-reconciliation.service",
    );
    const timer = await fixture(
      "deploy/systemd/vorton-factory-claim-reconciliation.timer",
    );
    const environment = await fixture("deploy/systemd/symphony.env.example");
    const activeGuard = await fixture("src/cli/symphony-active-run-guard.ts");
    expect(symphony).toContain(
      "dist/cli/reconcile-freed-claims.js --require-clear",
    );
    expect(symphony).toContain(
      "ReadWritePaths=/var/lib/vorton-factory/symphony /var/lib/vorton-factory/admission /var/lib/vorton-factory/logs/symphony /var/lib/freed/automation/control",
    );
    expect(service).toContain("User=vorton-factory-symphony");
    expect(service).toContain("dist/cli/reconcile-freed-claims.js");
    expect(service).toContain(
      "ReadWritePaths=/var/lib/vorton-factory/admission /var/lib/freed/automation/control",
    );
    expect(service).toContain("RestrictAddressFamilies=AF_UNIX");
    expect(timer).toContain("OnUnitActiveSec=1min");
    expect(environment).toContain(
      "VORTON_FACTORY_CLAIM_RECONCILIATION_FILE=/var/lib/vorton-factory/admission/claim-reconciliation.json",
    );
    expect(activeGuard).toContain("heartbeatSymphonyActiveClaim");
    expect(`${symphony}\n${service}\n${timer}`).not.toMatch(
      /docker|compose|restate/iu,
    );
  });

  it("ships a fail-closed native pilot readiness audit", async () => {
    const service = await fixture(
      "deploy/systemd/vorton-factory-pilot-readiness.service",
    );
    const environment = await fixture("deploy/systemd/symphony.env.example");
    const packageJson = await fixture("package.json");
    expect(service).toContain("Type=oneshot");
    expect(service).toContain("dist/cli/audit-pilot-readiness.js");
    expect(service).toContain("dist/cli/probe-executor-readiness.js");
    expect(service).toContain("dist/cli/probe-publisher-readiness.js");
    expect(service).toContain("dist/cli/collect-planning-snapshot.js");
    expect(
      service.indexOf("dist/cli/collect-planning-snapshot.js"),
    ).toBeLessThan(service.indexOf("dist/cli/audit-pilot-readiness.js"));
    expect(service).toContain(
      "Requires=vorton-factory-github-token.service vorton-factory-host-gateway.service vorton-factory-planning-snapshot.service",
    );
    expect(service).toContain(
      "ReadOnlyPaths=/etc/vorton-factory /opt/vorton-factory /opt/freed /srv/freed /var/lib/freed/automation",
    );
    expect(service).toContain(
      "ReadWritePaths=/var/lib/vorton-factory/coordinator /var/lib/freed/automation/control/.guards/tasks.lock/kernel.lock /var/lib/freed/automation/control/.guards/events.lock/kernel.lock",
    );
    expect(service).toContain(
      "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
    );
    expect(environment).toContain("VORTON_FACTORY_PILOT_READINESS_FILE=");
    expect(environment).toContain("VORTON_FACTORY_EXECUTOR_READINESS_FILE=");
    expect(environment).toContain("VORTON_FACTORY_PUBLISHER_READINESS_FILE=");
    expect(environment).toContain("VORTON_FACTORY_REMOTE_EXECUTOR_PROBE=");
    expect(environment).not.toContain("VORTON_FACTORY_REMOTE_PUBLISHER_PROBE=");
    expect(environment).toContain("VORTON_FACTORY_SYMPHONY_LOCK_FILE=");
    expect(environment).toContain("VORTON_FACTORY_SYMPHONY_EXECUTABLE=");
    expect(packageJson).toContain('"pilot:audit"');
    expect(packageJson).toContain('"pilot:probe-executor"');
    expect(packageJson).toContain('"pilot:probe-publisher"');
    expect(packageJson).toContain('"publisher:ssh-gateway"');
    expect(`${service}\n${environment}`).not.toMatch(
      /docker|compose|restate/iu,
    );
  });

  it("requires a disposable broker conformance proof before pilot readiness", async () => {
    const conformance = await fixture(
      "deploy/systemd/vorton-factory-freed-broker-conformance.service",
    );
    const readiness = await fixture(
      "deploy/systemd/vorton-factory-pilot-readiness.service",
    );
    const environment = await fixture("deploy/systemd/symphony.env.example");
    const packageJson = await fixture("package.json");
    expect(conformance).toContain("dist/cli/verify-freed-broker.js");
    expect(conformance).toContain(
      "/etc/vorton-factory/freed-broker-conformance.json",
    );
    expect(conformance).toContain(
      "BindReadOnlyPaths=/etc/freed/automation-actor-launchers-conformance:/etc/freed/automation-actor-launchers",
    );
    expect(conformance).toContain(
      "ReadWritePaths=/var/lib/vorton-factory/coordinator /var/lib/vorton-factory/conformance",
    );
    expect(readiness).toContain(
      "vorton-factory-freed-broker-conformance.service",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_FREED_BROKER_CONFORMANCE_FILE=/var/lib/vorton-factory/coordinator/freed-broker-conformance.json",
    );
    expect(packageJson).toContain('"freed:broker-conformance"');
    expect(conformance).not.toMatch(/docker|compose|restate/iu);
  });

  it("ships a native non-authoritative admission candidate publisher", async () => {
    const packageJson = await fixture("package.json");
    const publisher = await fixture("src/cli/publish-symphony-candidate.ts");
    expect(packageJson).toContain('"symphony:publish-candidate"');
    expect(packageJson).toContain('"symphony:reconcile-candidate"');
    expect(publisher).toContain("VORTON_FACTORY_PRELAUNCH_CANDIDATE_ROOT");
    expect(publisher).toContain("publishSymphonyAdmissionCandidateFile");
    expect(publisher).not.toContain("FreedAuthorityBridge");
    const reconciler = await fixture("src/cli/reconcile-symphony-candidate.ts");
    expect(reconciler).toContain("publishReconciledAdmissionCandidateFile");
    expect(reconciler).not.toContain("FreedAuthorityBridge");
  });

  it("ships a non-authoritative checkpoint-backed custody planner", async () => {
    const packageJson = await fixture("package.json");
    const planner = await fixture("src/cli/plan-custody-transfer.ts");
    const environment = await fixture("deploy/systemd/symphony.env.example");
    expect(packageJson).toContain('"custody:plan"');
    expect(planner).toContain("parseCustodyTransferPlanningInput");
    expect(planner).toContain("planCustodyTransfer");
    expect(planner).toContain("writeProtectedJsonFile");
    expect(environment).toContain("VORTON_FACTORY_CUSTODY_TRANSFER_PLAN_FILE=");
    expect(planner).not.toContain("claim-transfer");
  });

  it("keeps coordinator and checkpoint credentials under distinct users", async () => {
    const symphony = await fixture(
      "deploy/systemd/vorton-factory-symphony.service",
    );
    const checkpoint = await fixture(
      "deploy/systemd/vorton-factory-checkpoint-edge.service",
    );
    expect(symphony).toContain("User=vorton-factory-symphony");
    expect(checkpoint).toContain("User=vorton-factory-checkpoint");
    expect(symphony).not.toContain("CHECKPOINT_RECEIPT_PRIVATE_KEY");
    expect(checkpoint).not.toContain("GITHUB_APP_PRIVATE_KEY");
  });

  it("keeps mutable state outside the immutable release tree", async () => {
    const unit = await fixture(
      "deploy/systemd/vorton-factory-symphony.service",
    );
    expect(unit).toContain("WorkingDirectory=/var/lib/vorton-factory/symphony");
    expect(unit).toContain(
      "StateDirectory=vorton-factory/symphony vorton-factory/admission",
    );
    expect(unit).not.toContain("StateDirectory=vorton-factory/workspaces");
    expect(unit).not.toContain(
      "ReadWritePaths=/var/lib/vorton-factory/workspaces",
    );
    expect(unit).toContain("ReadOnlyPaths=/etc/vorton-factory");
    expect(unit).toContain("/var/lib/freed/automation/control");
    expect(unit).toContain("UMask=0077");
    expect(unit).not.toContain("ReadWritePaths=/opt/vorton-factory");
  });

  it("references GitHub App material by absolute host path", async () => {
    const environment = await fixture("deploy/systemd/symphony.env.example");
    expect(environment).toContain("VORTON_FACTORY_GITHUB_INSTALLATION_ID=");
    expect(environment).toContain("VORTON_FACTORY_GITHUB_APP_ID=");
    expect(environment).toContain(
      "VORTON_FACTORY_GITHUB_APP_PRIVATE_KEY_FILE=/etc/vorton-factory/keys/github-app-private.pem",
    );
    expect(environment).toContain(
      "GITHUB_TOKEN_FILE=/var/lib/vorton-factory/symphony/secrets/github.token",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_PRELAUNCH_CANDIDATE_ROOT=/var/lib/vorton-factory/admission/candidates",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_PRELAUNCH_ENVELOPE_ROOT=/var/lib/vorton-factory/admission/envelopes",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_PRELAUNCH_RECEIPT_ROOT=/var/lib/vorton-factory/admission/receipts",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_FREED_CLAIM_BROKER=/opt/freed/bin/factory-coordinator",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_FREED_REPOSITORY_ROOT=/srv/freed",
    );
    expect(environment).toContain(
      "VORTON_FACTORY_FREED_STATE_ROOT=/var/lib/freed/automation",
    );
    expect(environment).not.toMatch(/BEGIN (?:RSA |EC )?PRIVATE KEY/u);
  });

  it("keeps private checkpoint keys on the storage edge", async () => {
    const checkpoint = await fixture(
      "deploy/systemd/checkpoint-edge.env.example",
    );
    expect(checkpoint).toContain("CHECKPOINT_RECEIPT_PRIVATE_KEY_FILE");
    expect(checkpoint).toContain("CHECKPOINT_GRANT_PUBLIC_KEY_FILE");
    expect(checkpoint).not.toContain("CHECKPOINT_GRANT_PRIVATE_KEY_FILE");
  });
});
