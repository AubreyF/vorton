import { Fault, check } from "./store.mjs";

export class OmiFailure extends Fault {
  constructor(code, status = 502, retryAt = null) {
    super(status, `Omi request failed (${code}).`);
    this.code = code;
    this.retryAt = retryAt;
  }
}

/** Fixed HTTPS read-only transport. No redirects, alternate hosts, logs or model calls. */
export class OmiClient {
  constructor(key, { fetcher = fetch, clock = () => Date.now() } = {}) {
    check(typeof key === "string" && /^omi_dev_[A-Za-z0-9_-]{8,240}$/.test(key), "Enter an Omi Developer API key.");
    this.key = key;
    this.fetcher = fetcher;
    this.clock = clock;
  }

  async list({ start, end, offset = 0, folder = null, transcripts = true, limit = 25 }) {
    check(Number.isSafeInteger(offset) && offset >= 0 && offset <= 10000000, "Invalid Omi page offset");
    check(Number.isInteger(limit) && limit >= 1 && limit <= (transcripts ? 25 : 100), "Invalid Omi page size");
    const url = new URL("https://api.omi.me/v1/dev/user/conversations");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("include_transcript", String(transcripts));
    for (const [name, value] of [["start_date", start], ["end_date", end]]) {
      if (value != null) {
        check(typeof value === "string" && Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d\d:\d\d)$/.test(value), "Omi dates need an explicit timezone");
        url.searchParams.set(name, new Date(value).toISOString());
      }
    }
    if (folder) { check(typeof folder === "string" && folder.length <= 200, "Invalid Omi folder"); url.searchParams.set("folder_id", folder); }
    let response;
    try {
      response = await this.fetcher(url, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json" },
      });
    } catch { throw new OmiFailure("transport"); }
    if (!response.ok) {
      // Never read or reproduce error bodies: they may contain private content.
      let retryAt = null;
      if (response.status === 429) {
        const value = response.headers.get("retry-after");
        const seconds = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
        const parsed = seconds !== null ? this.clock() + seconds * 1000 : Date.parse(value ?? "");
        const minimum = this.clock() + 60000;
        retryAt = new Date(Number.isFinite(parsed) && parsed < 8640000000000000 ? Math.max(minimum, parsed) : minimum).toISOString();
      }
      await response.body?.cancel().catch(() => {});
      const code = [401, 403, 404, 408, 429, 500, 502, 503, 504].includes(response.status) ? `http_${response.status}` : "http_error";
      throw new OmiFailure(code, response.status === 429 ? 429 : 502, retryAt);
    }
    if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      await response.body?.cancel().catch(() => {});
      throw new OmiFailure("content_type");
    }
    const chunks = []; let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) throw new OmiFailure("response_size");
        chunks.push(chunk);
      }
      const records = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(records) || records.length > limit) throw new OmiFailure("schema");
      return records;
    } catch (error) {
      if (error instanceof OmiFailure) throw error;
      throw new OmiFailure("response_invalid");
    }
  }
}

/** Pacific calendar boundaries, including 23/25-hour days, without a timezone dependency. */
export function pacificDay(day) {
  check(typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day), "Invalid Pacific day");
  const date = new Date(`${day}T00:00:00Z`);
  check(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day, "Invalid Pacific day");
  const midnight = value => {
    let instant = Date.parse(`${value}T08:00:00Z`);
    for (let n = 0; n < 3; n++) {
      const fields = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date(instant)).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
      const wall = Date.parse(`${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}Z`);
      instant += Date.parse(`${value}T00:00:00Z`) - wall;
    }
    return new Date(instant).toISOString();
  };
  date.setUTCDate(date.getUTCDate() + 1);
  return { start: midnight(day), end: midnight(date.toISOString().slice(0, 10)) };
}

export function previousDay(day) {
  pacificDay(day);
  const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
