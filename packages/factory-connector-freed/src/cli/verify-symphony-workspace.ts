import { ProcessCommandRunner } from "../adapters/command-runner.js";
import { loadWorkerRuntimeConfig } from "../config/worker-runtime.js";
import { loadAdmittedExecutorCustody } from "../integrations/symphony/executor-custody.js";

const configFile = process.argv[2];
if (configFile === undefined) {
  throw new Error("Provide the absolute worker runtime config path.");
}
const result = await loadAdmittedExecutorCustody({
  workspace: process.cwd(),
  runtime: await loadWorkerRuntimeConfig(configFile),
  runner: new ProcessCommandRunner(),
  stage: "before-run",
});
process.stdout.write(
  `${JSON.stringify({
    status: "prepared",
    branch: result.branch,
    head: result.head,
    claimId: result.manifest.binding.claimId,
    manifestDigest: result.pointer.manifestDigest,
  })}\n`,
);
