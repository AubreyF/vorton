import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { createCoreServer } from "../server/core-http.mjs";

/** The native acceptance harness reuses these checks with its isolated adapter. */
export async function verifyAdmin(page, origin, profile, output) {
  const base = `${origin}/${profile.toLowerCase()}/admin`;
  const errors = [], integrationRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^\/api\/[^/]+\/integrations\/omi/.test(new URL(request.url()).pathname)) integrationRequests.push(request.url()); });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    integrationRequests.length = 0;
    await page.goto(base, { waitUntil: "networkidle" });
    const admin = page.locator(".workspace-admin");
    try { await admin.getByRole("heading", { name: "Admin", exact: true }).waitFor(); }
    catch (error) { console.error(JSON.stringify({ profile, errors, title: await page.title(), body: (await page.locator("body").innerText()).slice(0, 1200) })); throw error; }
    assert.equal(await page.locator(".topbar").count(), 1);
    assert.equal(await admin.locator(".admin-content").count(), 0);
    assert.equal(integrationRequests.length, 0, "Landing must not load credential controls");
    const widths = await admin.locator(".admin-card").evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().width)));
    assert.ok(widths.length >= 4);
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, "Directory cards must share a width");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, `${profile}-admin-${width}.png`), fullPage: true });
    await admin.getByRole("link", { name: /Integrations/ }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(base + "/integrations");
    await page.locator(".admin-card").getByRole("heading", { name: "Omi", exact: true }).waitFor();
    assert.equal(await page.locator('input[name="omi-developer-key"]').count(), 0);
    await page.locator(".admin-card").click();
    await page.waitForURL(base + "/integrations/omi");
    await page.getByLabel("Omi Developer key", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Omi Developer key", { exact: true }).getAttribute("type"), "password");
    assert.ok(integrationRequests.every(url => new URL(url).pathname.startsWith(`/api/${profile.toLowerCase()}/`)), "Integration requests must remain in the selected workspace");
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Admin", exact: true }).click();
    await page.waitForURL(base);
    await page.goBack();
    await page.getByLabel("Omi Developer key", { exact: true }).waitFor();
    for (const section of ["settings", "exports", "activity", ...(profile === "FreedOS" ? ["decisions"] : [])]) {
      await page.goto(`${base}/${section}`, { waitUntil: "networkidle" });
      await page.locator(".admin-content").waitFor();
      assert.equal(await page.locator('input[name="omi-developer-key"]').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const panels = await page.locator(".admin-content > .panel").evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().width)));
      if (panels.length > 1) assert.ok(Math.max(...panels) - Math.min(...panels) <= 1);
    }
  }
  await page.goto(base + "#activity", { waitUntil: "networkidle" });
  await page.waitForURL(base + "/activity");
  if (profile === "LastResort") {
    await page.goto(base + "/settings", { waitUntil: "networkidle" });
    await page.getByLabel("Workspace purpose", { exact: true }).fill("Synthetic Admin acceptance");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByText("Workspace settings saved.", { exact: true }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    try { assert.equal(await page.getByLabel("Workspace purpose", { exact: true }).inputValue(), "Synthetic Admin acceptance"); }
    catch (error) { console.error(JSON.stringify({ url: page.url(), errors, body: (await page.locator("body").innerText()).slice(0, 1400) })); throw error; }
    const exported = await (await page.request.get(`${origin}/api/lastresort/export`)).json();
    assert.equal(exported.profile, profile);
    assert.ok(!Object.hasOwn(exported, "credential"));
  }
  for (const appearance of ["starship-light", "starship-dark", "neon", "midas", "ember", "scriptorium"]) {
    await page.evaluate(value => localStorage.setItem("aubos-appearance", value), appearance);
    await page.goto(base, { waitUntil: "networkidle" });
    await page.locator(".admin-card").first().waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("aubos-appearance")), appearance);
    await page.screenshot({ path: path.join(output, `${profile}-admin-${appearance}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  return { profile, widths: [1440, 390], independentSections: true, scopedRequests: true, equalCardWidths: true, historyNavigation: true, keyboardNavigation: true, themes: 6 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE);
  const source = fileURLToPath(new URL("..", import.meta.url));
  const root = await mkdtemp(path.join(os.tmpdir(), "admin-browser-"));
  const output = path.join(source, ".runtime", "admin-browser");
  await mkdir(output, { recursive: true });
  const app = createCoreServer({ root, dist: path.join(source, "dist"), port: 0 });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  app.hosts.add(new URL(origin).host); app.allowed.add(origin);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.route("https://**", route => route.abort());
    console.log(JSON.stringify(await verifyAdmin(page, origin, "LastResort", output)));
  } finally {
    await browser?.close(); app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}
