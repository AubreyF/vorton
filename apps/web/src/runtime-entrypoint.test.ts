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
  "40-vorton-runtime-config.sh",
);
const nginxTemplate = join(appRoot, "nginx.conf");

function createRuntimeTarget() {
  const root = mkdtempSync(join(tmpdir(), "vorton-web-runtime-"));
  const webRoot = join(root, "html");
  const nginxOutput = join(root, "nginx", "default.conf");
  mkdirSync(webRoot, { recursive: true });
  return { root, webRoot, nginxOutput };
}

function runtimeEnvironment(target: ReturnType<typeof createRuntimeTarget>) {
  return {
    ...process.env,
    VORTON_WEB_ROOT: target.webRoot,
    VORTON_NGINX_TEMPLATE: nginxTemplate,
    VORTON_NGINX_OUTPUT: target.nginxOutput,
    VORTON_PUBLIC_INSTALLATION_SLUG: "moonbase",
    VORTON_PUBLIC_INSTALLATION_NAME: "Moonbase OS",
    VORTON_PUBLIC_SUPABASE_URL: "https://moonbase.supabase.co/",
    VORTON_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic",
    VORTON_PUBLIC_API_URL: "https://api.example.test/",
  };
}

describe("web container runtime configuration", () => {
  it("writes public browser configuration and an exact-origin CSP at startup", () => {
    const target = createRuntimeTarget();
    execFileSync("/bin/sh", [entrypoint], {
      env: runtimeEnvironment(target),
    });

    const runtimeConfig = readFileSync(
      join(target.webRoot, "runtime-config.js"),
      "utf8",
    );
    expect(runtimeConfig).toContain('installationSlug: "moonbase"');
    expect(runtimeConfig).toContain(
      'const installationNameBase64 = "TW9vbmJhc2UgT1M="',
    );
    expect(runtimeConfig).toContain(
      'supabaseUrl: "https://moonbase.supabase.co"',
    );
    expect(runtimeConfig).toContain('apiUrl: "https://api.example.test"');
    expect(runtimeConfig).not.toContain("Moonbase OS");
    const nginxConfig = readFileSync(target.nginxOutput, "utf8");
    expect(nginxConfig).toContain(
      "connect-src 'self' https://moonbase.supabase.co https://api.example.test;",
    );
    expect(nginxConfig).toContain("frame-ancestors 'none'");
    expect(nginxConfig).toContain("add_header X-Frame-Options DENY always;");
    expect(nginxConfig).not.toContain("@@VORTON_");
  });

  it("fails closed before writing files when required configuration is absent", () => {
    const target = createRuntimeTarget();
    const { VORTON_PUBLIC_API_URL: _omittedApiUrl, ...env } =
      runtimeEnvironment(target);
    const result = spawnSync("/bin/sh", [entrypoint], {
      env,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("VORTON_PUBLIC_API_URL is required");
  });

  it("refuses secret Supabase keys before they can enter the public document root", () => {
    const target = createRuntimeTarget();
    const env = {
      ...runtimeEnvironment(target),
      VORTON_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_do-not-publish",
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

  it("rejects a newline-injected public key before writing executable configuration", () => {
    const target = createRuntimeTarget();
    const result = spawnSync("/bin/sh", [entrypoint], {
      env: {
        ...runtimeEnvironment(target),
        VORTON_PUBLIC_SUPABASE_ANON_KEY:
          'sb_publishable_synthetic\n"); globalThis.pwned = true; ({x:"',
      },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("contains an invalid character");
    expect(() =>
      readFileSync(join(target.webRoot, "runtime-config.js"), "utf8"),
    ).toThrow();
  });

  it("round-trips a schema-valid Unicode installation identity without executable interpolation", () => {
    const target = createRuntimeTarget();
    const name = "St. John’s Research, Inc.";
    const env = {
      ...runtimeEnvironment(target),
      VORTON_PUBLIC_INSTALLATION_NAME: name,
    };
    const result = spawnSync("/bin/sh", [entrypoint], {
      env,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(
      readFileSync(join(target.webRoot, "runtime-config.js"), "utf8"),
    ).toContain(
      `const installationNameBase64 = "${Buffer.from(name).toString("base64")}"`,
    );
  });

  it("rejects a newline-injected slug before writing public files", () => {
    const target = createRuntimeTarget();
    const result = spawnSync("/bin/sh", [entrypoint], {
      env: {
        ...runtimeEnvironment(target),
        VORTON_PUBLIC_INSTALLATION_SLUG:
          'freed\n"); globalThis.pwned = true; //',
      },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("may contain only");
    expect(() =>
      readFileSync(join(target.webRoot, "runtime-config.js"), "utf8"),
    ).toThrow();
  });

  it("renders installation identity repeatedly without mutating a public HTML template", () => {
    const target = createRuntimeTarget();
    const first = spawnSync("/bin/sh", [entrypoint], {
      env: runtimeEnvironment(target),
      encoding: "utf8",
    });
    const second = spawnSync("/bin/sh", [entrypoint], {
      env: {
        ...runtimeEnvironment(target),
        VORTON_PUBLIC_INSTALLATION_NAME: "Moonbase Research",
      },
      encoding: "utf8",
    });

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const runtimeConfig = readFileSync(
      join(target.webRoot, "runtime-config.js"),
      "utf8",
    );
    expect(runtimeConfig).toContain(
      `const installationNameBase64 = "${Buffer.from("Moonbase Research").toString("base64")}"`,
    );
    expect(() =>
      readFileSync(join(target.webRoot, "index.html.template"), "utf8"),
    ).toThrow();
  });

  it("refuses non-HTTPS and script-injectable URL values", () => {
    const invalidValues = [
      "http://api.example.test",
      'https://api.example.test\";alert(1)//',
      'https://api.example.test\n"); globalThis.pwned = true; //',
      "https://user:password@api.example.test",
      "https://api.example.test/path",
    ];

    for (const value of invalidValues) {
      const target = createRuntimeTarget();
      const env = {
        ...runtimeEnvironment(target),
        VORTON_PUBLIC_API_URL: value,
      };
      const result = spawnSync("/bin/sh", [entrypoint], {
        env,
        encoding: "utf8",
      });
      expect(result.status, value).not.toBe(0);
    }
  });
});
