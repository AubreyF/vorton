import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const entrypoint = join(
  appRoot,
  "docker-entrypoint.d",
  "40-aubos-runtime-config.sh",
);
const nginxTemplate = join(appRoot, "nginx.conf");

function createRuntimeTarget() {
  const root = mkdtempSync(join(tmpdir(), "aubos-web-runtime-"));
  const webRoot = join(root, "html");
  const nginxOutput = join(root, "nginx", "default.conf");
  mkdirSync(webRoot, { recursive: true });
  return { root, webRoot, nginxOutput };
}

function runtimeEnvironment(target: ReturnType<typeof createRuntimeTarget>) {
  return {
    ...process.env,
    AUBOS_WEB_ROOT: target.webRoot,
    AUBOS_NGINX_TEMPLATE: nginxTemplate,
    AUBOS_NGINX_OUTPUT: target.nginxOutput,
    AUBOS_PUBLIC_SUPABASE_URL: "https://moonbase.supabase.co/",
    AUBOS_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic",
    AUBOS_PUBLIC_API_URL: "https://api.example.test/",
  };
}

describe("web container runtime configuration", () => {
  it("writes public browser configuration and an exact-origin CSP at startup", () => {
    const target = createRuntimeTarget();
    execFileSync("/bin/sh", [entrypoint], {
      env: runtimeEnvironment(target),
    });

    expect(readFileSync(join(target.webRoot, "runtime-config.js"), "utf8"))
      .toMatchInlineSnapshot(`
        "globalThis.__AUBOS_RUNTIME_CONFIG__ = Object.freeze({
          supabaseUrl: \"https://moonbase.supabase.co\",
          supabaseAnonKey: \"sb_publishable_synthetic\",
          apiUrl: \"https://api.example.test\"
        });
        "
      `);
    const nginxConfig = readFileSync(target.nginxOutput, "utf8");
    expect(nginxConfig).toContain(
      "connect-src 'self' https://moonbase.supabase.co https://api.example.test;",
    );
    expect(nginxConfig).toContain("frame-ancestors 'none'");
    expect(nginxConfig).toContain("add_header X-Frame-Options DENY always;");
    expect(nginxConfig).not.toContain("@@AUBOS_");
  });

  it("fails closed before writing files when required configuration is absent", () => {
    const target = createRuntimeTarget();
    const { AUBOS_PUBLIC_API_URL: _omittedApiUrl, ...env } =
      runtimeEnvironment(target);
    const result = spawnSync("/bin/sh", [entrypoint], {
      env,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("AUBOS_PUBLIC_API_URL is required");
  });

  it("refuses secret Supabase keys before they can enter the public document root", () => {
    const target = createRuntimeTarget();
    const env = {
      ...runtimeEnvironment(target),
      AUBOS_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_do-not-publish",
    };
    writeFileSync(join(target.webRoot, "sentinel"), "untouched");
    const result = spawnSync("/bin/sh", [entrypoint], {
      env,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must never contain a Supabase secret key");
    expect(() =>
      readFileSync(join(target.webRoot, "runtime-config.js"), "utf8"),
    ).toThrow();
  });

  it("refuses non-HTTPS and script-injectable URL values", () => {
    const invalidValues = [
      "http://api.example.test",
      'https://api.example.test\";alert(1)//',
      "https://user:password@api.example.test",
      "https://api.example.test/path",
    ];

    for (const value of invalidValues) {
      const target = createRuntimeTarget();
      const env = {
        ...runtimeEnvironment(target),
        AUBOS_PUBLIC_API_URL: value,
      };
      const result = spawnSync("/bin/sh", [entrypoint], {
        env,
        encoding: "utf8",
      });
      expect(result.status, value).not.toBe(0);
    }
  });
});
