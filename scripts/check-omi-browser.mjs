import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCoreServer } from "../server/core-http.mjs";
import { OmiIntegration } from "../server/omi-integration.mjs";

// Explicit external browser dependency keeps the runtime package small.
assert.ok(process.env.PLAYWRIGHT_PACKAGE, "Set PLAYWRIGHT_PACKAGE to the installed browser package");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE);
const source = fileURLToPath(new URL("..", import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), "vorton-omi-browser-"));
const output = path.join(source, ".runtime", "omi-browser");
await mkdir(output, { recursive: true });
const secret = "omi_dev_SYNTHETIC_BROWSER_ONLY";
const omi = new OmiIntegration(root, ["LastResort"], { clientFactory: () => ({ list: async q => q.transcripts === false || q.offset > 0 ? [] : [{
  id: "synthetic-one", created_at: "2026-09-27T19:00:00Z", status: "completed",
  structured: { title: "Synthetic transcript" }, transcript_segments: [{ start: 0, end: 4, text: "<script>window.transcriptInjected=true</script> Controlled example." }],
}] }) });
const app = createCoreServer({ root, dist: path.join(source, "dist"), port: 0, enabledProfiles: ["LastResort"], omi });
await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
app.hosts.add(new URL(origin).host); app.allowed.add(origin);
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("https://**", route => route.abort());
  await page.goto(origin + "/lastresort/admin/integrations/omi");
  const panel = page.getByRole("region", { name: "Omi conversation intelligence" });
  await panel.getByText("Not connected", { exact: true }).waitFor();
  const input = panel.getByLabel("Omi Developer key", { exact: true });
  assert.equal(await input.getAttribute("type"), "password");
  await input.fill(secret);
  await panel.getByLabel("Enable Omi synchronization", { exact: true }).check();
  assert.equal(await panel.getByRole("button", { name: "Save changes", exact: true }).count(), 1);
  await panel.getByRole("button", { name: "Save changes", exact: true }).click();
  await panel.getByText("Connected", { exact: true }).waitFor();
  assert.equal(await input.inputValue(), "");
  assert.ok(!await page.evaluate(key => JSON.stringify(localStorage).includes(key), secret));
  await panel.getByText("Changes saved.", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "Save changes", exact: true }).isDisabled(), true);
  await panel.getByText("Catch-up & replay", { exact: true }).click();
  await panel.getByLabel("Pacific day", { exact: true }).fill("2026-09-27");
  await panel.getByRole("button", { name: "Replay selected day", exact: true }).click();
  await panel.getByText("Replay selected day finished.", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Browse retained history" }).click();
  await panel.getByRole("button", { name: "Synthetic transcript", exact: true }).click();
  await panel.getByRole("article", { name: "Retained transcript" }).waitFor();
  assert.equal(await page.evaluate(() => window.transcriptInjected), undefined);
  await panel.getByRole("button", { name: "Close transcript", exact: true }).click();
  await panel.getByText("Catch-up & replay", { exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`);
    await page.screenshot({ path: path.join(output, `admin-${width}.png`), fullPage: true });
  }
  await panel.getByText("Disconnect or delete history", { exact: true }).click();
  await panel.getByRole("button", { name: "Disconnect Omi" }).click();
  await panel.getByText("Not connected", { exact: true }).waitFor();
  assert.equal((await omi.history("LastResort")).total, 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "passed", widths: [1440, 390], syntheticOnly: true }));
} finally {
  await browser?.close();
  await new Promise(resolve => app.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
