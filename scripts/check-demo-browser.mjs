import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createCoreServer as createServer } from "../server/core-http.mjs";
import { seedDemo } from "./demo-seed.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// Supply an installed Playwright module explicitly; never load a private app to run the demo.
if (!process.env.PLAYWRIGHT_MODULE)
  throw new Error(
    "Set PLAYWRIGHT_MODULE to an installed playwright-core index.mjs",
  );
const { chromium } = await import(
  pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE))
);
const output = path.join(root, ".runtime/demo-browser");
await mkdir(output, { recursive: true });
const state = await mkdtemp(path.join(output, "state-"));
await seedDemo(state);
const app = createServer({
  root: state,
  dist: path.join(root, "dist"),
  port: 0,
  enabledProfiles: ["LastResort"],
  defaultPath: "/lastresort/bridge",
});
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
app.hosts.add(new URL(origin).host);
app.allowed.add(origin);
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://**", (route) => route.abort());
  // A slow history chunk must not paint the Goals panel and then push it down
  // when the Roundtable arrives. Keep the whole Council body behind Suspense.
  const slowCouncil = await context.newPage();
  let releaseHistory;
  const historyReady = new Promise(resolve => { releaseHistory = resolve; });
  await slowCouncil.route("**/council-report-*.js", async route => {
    await historyReady;
    await route.continue();
  });
  try {
    await slowCouncil.goto(`${origin}/lastresort/council#council-goals`, { waitUntil: "domcontentloaded" });
    await slowCouncil.getByText("Loading council history", { exact: true }).waitFor();
    assert.equal(await slowCouncil.locator("#council-goals").count(), 0);
  } finally {
    releaseHistory();
  }
  await slowCouncil.locator("#council-roundtable").waitFor();
  await slowCouncil.waitForFunction(() => {
    const target = document.getElementById("council-goals");
    return target && target.getBoundingClientRect().top >= 0 && target.getBoundingClientRect().top < innerHeight;
  });
  await slowCouncil.close();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/lastresort?filter=Active`, {
      waitUntil: "networkidle",
    });
    assert.equal(page.url(), `${origin}/lastresort/bridge?filter=Active`);
    assert.equal(
      await page
        .getByRole("link", { name: "Bridge", exact: true })
        .getAttribute("aria-current"),
      "page",
    );
    for (const section of [
      "bridge",
      "council",
      "goals",
      "tasks",
      "tools",
      "opportunities",
      "finance",
      "admin",
      "guestbook",
    ]) {
      assert.equal(
        (
          await page.goto(`${origin}/lastresort/${section}`, {
            waitUntil: "networkidle",
          })
        ).status(),
        200,
      );
      assert.equal(await page.getByRole("alert").count(), 0);
      if (section === "council")
        assert.equal(
          await page.getByText("No saved submission", { exact: true }).count(),
          0,
          "Every fictional Council voice has a saved contribution",
        );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        `${section} overflows at ${width}`,
      );
      await page.screenshot({
        path: path.join(output, `${section}-${width}.png`),
        fullPage: true,
      });
    }
    await page.locator(".installation-switcher > summary").click();
    const arrow = await page.locator('.brand-mark > svg').evaluate(svg => {
      const box = svg.getBoundingClientRect(), trigger = svg.parentElement.getBoundingClientRect();
      return {width:box.width,height:box.height,offset:box.y+box.height/2-trigger.y-trigger.height/2};
    });
    assert.equal(arrow.width,14);
    assert.equal(arrow.height,14);
    assert.ok(Math.abs(arrow.offset)<1, 'Selector arrow stays centered');
    await page.getByLabel("Installed Vorton version").waitFor();
    assert.match(
      await page.getByLabel("Installed Vorton version").innerText(),
      /^Vorton \d+\.\d+\.\d+/,
    );
    assert.equal(
      await page.locator(".installation-links > :last-child").getAttribute("class"),
      "installed-version",
    );
    for (const theme of [
      "ember",
      "midas",
      "scriptorium",
      "starship-light",
      "starship-dark",
      "neon",
    ]) {
      const preview =
        theme === "starship-light"
          ? "starship"
          : theme === "starship-dark"
            ? "dark-star"
            : theme;
      await page
        .locator(`button:has([data-theme-preview="${preview}"])`)
        .click();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        theme,
      );
    }
    await page.screenshot({ path: path.join(output, `menu-${width}.png`) });
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".installation-switcher").getAttribute("open"),
      null,
    );
    await page.reload({waitUntil:'networkidle'});
    assert.equal(await page.locator('html').getAttribute('data-theme'),'neon');
    assert.equal(await page.evaluate(()=>localStorage.getItem('aubos-appearance')),'neon');
  }
  const second = await page.context().newPage();
  await second.goto(`${origin}/lastresort/tasks`, {waitUntil:'networkidle'});
  await page.locator('.installation-switcher > summary').click();
  await page.locator('button:has([data-theme-preview="ember"])').click();
  await second.waitForFunction(()=>document.documentElement.dataset.theme==='ember');
  const zoom = page.getByRole('slider',{name:'Interface zoom',exact:true});
  await zoom.focus();await zoom.press('Home');
  for(let step=0;step<10;step++)await zoom.press('ArrowRight');
  await second.waitForFunction(()=>document.documentElement.dataset.interfaceZoom==='125');
  await second.reload({waitUntil:'networkidle'});
  assert.equal(await second.locator('html').getAttribute('data-interface-zoom'),'125');
  await second.close();
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Storage unavailable','SecurityError');};});
  await zoom.press('ArrowRight');
  assert.equal(await zoom.inputValue(),'130');
  assert.equal(await page.locator('html').getAttribute('data-interface-zoom'),'130');
  await page.goto(`${origin}/lastresort/goals`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New goal", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Find a finite supply of clean towels");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await page
    .getByText("Find a finite supply of clean towels", { exact: true })
    .waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByText("Find a finite supply of clean towels", { exact: true })
    .waitFor();
  await page.goto(`${origin}/lastresort/tasks`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Count the towels before they become infinite");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page
    .getByText("Count the towels before they become infinite", { exact: true })
    .waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByText("Count the towels before they become infinite", { exact: true })
    .waitFor();
  await page.goto(`${origin}/lastresort/bridge`,{waitUntil:'networkidle'});
  await page.getByRole('link',{name:'Run a twelve-guest opening rehearsal',exact:true}).click();
  await page.locator('#council-timeline').waitFor();
  const recommendation = page.locator(`article[id="${new URL(page.url()).hash.slice(1)}"]`);
  let targetVisible = false;
  for(let attempt=0;attempt<50;attempt++) {
    const rect=await recommendation.boundingBox();
    if(rect&&rect.y>=0&&rect.y<page.viewportSize().height){targetVisible=true;break;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(targetVisible,'Recommendation link remains visible after lazy Council content loads');
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await page.goto(`${origin}/lastresort/tasks`, { waitUntil: "networkidle" });
  await page
    .getByText("Run a twelve-guest opening rehearsal", { exact: true })
    .waitFor();
  await page.goto(`${origin}/lastresort/bridge`,{waitUntil:'networkidle'});
  await page.getByRole('link',{name:'Find a finite supply of clean towels',exact:true}).waitFor();
  assert.match(await page.locator('.operations-metrics').innerText(), /0\s+Awaiting your decision/);
  await page.getByRole('link',{name:'Locate Room 404 before accepting another booking',exact:true}).click();
  const linkedTask = page.locator(`article[id="${new URL(page.url()).hash.slice(1)}"]`);
  await linkedTask.waitFor().catch(async error=>{
    await page.screenshot({path:path.join(output,'failed-record-link.png'),fullPage:true});
    throw new Error(`${error.message}\n${JSON.stringify({url:page.url(),errors,body:(await page.locator('body').innerText()).slice(0,1600)})}`);
  });
  assert.match(await linkedTask.innerText(),/Locate Room 404/);
  await page.goto(`${origin}/lastresort/tools`,{waitUntil:'networkidle'});
  const rooms=page.locator('#hilbert-desk'),breakfast=page.locator('#breakfast-lab');
  await rooms.getByText('4 rooms short',{exact:true}).waitFor();
  await rooms.getByLabel('Available rooms',{exact:true}).fill('40');
  await rooms.getByText('4 rooms spare',{exact:true}).waitFor();
  await rooms.getByLabel('Available rooms',{exact:true}).fill('');
  assert.equal(await rooms.getByRole('button',{name:'Draft room task'}).count(),0);
  await rooms.getByLabel('Available rooms',{exact:true}).fill('32');
  const before=await (await page.request.get(`${origin}/api/lastresort/state`)).json();
  await rooms.getByRole('button',{name:'Draft room task'}).click();
  assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Find 4 more rooms before accepting arrivals');
  await page.keyboard.press('Escape');
  const after=await (await page.request.get(`${origin}/api/lastresort/state`)).json();
  assert.equal(after.revision,before.revision,'Canceling a tool draft writes nothing');
  await breakfast.getByText('110 minutes',{exact:true}).waitFor();
  await breakfast.getByLabel('Hungry guests',{exact:true}).fill('0');
  await breakfast.getByText('0 minutes',{exact:true}).waitFor();
  assert.equal(await breakfast.getByRole('button',{name:'Draft breakfast task'}).count(),0);
  await breakfast.getByLabel('Hungry guests',{exact:true}).fill('48');
  await breakfast.getByRole('button',{name:'Draft breakfast task'}).click();
  await page.getByLabel('Owner',{exact:true}).fill('Solstice Bell');
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const saved=await (await page.request.get(`${origin}/api/lastresort/state`)).json();
  assert.equal(saved.tasks.length,before.tasks.length+1);
  const generated=saved.tasks.find(task=>task.title==='Plan breakfast for 48 guests');
  assert.match(generated.notes,/110 minutes; finish 09:50/);
  assert.match(generated.notes,/Assumes all guests are ready/);
  await page.goto(`${origin}/lastresort/tasks`,{waitUntil:'networkidle'});
  await page.getByText('Plan breakfast for 48 guests',{exact:true}).waitFor();
  await page.goto(`${origin}/lastresort/opportunities`,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'New opportunity',exact:true}).click();
  const opportunityForm=page.getByRole('form',{name:'New opportunity',exact:true});
  await opportunityForm.getByLabel('Title',{exact:true}).fill('The annual meeting of yesterday');
  await opportunityForm.getByLabel('Estimated value (USD)').fill('250.50');
  await opportunityForm.getByLabel('Next action',{exact:true}).fill('Confirm yesterday is available');
  await opportunityForm.getByRole('button',{name:'Save',exact:true}).click();
  await opportunityForm.waitFor({state:'hidden'});
  await page.reload({waitUntil:'networkidle'});
  const opportunityCard=page.locator('article').filter({has:page.getByRole('heading',{name:'The annual meeting of yesterday',exact:true})});
  await opportunityCard.getByRole('button',{name:'Draft next task'}).click();
  assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Confirm yesterday is available');
  await page.keyboard.press('Escape');
  await opportunityCard.getByRole('button',{name:'Edit opportunity'}).click();
  const editOpportunity=page.getByRole('form',{name:'Edit opportunity'});
  await editOpportunity.getByRole('combobox',{name:'Stage',exact:true}).selectOption('won');
  await editOpportunity.getByRole('button',{name:'Save',exact:true}).click();
  await editOpportunity.waitFor({state:'hidden'});
  await page.getByRole('combobox',{name:'Show opportunities',exact:true}).selectOption('won');
  await opportunityCard.waitFor();
  await page.goto(`${origin}/lastresort/finance`,{waitUntil:'networkidle'});
  await page.getByText('$13,820.00',{exact:true}).waitFor();
  await page.getByRole('button',{name:'New entry',exact:true}).click();
  const entryForm=page.getByRole('form',{name:'New ledger entry'});
  await entryForm.getByLabel('Title',{exact:true}).fill('A punctual deposit');
  await entryForm.getByLabel('Entry kind').selectOption('income');
  await entryForm.getByLabel('Amount (USD)').fill('123.45');
  await entryForm.getByLabel('Date',{exact:true}).fill('2032-04-02');
  await entryForm.getByLabel('Category',{exact:true}).fill('Bookings');
  await entryForm.getByRole('button',{name:'Save',exact:true}).click();
  await entryForm.waitFor({state:'hidden'});
  await page.getByText('$13,943.45',{exact:true}).waitFor();
  const forecast=page.getByRole('form',{name:'Forecast assumptions'});
  await forecast.getByLabel('Occupancy (%)').fill('50');
  await forecast.getByRole('button',{name:'Save',exact:true}).click();
  await forecast.getByText('Forecast assumptions saved.').waitFor();
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.getByLabel('Occupancy (%)').inputValue(),'50');
  await page.getByText('$6,300.00',{exact:true}).waitFor();
  await page.goto(`${origin}/lastresort/admin`,{waitUntil:'networkidle'});
  const preferences=page.getByRole('form',{name:'Workspace settings'});
  await preferences.getByLabel('Default task and opportunity owner').fill('Penny Perihelion');
  await preferences.getByLabel('Workspace purpose').fill('Keep the towels and the accounts finite.');
  await preferences.getByRole('button',{name:'Save',exact:true}).click();
  await preferences.getByText('Workspace settings saved.').waitFor();
  await page.getByText('Updated workspace preferences',{exact:true}).waitFor();
  const exported=await (await page.request.get(`${origin}/api/lastresort/export`)).json();
  assert.equal(exported.opportunities.length,4);assert.equal(exported.ledger.length,5);
  assert.equal(exported.opportunities.find(row=>row.title==='The annual meeting of yesterday').history.length,1);
  assert.equal(exported.financePlan.occupancy,50);assert.equal(exported.preferenceHistory.length,2);
  assert.equal(exported.requests,undefined);
  await page.goto(`${origin}/lastresort/guestbook`,{waitUntil:'networkidle'});
  await page.getByText('Keep the towels and the accounts finite.',{exact:true}).waitFor();
  await page.goto(`${origin}/lastresort/tasks`,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'New task',exact:true}).click();
  assert.equal(await page.getByLabel('Owner',{exact:true}).inputValue(),'Penny Perihelion');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log(
    "Desktop/mobile routes, six themes, Tools drafts, Opportunities, ledger, forecast, workspace settings, export history, Goals/Tasks and Council acceptance passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => app.server.close(resolve));
  await rm(state, { recursive: true, force: true });
}
