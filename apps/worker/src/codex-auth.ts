import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  chown,
  link,
  lstat,
  mkdir,
  open,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";

interface ManagedChatGptAuth {
  auth_mode?: unknown;
  tokens?: {
    access_token?: unknown;
    account_id?: unknown;
    refresh_token?: unknown;
  } | null;
}

export interface CodexRuntimeStorage {
  authPath: string;
  codexHome: string;
  workdir: string;
}

/** Verify the prepared paths again after the process has dropped privileges. */
export async function assertCodexRuntimeStorageAccessible(
  storage: CodexRuntimeStorage,
): Promise<void> {
  try {
    await access(
      storage.codexHome,
      constants.R_OK | constants.W_OK | constants.X_OK,
    );
    await access(storage.authPath, constants.R_OK | constants.W_OK);
    await access(
      storage.workdir,
      constants.R_OK | constants.W_OK | constants.X_OK,
    );
  } catch {
    throw new Error(
      "Codex runtime storage is not accessible after dropping privileges",
    );
  }
}

function assertManagedChatGptAuth(value: string): void {
  let parsed: ManagedChatGptAuth;
  try {
    parsed = JSON.parse(value) as ManagedChatGptAuth;
  } catch {
    throw new Error("Codex authentication cache is not valid JSON");
  }
  if (
    parsed.auth_mode !== "chatgpt" ||
    !parsed.tokens ||
    typeof parsed.tokens.access_token !== "string" ||
    !parsed.tokens.access_token ||
    typeof parsed.tokens.account_id !== "string" ||
    !parsed.tokens.account_id ||
    typeof parsed.tokens.refresh_token !== "string" ||
    !parsed.tokens.refresh_token
  ) {
    throw new Error(
      "Codex authentication cache must contain managed ChatGPT authentication",
    );
  }
}

async function readWithoutFollowingSymlinks(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function ensureRegularPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const status = await lstat(path);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error("Codex runtime path must be a real directory");
  }
  await chmod(path, 0o700);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function seedAuthAtomically(
  codexHome: string,
  authPath: string,
  authSeed: string,
): Promise<void> {
  const temporaryPath = join(codexHome, `.auth-seed-${randomUUID()}.tmp`);
  const handle = await open(
    temporaryPath,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(authSeed, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  let published = false;
  try {
    try {
      await link(temporaryPath, authPath);
      published = true;
      await syncDirectory(codexHome);
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
    }
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    });
    if (published) await syncDirectory(codexHome);
  }
}

/**
 * Seeds managed ChatGPT auth once, then preserves Codex's refreshed cache.
 * The seed is never allowed to overwrite an existing cache.
 */
export async function prepareCodexRuntimeStorage(input: {
  codexHome: string;
  workdir: string;
  authSeed?: string;
  runtimeUid?: number;
  runtimeGid?: number;
}): Promise<CodexRuntimeStorage> {
  await ensureRegularPrivateDirectory(input.codexHome);
  await ensureRegularPrivateDirectory(input.workdir);
  const authPath = join(input.codexHome, "auth.json");

  try {
    const status = await lstat(authPath);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new Error("Codex authentication cache must be a regular file");
    }
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    if (!input.authSeed) {
      throw new Error(
        "VORTON_CODEX_AUTH_JSON is required when the persistent Codex cache is empty",
      );
    }
    assertManagedChatGptAuth(input.authSeed);
    await seedAuthAtomically(input.codexHome, authPath, input.authSeed);
  }

  assertManagedChatGptAuth(await readWithoutFollowingSymlinks(authPath));
  await chmod(authPath, 0o600);

  if (process.getuid?.() === 0) {
    const uid = input.runtimeUid ?? 1000;
    const gid = input.runtimeGid ?? 1000;
    await chown(input.codexHome, uid, gid);
    await chown(input.workdir, uid, gid);
    await chown(authPath, uid, gid);
  }

  return { authPath, codexHome: input.codexHome, workdir: input.workdir };
}

/** Drop the container's startup privileges after it fixes volume ownership. */
export function dropRuntimePrivileges(
  runtimeUid = 1000,
  runtimeGid = 1000,
): void {
  if (process.getuid?.() !== 0) return;
  process.setgroups?.([]);
  process.setgid?.(runtimeGid);
  process.setuid?.(runtimeUid);
  if (
    process.getuid?.() === 0 ||
    process.getgid?.() === 0 ||
    process.getgroups?.().includes(0)
  ) {
    throw new Error("Vorton worker failed to drop root privileges");
  }
}
