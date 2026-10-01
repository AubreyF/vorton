import path from "node:path";
import { omiWorkflow } from "../server/omi-workflow.mjs";
import { check } from "../server/store.mjs";

// The operator supplies the same storage root and workspace used by its host.
// No installation registry, native adapter, credential argument or model call.
try {
  const [command, ...args] = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    check(["--root", "--profile", "--day", "--mode", "--page", "--digest"].includes(args[i]) && args[i + 1] && !Object.hasOwn(options, args[i]), "Invalid Omi command arguments");
    options[args[i]] = args[i + 1];
  }
  const root = options["--root"], profile = options["--profile"];
  check(typeof root === "string" && path.isAbsolute(root), "An explicit absolute storage root is required");
  check(typeof profile === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(profile), "An explicit workspace is required");
  const workflow = omiWorkflow(root, [profile]), omi = workflow.service(profile);
  let result;
  if (command === "status") result = await omi.status(profile);
  else if (command === "index") result = { ready: await omi.index(profile), batchLimit: 250 };
  else if (command === "sync") result = await omi.sync(profile, { day: options["--day"], mode: options["--mode"] ?? "recent" });
  else if (command === "council-manifest") result = await workflow.manifest(profile, options["--day"]);
  else if (command === "council-read") {
    check(/^\d+$/.test(options["--page"] ?? "") && /^[a-f0-9]{64}$/.test(options["--digest"] ?? ""), "An exact page and evidence digest are required");
    result = await workflow.page(profile, options["--day"], Number(options["--page"]), options["--digest"]);
  } else throw Error("Invalid Omi command");
  // council-read emits private transcript material. Never send it to public logs.
  console.log(JSON.stringify(result));
} catch {
  console.error(JSON.stringify({ error: "omi_operation_failed", nextAction: "Check the explicit storage root, workspace Omi Admin status and command scope." }));
  process.exitCode = 1;
}
