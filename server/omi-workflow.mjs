import { OmiIntegration } from "./omi-integration.mjs";
import { check } from "./store.mjs";
import { pacificDay } from "./omi-client.mjs";

/** Existing scheduler threads call this facade; it never launches an agent or model. */
export function omiWorkflow(root, profiles, { roots = {}, services = {}, clock = () => Date.now() } = {}) {
  const service = profile => {
    check(profiles.includes(profile), "Unknown installation", 404);
    return services[profile] ??= new OmiIntegration(roots[profile] ?? root, [profile]);
  };
  return {
    service,
    manifest: (profile, day) => service(profile).councilMaterial(profile, day),
    page: (profile, day, page, digest) => service(profile).councilMaterial(profile, day, page, digest),
    acknowledge: (profile, receipt) => service(profile).acknowledgeCouncil(profile, receipt),
    failed: (profile, at) => service(profile).councilFailed(profile, at),
    async refresh(profile, day) {
      try {
        const omi = service(profile), status = await omi.status(profile);
        if (status.councilEnabled === false || (!status.keyConfigured && !status.historyCount)) return { status: "disabled" };
        if (!status.enabled || !status.keyConfigured) return { status: "deferred", code: "sync_disabled" };
        if (Date.parse(pacificDay(day).end) > clock()) return { status: "deferred", code: "day_in_progress" };
        if (status.retryAt && Date.parse(status.retryAt) > clock()) return { status: "deferred", code: "retry_pending", retryAt: status.retryAt };
        const recent = await omi.sync(profile, { day, mode: "replay", maxPages: 20 });
        if (recent.status === "failed") return recent;
        if (recent.code !== "filtered_end_unverified") return { ...recent, status: "deferred" };
        if (recent.scanExcluded ?? recent.excluded) return { ...recent, status: "deferred", code: "daily_records_excluded" };
        const overlap = await omi.sync(profile, { day, mode: "recent", maxPages: 2 });
        if (overlap.status === "failed") return overlap;
        // Historical catch-up stays inside the same run and its request budget.
        const backfill = await omi.sync(profile, { day, mode: "backfill", maxPages: 8 });
        if (backfill.status === "failed") return backfill;
        return { ...recent, status: "ready" };
      } catch {
        // Storage migration, a competing lease or admission failure must not
        // fall through to stale retained evidence or leak a private error.
        return { status: "deferred", code: "ingestion_unavailable" };
      }
    },
  };
}
