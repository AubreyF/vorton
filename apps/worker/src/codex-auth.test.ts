import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertCodexRuntimeStorageAccessible,
  prepareCodexRuntimeStorage,
} from "./codex-auth.js";

const roots: string[] = [];

function managedAuth(refreshToken: string): string {
  return JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      refresh_token: refreshToken,
      access_token: "synthetic",
      account_id: "synthetic-account",
    },
    last_refresh: "2026-08-29T00:00:00Z",
  });
}

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "vorton-codex-auth-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("Codex managed authentication storage", () => {
  it("seeds once and preserves the cache Codex refreshes in place", async () => {
    const directory = await root();
    const codexHome = join(directory, "codex");
    const workdir = join(directory, "work");
    const first = managedAuth("first-refresh");
    await prepareCodexRuntimeStorage({ codexHome, workdir, authSeed: first });

    await prepareCodexRuntimeStorage({
      codexHome,
      workdir,
      authSeed: managedAuth("stale-bootstrap-refresh"),
    });

    expect(await readFile(join(codexHome, "auth.json"), "utf8")).toBe(first);
    expect((await stat(codexHome)).mode & 0o777).toBe(0o700);
    expect((await stat(join(codexHome, "auth.json"))).mode & 0o777).toBe(0o600);
    expect(await readdir(codexHome)).toEqual(["auth.json"]);
  });

  it("publishes one complete cache under concurrent first starts", async () => {
    const directory = await root();
    const codexHome = join(directory, "codex");
    const workdir = join(directory, "work");
    const first = managedAuth("first-refresh");
    const second = managedAuth("second-refresh");

    await Promise.all([
      prepareCodexRuntimeStorage({ codexHome, workdir, authSeed: first }),
      prepareCodexRuntimeStorage({ codexHome, workdir, authSeed: second }),
    ]);

    expect([first, second]).toContain(
      await readFile(join(codexHome, "auth.json"), "utf8"),
    );
    expect(await readdir(codexHome)).toEqual(["auth.json"]);
  });

  it("fails closed when the runtime account cannot traverse a parent directory", async () => {
    if (process.getuid?.() === 0) return;
    const directory = await root();
    const storage = await prepareCodexRuntimeStorage({
      codexHome: join(directory, "codex"),
      workdir: join(directory, "work"),
      authSeed: managedAuth("first-refresh"),
    });

    await chmod(directory, 0o000);
    try {
      await expect(
        assertCodexRuntimeStorageAccessible(storage),
      ).rejects.toThrow("not accessible after dropping privileges");
    } finally {
      await chmod(directory, 0o700);
    }
  });

  it("requires managed ChatGPT auth when the cache is empty", async () => {
    const directory = await root();
    const codexHome = join(directory, "codex");
    const workdir = join(directory, "work");
    await expect(
      prepareCodexRuntimeStorage({ codexHome, workdir }),
    ).rejects.toThrow("VORTON_CODEX_AUTH_JSON is required");
    await expect(
      prepareCodexRuntimeStorage({
        codexHome,
        workdir,
        authSeed: JSON.stringify({ auth_mode: "apikey" }),
      }),
    ).rejects.toThrow("managed ChatGPT authentication");
    await expect(
      prepareCodexRuntimeStorage({
        codexHome,
        workdir,
        authSeed: JSON.stringify({
          auth_mode: "chatgpt",
          tokens: { refresh_token: "synthetic-refresh" },
        }),
      }),
    ).rejects.toThrow("managed ChatGPT authentication");
  });

  it("refuses a symlinked authentication cache", async () => {
    const directory = await root();
    const codexHome = join(directory, "codex");
    const workdir = join(directory, "work");
    await prepareCodexRuntimeStorage({
      codexHome,
      workdir,
      authSeed: managedAuth("first-refresh"),
    });
    const target = join(directory, "target.json");
    await writeFile(target, managedAuth("target-refresh"));
    await rm(join(codexHome, "auth.json"));
    await symlink(target, join(codexHome, "auth.json"));

    await expect(
      prepareCodexRuntimeStorage({ codexHome, workdir }),
    ).rejects.toThrow("regular file");
  });
});
