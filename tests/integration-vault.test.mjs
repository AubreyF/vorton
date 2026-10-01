import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir, symlink, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IntegrationVault } from "../server/integration-vault.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vorton-vault-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, vault: new IntegrationVault(root, ["First", "Second"]) };
}

test("encrypted records persist without plaintext credentials or transcripts and stay scoped", async t => {
  const { root, vault } = await fixture(t);
  assert.equal(await vault.run("First", "omi", tx => tx.get("credential")), null);
  assert.deepEqual(await readdir(root), []);
  const secret = "SYNTHETIC_SECRET_CANARY", speech = "SYNTHETIC_TRANSCRIPT_CANARY";
  await vault.run("First", "omi", tx => { tx.put("credential", { secret }); tx.put("conversation:1", { speech }); }, { create: true });
  assert.deepEqual(await new IntegrationVault(root, ["First"]).run("First", "omi", tx => tx.get("credential")), { secret });
  assert.equal(await vault.run("Second", "omi", tx => tx.get("credential")), null);
  assert.equal(await vault.run("First", "other", tx => tx.get("credential")), null);
  await assert.rejects(vault.run("../First", "omi", () => null), /Unknown installation/);
  for (const name of await readdir(vault.directory)) {
    const bytes = await readFile(path.join(vault.directory, name));
    assert.equal(bytes.includes(Buffer.from(secret)), false);
    assert.equal(bytes.includes(Buffer.from(speech)), false);
  }
});

test("failed multi-record transaction rolls back and a missing key never resets history", async t => {
  const { vault } = await fixture(t);
  await vault.run("First", "omi", tx => tx.put("state", { revision: 1 }), { create: true });
  await assert.rejects(vault.run("First", "omi", tx => { tx.put("state", { revision: 2 }); tx.put("extra", {}); throw Error("private failure"); }), /storage unavailable/);
  assert.deepEqual(await vault.run("First", "omi", tx => tx.get("state")), { revision: 1 });
  assert.equal(await vault.run("First", "omi", tx => tx.get("extra")), null);
  await rm(vault.keyFile);
  await assert.rejects(vault.run("First", "omi", tx => tx.get("state"), { create: true }), /Restore the original key/);
});

test("ciphertext substitution across workspaces fails authentication", async t => {
  const { vault } = await fixture(t);
  await vault.run("First", "omi", tx => tx.put("credential", { key: "synthetic" }), { create: true });
  const db = new DatabaseSync(vault.filename);
  db.exec("UPDATE records SET profile='Second'"); db.close();
  await assert.rejects(vault.run("Second", "omi", tx => tx.get("credential")), /storage unavailable/);
});

test("runtime symlink escape is rejected before writing", async t => {
  const { root, vault } = await fixture(t);
  const outside = path.join(root, "outside"); await mkdir(outside);
  await symlink(outside, path.join(root, ".runtime"));
  await assert.rejects(vault.run("First", "omi", tx => tx.put("state", {}), { create: true }), /symlink/);
  assert.deepEqual(await readdir(outside), []);
});
