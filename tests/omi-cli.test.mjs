import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const source = new URL("../publication/omi-cli.mjs", import.meta.url);
const script = fileURLToPath(existsSync(source) ? source : new URL("../scripts/omi.mjs", import.meta.url));
const run = args => JSON.parse(execFileSync(process.execPath, [script, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));

test("portable Omi CLI requires explicit root and workspace and rejects duplicate scope", () => {
  for (const args of [["status"], ["status", "--root", "relative", "--profile", "Example"], ["status", "--root", "/tmp", "--profile", "Example", "--profile", "Other"]]) {
    assert.throws(() => run(args), error => error.status === 1 && String(error.stderr).includes("omi_operation_failed"));
  }
});

test("portable Omi status inspects only the selected empty storage root without creating a vault", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omi-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const status = run(["status", "--root", root, "--profile", "Example"]);
  assert.equal(status.keyConfigured, false);
  assert.equal(status.historyCount, 0);
  assert.deepEqual(await readdir(root), []);
});
