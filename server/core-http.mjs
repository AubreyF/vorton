import http from "node:http";
import { Readable } from "node:stream";
import { canonicalWorkspacePath } from "./workspace-routes.mjs";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Store, check, Fault } from "./store.mjs";
import { councilPacket, publishCouncil } from "./council.mjs";
import { reviewPacket, importRecommendations } from "./review.mjs";
import { installedVersion } from "./version.mjs";
import { pipeAssetResponse } from "./asset-delivery.mjs";
import { integrationHandler } from "./integration-http.mjs";
import { councilStateView } from "./council-state-view.mjs";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const publicState = ({ requests, ...state }, options) => councilStateView(state, options);

/** Portable local host. Only explicitly configured profiles are reachable. */
export function createCoreServer({
  root,
  port = 47840,
  dist = path.join(root, "dist"),
  origin = "",
  enabledProfiles = ["LastResort"],
  defaultPath = "/lastresort/bridge",
  sessionToken,
  omi,
}) {
  check(
    Array.isArray(enabledProfiles) &&
      enabledProfiles.length > 0 &&
      enabledProfiles.every(
        (p) => typeof p === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(p),
      ),
    "Invalid enabled profiles",
  );
  const registry = new Map(enabledProfiles.map((p) => [p.toLowerCase(), p]));
  check(registry.size === enabledProfiles.length, "Duplicate profile route");
  check(
    typeof defaultPath === "string" &&
      defaultPath.startsWith("/") &&
      !defaultPath.startsWith("//") &&
      registry.has(defaultPath.split("/")[1]),
    "Invalid default route",
  );
  const store = new Store(root, enabledProfiles);
  check(
    sessionToken === undefined || /^[a-f0-9]{64}$/.test(sessionToken),
    "Invalid host session token",
  );
  const token = sessionToken ?? randomBytes(32).toString("hex");
  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
  if (origin) {
    const parsed = new URL(origin);
    check(
      parsed.origin === origin && ["https:", "http:"].includes(parsed.protocol),
      "Exact origin required",
    );
    allowed.add(origin);
  }
  const hosts = new Set([...allowed].map((v) => new URL(v).host));
  const integrations = integrationHandler({ root, profiles: enabledProfiles, token, allowed, omi });
  const json = (res, status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
    );
    try {
      check(hosts.has(req.headers.host), "Host is not configured", 403);
      if (req.headers.origin)
        check(allowed.has(req.headers.origin), "Origin is not configured", 403);
      check(
        req.headers["sec-fetch-site"] !== "cross-site",
        "Cross-site request denied",
        403,
      );
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (await integrations(req, res, url)) return;
      if (req.method === "GET" && url.pathname === "/api/health")
        return json(res, 200, { service: "vorton-local", status: "ready" });
      if (req.method === "GET" && url.pathname === "/api/version")
        return json(res, 200, installedVersion);
      if (req.method === "GET" && url.pathname === "/api/session")
        return json(res, 200, { token, profiles: enabledProfiles });
      const match =
        /^\/api\/([a-z0-9_-]+)\/(state|command|review|export)$/.exec(
          url.pathname,
        );
      if (match) {
        const profile = registry.get(match[1]);
        const operation = match[2];
        check(profile, "Unknown installation", 404);
        if (
          req.method === "GET" &&
          ["state", "export", "review"].includes(operation)
        ) {
          const state = await store.read(profile);
          if (operation === "review")
            return json(
              res,
              200,
              url.searchParams.get("session") === "1"
                ? councilPacket(state)
                : reviewPacket(state, url.searchParams.get("role")),
            );
          if (operation === "export")
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${profile}-goals-tasks.json"`,
            );
          return json(res, 200, publicState(state, { fullHistory: operation === "export", sessionId: url.searchParams.get("councilSession") }));
        }
        check(
          req.method === "POST" && operation === "command",
          "Method not allowed",
          405,
        );
        check(
          allowed.has(req.headers.origin),
          "A same-origin request is required",
          403,
        );
        const supplied = Buffer.from(req.headers["x-vorton-session"] ?? "");
        const expected = Buffer.from(token);
        check(
          supplied.length === expected.length &&
            timingSafeEqual(supplied, expected),
          "Session expired. Reload this page.",
          403,
        );
        check(
          req.headers["content-type"]?.split(";")[0] === "application/json",
          "Expected JSON",
          415,
        );
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          check(size <= 131072, "Request is too large", 413);
          chunks.push(chunk);
        }
        let command;
        try {
          command = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new Fault(400, "Invalid JSON");
        }
        check(
          command && typeof command === "object" && !Array.isArray(command),
          "Expected a command",
        );
        const state =
          command.action === "council.publish"
            ? await store.transact(profile, command, (s) =>
                publishCouncil(s, command.payload),
              )
            : command.action === "recommendations.import"
              ? await store.transact(profile, command, (s) =>
                  importRecommendations(s, command.payload),
                )
              : await store.command(profile, command);
        return json(res, 200, publicState(state));
      }
      check(!url.pathname.startsWith("/api/"), "Unknown route", 404);
      check(["GET", "HEAD"].includes(req.method), "Method not allowed", 405);
      const canonical = canonicalWorkspacePath(
        url.pathname,
        defaultPath,
        enabledProfiles,
      );
      if (canonical !== url.pathname) {
        res.writeHead(308, { Location: canonical + url.search });
        return res.end();
      }
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204);
        return res.end();
      }
      const relative = decodeURIComponent(url.pathname.slice(1));
      const asset = relative.startsWith("demo-assets/");
      check(
        asset || registry.has(relative.split("/")[0]),
        "Unknown route",
        404,
      );
      check(
        !relative.includes("..") &&
          !relative.includes("\\") &&
          !relative.includes("\0"),
        "Invalid asset path",
        404,
      );
      let target;
      let data;
      try {
        const base = await realpath(dist);
        target = await realpath(
          path.join(base, asset ? relative : "index.html"),
        );
        check(target.startsWith(base + path.sep), "Invalid asset path", 404);
        data = await readFile(target);
      } catch (error) {
        if (error instanceof Fault) throw error;
        throw new Fault(404, "Application asset not found. Run npm run build.");
      }
      // Local files use the same encoding and confidentiality policy as the
      // proxied application. HEAD keeps metadata without sending a body.
      const incoming = Readable.from(req.method === "HEAD" ? [] : [data]);
      incoming.statusCode = 200;
      pipeAssetResponse(req, res, incoming, {
        "content-type":
          mime[path.extname(target)] ?? "application/octet-stream",
        "content-length": data.length,
      }, url.pathname, null);
    } catch (error) {
      if (!res.headersSent)
        json(res, error instanceof Fault ? error.status : 500, {
          error:
            error instanceof Fault
              ? error.message
              : "Operation failed. Local records were not reset.",
        });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  return { server, store, hosts, allowed };
}
