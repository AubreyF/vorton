import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Compile the pure browser helper in memory so npm test also works on Node
// versions allowed by package.json that require a flag for native TypeScript.
const source = await readFile(new URL("../web/council-presentation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { getSessionVoices, councilReadingText } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

test("reading views omit legacy persona labels without changing substantive text or receipts", () => {
  assert.equal(councilReadingText("Fictional interpretation. Test the bottleneck.\n\n**Fictional interpretation:** Keep the evidence."), "Test the bottleneck.\n\nKeep the evidence.");
  assert.equal(councilReadingText("Discuss a fictional interpretation of the evidence."), "Discuss a fictional interpretation of the evidence.");
  const identities = [member("CEO")];
  const session = receipt("### CEO\n\nFictional interpretation. Test the bottleneck.", identities);
  const before = JSON.stringify(session);
  assert.equal(getSessionVoices(state(identities), session)[0].submission, "Test the bottleneck.");
  assert.equal(JSON.stringify(session), before);
});

const member = (id, name = id) => ({ id, name, title: "Fixture advisor", mandate: "This mandate is not a submission.", voice: "", expertise: "", blindSpot: "", challenge: "", fictional: false, inherited: false });
const council = (identities) => ({ moduleId: "fixture", moduleVersion: 1, profile: "FreedOS", identities, behavior: { focus: "", decisionCriteria: "", maxRecommendations: 10, challengeRounds: 2, reportSections: [] } });
const receipt = (summary, identities, recommendationIds = []) => ({ id: "fixture-session", status: "published", publishedAt: "2026-01-01T00:00:00Z", basedOnRevision: 1, evidenceDigest: "fixture", summary, recommendationIds, ...(identities ? { council: council(identities) } : {}) });
const state = (identities, recommendations = []) => ({ profile: "FreedOS", revision: 1, goals: [], tasks: [], recommendations, events: [], ...(identities ? { council: council(identities) } : {}) });
const recommendation = (id, role, rationale) => ({ id, role, rationale, status: "pending", proposal: { title: `Fixture ${id}` } });

test("extracts each saved opening contribution without adjacent identities or report sections", () => {
  const identities = [member("CEO"), member("DRAW", "Ada Example"), member("CFO")];
  const summary = "# Fixture council\n\n## Opening round\n\n### CEO: The builder\n\nFirst **saved** paragraph.\n\nSecond saved paragraph.\n\n### Ada Example: Observation\n\nA separate member's words.\n\n## Quantitative scenarios\n\n| Scenario | Cost |\n| --- | --- |\n| Test | 12 |\n\n## Risks\n\nShared risks.";
  const voices = getSessionVoices(state(identities), receipt(summary, identities));
  assert.deepEqual(voices.map((voice) => [voice.identity.id, voice.submission, voice.source]), [
    ["CEO", "First **saved** paragraph.\n\nSecond saved paragraph.", "session"],
    ["DRAW", "A separate member's words.", "session"],
    ["CFO", null, "missing"],
  ]);
  assert.equal(voices[2].sourceLabel, "No saved submission");
  assert.ok(voices.every((voice) => voice.rosterSource === "session"));
});

test("historical membership and names survive current configuration changes", () => {
  const historic = [member("DRAW", "Ada Example"), member("CEO")];
  const current = [member("DRAW", "New Name"), member("NEW")];
  const snapshot = state(current);
  const session = receipt("### Ada Example: Observation\n\nSaved observation.", historic);
  const before = JSON.stringify({ snapshot, session });
  const voices = getSessionVoices(snapshot, session);
  assert.deepEqual(voices.map((voice) => voice.identity.name), ["Ada Example", "CEO"]);
  assert.equal(voices[0].submission, "Saved observation.");
  assert.equal(JSON.stringify({ snapshot, session }), before);
});

test("recommendation fallback uses only this session and exact identity attribution", () => {
  const identities = [member("CEO"), member("CFO"), member("COO")];
  const recommendations = [recommendation("old", "CEO", "Unrelated earlier rationale."), recommendation("finance", "CFO", "Saved financial rationale."), recommendation("operations", "COO", "   ")];
  const voices = getSessionVoices(state(identities, recommendations), receipt("The CEO and CFO attended. No attributed sections were saved.", identities, ["finance", "operations"]));
  assert.equal(voices[0].submission, null);
  assert.equal(voices[1].submission, "Saved financial rationale.");
  assert.equal(voices[1].source, "recommendation");
  assert.equal(voices[1].sourceLabel, "Recommendation rationale");
  assert.deepEqual(voices[1].recommendations.map((item) => item.id), ["finance"]);
  assert.equal(voices[2].submission, null);
});

test("legacy roster fallback is explicit and does not claim a historical snapshot", () => {
  const identities = [member("CEO"), member("CFO")];
  const voices = getSessionVoices(state(identities), receipt("A legacy report.", undefined));
  assert.equal(voices.length, 2);
  assert.ok(voices.every((voice) => voice.rosterSource === "current" && voice.source === "missing"));
  const recorded = getSessionVoices(state(undefined, [recommendation("one", "ARCHIVIST", "Recorded rationale.")]), receipt("A legacy report.", undefined, ["one"]));
  assert.equal(recorded[0].identity.id, "ARCHIVIST");
  assert.equal(recorded[0].rosterSource, "recommendations");
  assert.equal(recorded[0].submission, "Recorded rationale.");
  assert.deepEqual(getSessionVoices(state(), receipt("No roster or recommendations.", undefined)), []);
});

test("prefixes, shared names, and generic mentions cannot establish attribution", () => {
  const identities = [member("CEO"), member("CFO"), member("ONE", "Shared Name"), member("TWO", "Shared Name")];
  const summary = "### CEOship: A topic\n\nNot the CEO.\n\n### Shared Name: Ambiguous\n\nCannot choose a member.\n\n### CFO and CEO\n\nJoint discussion.\n\n### **CFO**: Finance\n\nThe actual financial excerpt.\n\n### Unknown member: Another contribution\n\nNever append these words to the CFO.";
  const voices = getSessionVoices(state(identities), receipt(summary, identities));
  assert.equal(voices[0].submission, null);
  assert.equal(voices[1].submission, "The actual financial excerpt.");
  assert.equal(voices[2].submission, null);
  assert.equal(voices[3].submission, null);
});

test("code block headings cannot create submissions and repeated rounds keep the first excerpt", () => {
  const identities = [member("CEO"), member("CFO")];
  const summary = "```markdown\n### CFO: Example only\nNot a member submission.\n```\n\n### CEO: Opening\n\nSaved first contribution.\n\n## Challenge round\n\n### CEO: Challenge\n\nA later contribution.";
  const voices = getSessionVoices(state(identities), receipt(summary, identities));
  assert.equal(voices[0].submission, "Saved first contribution.");
  assert.equal(voices[1].submission, null);
});
