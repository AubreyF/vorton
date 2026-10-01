import { timingSafeEqual } from "node:crypto";
import { OmiIntegration } from "./omi-integration.mjs";
import { check, Fault } from "./store.mjs";

/** Shared by the portable host and installed host, after Host/Origin checks. */
export function integrationHandler({ root, profiles, token, allowed, omi }) {
  const registry = new Map(profiles.map(profile => [profile.toLowerCase(), profile]));
  return async (req, res, url) => {
    const match = /^\/api\/([a-z0-9_-]+)\/integrations\/omi(?:\/(history|transcript))?$/.exec(url.pathname);
    if (!match) return false;
    const profile = registry.get(match[1]);
    check(profile, "Unknown installation", 404);
    omi ??= new OmiIntegration(root, profiles);
    // History and key administration require the same live session, including GETs.
    const supplied = Buffer.from(req.headers["x-vorton-session"] ?? ""), expected = Buffer.from(token);
    check(supplied.length === expected.length && timingSafeEqual(supplied, expected), "Session expired. Reload this page.", 403);
    const send = value => { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); return true; };
    if (req.method === "GET") {
      if (match[2] === "history") return send(await omi.history(profile, { offset: Number(url.searchParams.get("offset") ?? 0) }));
      if (match[2] === "transcript") return send(await omi.transcript(profile, url.searchParams.get("id")));
      return send(await omi.status(profile));
    }
    check(req.method === "POST" && !match[2], "Method not allowed", 405);
    check(allowed.has(req.headers.origin), "A same-origin request is required", 403);
    check(req.headers["content-type"]?.split(";")[0] === "application/json", "Expected JSON", 415);
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; check(length <= 8192, "Request is too large", 413); chunks.push(chunk); }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Fault(400, "Invalid JSON"); }
    check(input && typeof input === "object" && !Array.isArray(input), "Invalid integration command");
    const fields = {
      save: ["action", "key", "expectedRevision", "sameAccount", "enabled", "councilEnabled", "folder"],
      "key.save": ["action", "key", "expectedRevision", "sameAccount"],
      "key.remove": ["action", "expectedRevision"],
      configure: ["action", "expectedRevision", "enabled", "councilEnabled", "folder"],
      sync: ["action", "day", "mode"],
      "history.delete": ["action", "expectedRevision", "confirmation"],
    };
    check(Object.hasOwn(fields, input.action) && Object.keys(input).every(k => fields[input.action].includes(k)), "Invalid integration command");
    if (input.action === "save") return send(await omi.save(profile, input));
    if (input.action === "key.save") return send(await omi.saveKey(profile, input));
    if (input.action === "key.remove") return send(await omi.removeKey(profile, input));
    if (input.action === "configure") return send(await omi.configure(profile, input));
    if (input.action === "sync") return send(await omi.sync(profile, input));
    return send(await omi.deleteHistory(profile, input));
  };
}
