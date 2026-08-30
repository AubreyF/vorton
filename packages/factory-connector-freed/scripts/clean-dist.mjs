import { readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = await realpath(process.cwd());
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
if (packageJson.name !== "@vorton/factory-connector-freed") {
  throw new Error(
    "Refusing to clean dist outside the Vorton Factory repository.",
  );
}
const target = path.join(repositoryRoot, "dist");
if (
  path.dirname(target) !== repositoryRoot ||
  path.basename(target) !== "dist"
) {
  throw new Error("Vorton Factory dist target is invalid.");
}
await rm(target, { recursive: true, force: true });
