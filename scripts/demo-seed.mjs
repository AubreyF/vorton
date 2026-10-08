import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  Store,
  goalInput,
  taskInput,
  opportunityInput,
  legacyIdea,
  entryInput,
  financePlanInput,
  atomicJson,
  check,
} from "../server/store.mjs";
import { coreIdentities } from "../modules/council/config.mjs";
import { councilPacket, publishCouncil } from "../server/council.mjs";

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
export const demoRoot = path.join(sourceRoot, ".runtime", "last-resort");
export async function seedDemo(root = demoRoot) {
  const store = new Store(root);
  const before = await store.read("LastResort");
  check(
    before.revision === 0,
    "Demo already contains work. Use a separate empty state directory; existing records are never reset.",
    409,
  );
  const brief = JSON.parse(
    await readFile(
      new URL("../demo/last-resort/brief.json", import.meta.url),
      "utf8",
    ),
  );
  const organization = path.join(root, "LastResort", "organization");
  await mkdir(organization, { recursive: true });
  await atomicJson(path.join(organization, "council.json"), {
    version: 1,
    profile: "LastResort",
    disabledIdentities: coreIdentities.map((x) => x.id),
    additionalIdentities: brief.staff,
    behavior: {
      focus: brief.operatingPrinciple,
      decisionCriteria:
        "Guest safety, staff capacity, reversible experiments, and a finite fictional budget.",
    },
  });
  const date = "2032-04-01T09:00:00.000Z";
  const entity = (id, fields) => ({
    id,
    ...fields,
    version: 1,
    createdAt: date,
    updatedAt: date,
    history: [],
  });
  let state = await store.transact(
    "LastResort",
    {
      requestId: randomUUID(),
      expectedRevision: 0,
      action: "demo.load-fixtures",
    },
    (s) => {
      s.goals.push(
        entity(
          "reopen-east-wing",
          goalInput({
            title: "Reopen the east wing in the correct century",
            owner: "Mabel Meridian",
            intent:
              "Welcome twelve fictional guests without temporal displacement.",
            successCriteria:
              "Every room passes gravity, hot-water, and accessible-route checks; reception completes one rehearsal.",
            evidence:
              "Fictional fixture: the maintenance log lists three unresolved room checks.",
            horizon: "Opening weekend",
            priority: "high",
            progress: 40,
            milestones: [
              { title: "Agree the reopening checklist", done: true },
              { title: "Pass room inspections", done: false },
              { title: "Rehearse arrival and evacuation", done: false },
            ],
          }),
        ),
        entity(
          "finite-breakfast",
          goalInput({
            title: "Serve a breakfast with a beginning and an end",
            owner: "Solstice Bell",
            intent:
              "Offer a reliable breakfast without trapping the kitchen in an eternal brunch.",
            successCriteria:
              "One service rehearsal finishes within a two-hour window, including cleanup.",
            evidence:
              "Fictional fixture: kitchen rehearsal notes report a looping toaster.",
            progress: 15,
            milestones: [
              { title: "Isolate the looping toaster", done: false },
              { title: "Test the shorter menu", done: false },
            ],
          }),
        ),
        entity(
          "sell-the-view",
          goalInput({
            title: "Sell the view without promising the meaning of life",
            owner: "Penny Perihelion",
            intent:
              "Publish an honest three-night offer with a bounded refund policy.",
            successCriteria:
              "A reviewed offer states what is included, what is accessible, and what happens if the horizon is cancelled.",
            evidence:
              "Fictional fixture: draft brochure promises more enlightenment than reception can support.",
            status: "paused",
            priority: "low",
          }),
        ),
      );
      for (const [id, fields] of [
        [
          "gravity-check",
          {
            title: "Test gravity in rooms 7 through 12",
            goalId: "reopen-east-wing",
            owner: "Ivo Null",
            status: "doing",
            priority: "high",
            notes:
              "Fictional work order. Use an unoccupied room and a tethered suitcase before inviting guests.",
          },
        ],
        [
          "find-404",
          {
            title: "Locate Room 404 before accepting another booking",
            goalId: "reopen-east-wing",
            owner: "Ivo Null",
            status: "blocked",
            notes:
              "Blocked by the corridor survey. The booking system's confidence is not evidence of a door.",
          },
        ],
        [
          "arrival-rehearsal",
          {
            title: "Rehearse a late arrival with one concierge",
            goalId: "reopen-east-wing",
            owner: "Solstice Bell",
            notes:
              "Check accessible entry, room directions, and escalation when the night bell rings backwards.",
          },
        ],
        [
          "toaster",
          {
            title: "Unplug the toaster from yesterday",
            goalId: "finite-breakfast",
            owner: "Ivo Null",
            status: "todo",
            priority: "high",
            notes:
              "Do not test with a guest's breakfast. Label the isolated socket.",
          },
        ],
        [
          "checklist",
          {
            title: "Agree the east-wing inspection checklist",
            goalId: "reopen-east-wing",
            owner: "Mabel Meridian",
            status: "done",
            notes:
              "Fictional completed fixture. Gravity, water, accessible route, and return path are required.",
          },
        ],
      ])
        s.tasks.push(entity(id, taskInput(fields)));
      s.settings={defaultOwner:'Mabel Meridian',purpose:brief.operatingPrinciple};
      for (const [id,fields] of [
        ['conference',{title:'The Conference That Already Happened',owner:'Mabel Meridian',contact:'Dr. Later, Society of Retrospective Planning',kind:'event',status:'qualified',valueCents:1200000,nextAction:'Confirm which April the conference intends to attend',followUpOn:'2032-04-03',goalId:'reopen-east-wing',notes:'Twenty delegates need a meeting room and a single agreed chronology.'}],
        ['wedding',{title:'Two Moons, One Wedding',owner:'Solstice Bell',contact:'The Bellweather party',kind:'booking',status:'proposed',valueCents:480000,nextAction:'Send a twelve-room proposal with one breakfast per guest',followUpOn:'2032-04-05',goalId:'finite-breakfast',notes:'The couple requests a sunset ceremony. Confirm which moon is responsible.'}],
        ['pillows',{title:'Portal-side pillow partnership',owner:'Penny Perihelion',contact:'Soft Landing Cooperative',kind:'partnership',status:'new',valueCents:160000,nextAction:'Compare the pillow trial price with the laundry budget',followUpOn:'2032-04-07',notes:'Supplier claims the pillows remember every dream. Request a washable sample.'}],
      ]) s.opportunities.push(entity(id,opportunityInput(fields)));
      // Seed admitted ideas before computing the Council evidence digest.
      s.ideas = s.opportunities.map(legacyIdea);
      s.financePlan=financePlanInput({openingCashCents:2000000,rooms:12,days:30,occupancy:35,rateCents:18000,variableCents:4500,fixedCents:1800000});
      for (const [id,fields] of [
        ['deposits',{title:'Opening weekend deposits',kind:'income',amountCents:300000,date:'2032-04-01',category:'Bookings',notes:'Three reservations. All guests currently exist.'}],
        ['gravity',{title:'Gravity stabilizer servicing',kind:'expense',amountCents:750000,date:'2032-04-01',category:'Maintenance',notes:'The invoice remained on the desk without assistance.'}],
        ['linen',{title:'Linen that respects linear time',kind:'expense',amountCents:120000,date:'2032-04-01',category:'Housekeeping',notes:'One purchase, one delivery, no recursive duvet covers.'}],
        ['pantry',{title:'Breakfast rehearsal supplies',kind:'expense',amountCents:48000,date:'2032-04-01',category:'Food',notes:'Toast is expensed only once.'}],
      ]) s.ledger.push(entity(id,entryInput(fields)));
      return {detail: "Loaded explicitly requested fictional demonstration records"};
    },
  );
  const packet = councilPacket(state);
  state = await store.transact(
    "LastResort",
    {
      requestId: randomUUID(),
      expectedRevision: state.revision,
      action: "council.publish",
    },
    async (s) =>
      publishCouncil(s, {
        contract: packet.contract,
        sessionId: packet.sessionId,
        evidenceDigest: packet.evidenceDigest,
        summary: await readFile(
          new URL("../demo/last-resort/opening-briefing.md", import.meta.url),
          "utf8",
        ),
        options: [
          {
            title: "Internal rehearsal before paid bookings",
            status: "active_candidate",
            rationale:
              "Tests service with a bounded group and no guest deposits.",
            evidence: "Fictional inspection checklist and staffing notes.",
          },
          {
            title: "Full reopening immediately",
            status: "rejected",
            rationale:
              "Missing room checks and an unresolved corridor make the promise premature.",
            evidence: "Fictional Room 404 work order.",
          },
        ],
        bundle: {
          contract: "vorton-local.recommendations.v1",
          profile: "LastResort",
          basedOnRevision: state.revision,
          recommendations: [
            {
              role: "CONCIERGE",
              kind: "task",
              rationale:
                "One rehearsal can expose staffing gaps before paid guests arrive.",
              tradeoffs: "Uses one shift and postpones brochure work.",
              confidence: "medium",
              evidence:
                "Authored fictional fixture: reception has not yet rehearsed the arrival sequence.",
              proposal: {
                title: "Run a twelve-guest opening rehearsal",
                goalId: "reopen-east-wing",
                owner: "Solstice Bell",
                notes:
                  "Proceed after room inspections pass. Record arrival time, access issues, and every request that needs a second person.",
              },
            },
          ],
        },
      }),
  );
  return state;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  seedDemo()
    .then((s) =>
      console.log(
        `Loaded fictional Last Resort fixtures at revision ${s.revision}.`,
      ),
    )
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
