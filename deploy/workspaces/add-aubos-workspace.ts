import {
  applyWorkspaceAddition,
  buildWorkspaceAdditionPlan,
  readWorkspaceAdditionAuthority,
  readWorkspaceAdditionConfig,
  readWorkspaceAdditionSecrets,
  type WorkspaceAdditionConfig,
} from "./add-workspace.js";

export function readAubosWorkspaceAdditionConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceAdditionConfig {
  const config = readWorkspaceAdditionConfig(env);
  if (config.workspaceSlug !== "aubos") {
    throw new Error("VORTON_ADD_WORKSPACE_SLUG must be exactly aubos");
  }
  if (config.workspaceDisplayName !== "AubOS cloud") {
    throw new Error(
      "VORTON_ADD_WORKSPACE_DISPLAY_NAME must be exactly AubOS cloud",
    );
  }
  if (config.workspaceRealm !== "personal") {
    throw new Error("VORTON_ADD_WORKSPACE_REALM must be exactly personal");
  }
  return config;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "--plan" && command !== "--apply") {
    throw new Error("Use exactly one mode: --plan or --apply");
  }
  const config = readAubosWorkspaceAdditionConfig();
  if (command === "--plan") {
    console.log(JSON.stringify(buildWorkspaceAdditionPlan(config), null, 2));
    return;
  }
  const result = await applyWorkspaceAddition(
    config,
    readWorkspaceAdditionAuthority(),
    readWorkspaceAdditionSecrets(),
  );
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1]?.endsWith("deploy/workspaces/add-aubos-workspace.ts")) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "AubOS workspace addition failed",
    );
    process.exitCode = 1;
  });
}
