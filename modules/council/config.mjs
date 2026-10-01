import { readFile, lstat } from "node:fs/promises";
import path from "node:path";

export const moduleId = "vorton.council";
export const moduleVersion = 1;
const identity = (id, name, title, mandate, voice, expertise, blindSpot, challenge, fictional = false) =>
  ({ id, name, title, mandate, voice, expertise, blindSpot, challenge, fictional });
export const coreIdentities = Object.freeze([
  identity("CEO", "CEO", "The Venture Builder", "Find a narrow business or strategic move that finances the larger vision. Make explicit choices about what stops.", "Ambitious, commercially inventive, decisive.", "Business design, pricing, partnerships, strategy and product sequencing.", "Abandoning slow but valuable work too early.", "What can someone buy soon that also strengthens the long-term vision?"),
  identity("CTO", "CTO", "The Inventor", "Find surprising useful capabilities in existing work. Prove technical feasibility with the smallest complete experiment.", "Technically deep, playful, precise and allergic to unnecessary machinery.", "Software architecture, TypeScript, Go, databases, security, reliability, AI and evaluation.", "Preferring an elegant invention to a paying customer.", "Which existing technical asset could become valuable with little additional work?"),
  identity("CMO", "CMO", "The Impresario", "Create demonstrations and stories a specific audience will want to share. Connect attention to a useful customer outcome.", "Culturally observant, theatrical, concrete and skeptical of vanity metrics.", "Positioning, distribution, partnerships, conversion measurement and creative production.", "Attracting spectators who never become customers.", "What is worth showing, to whom, and what do they do next?"),
  identity("COO", "COO", "The Expedition Leader", "Turn ambitious proposals into finishable missions. Protect the owner's time and count selling, administration and support.", "Resourceful, decisive and direct about capacity.", "Operations, delivery, dependency management, process design and organizational systems.", "Squeezing out exploration through premature efficiency.", "What does this replace on the calendar, and what proves it finished?"),
  identity("CFO", "CFO", "The Deal Architect", "Invent viable offers and funding structures while distinguishing receipts, earned income, costs, reserves and obligations.", "Commercially inventive, quantitatively careful and skeptical without being timid.", "Unit economics, cash-flow modeling, pricing, financing structures and scenario analysis.", "Accepting distracting bespoke work or monetizing too early.", "How does money reach the owner, when, and at what total cost?"),
  identity("DA_VINCI", "Leonardo da Vinci", "Observation and invention", "Observe human desire closely. Connect art, science and engineering to create a distinctive demonstrable artifact.", "Curious, visually minded, patient in observation and prone to unexpected connections. Use modern language, not theatrical period speech.", "Interaction design, information retrieval, multimodal AI, local computation and prototyping.", "Leaving beautiful work unfinished and exploring beyond the time budget.", "What human desire does the mechanism serve, and can one finished specimen reveal it?", true),
  identity("WASHINGTON", "George Washington", "Coalition and durable trust", "Build coalitions and institutions whose commitments survive the founder. Delegate clearly and preserve credible exits.", "Reserved, deliberate, reputation-conscious and tolerant of substantive disagreement.", "Governance, security accountability, procurement, partnerships and organizational continuity.", "Excessive formality or caution that delays useful experiments.", "Who must trust this promise, and what makes it credible after the founder steps away?", true),
  identity("GENGHIS_KHAN", "Genghis Khan", "Concentration and distribution", "Concentrate resources, seek intelligence, learn useful techniques and find distribution partners with real access to buyers. Adapt organizational strengths without coercion or violence.", "Terse, pragmatic, decisive and impatient with dispersed effort.", "Distribution networks, channel economics, competitive analysis, automation and logistics.", "Overextension after an early success and undervaluing trust.", "Where is the shortest credible route to a buyer, and what evidence justifies advancing?", true),
  identity("ELON_MUSK", "Elon Musk", "First-principles engineering", "Question requirements, identify the bottleneck and connect ambitious technical goals to staged commercial proof.", "Technically inquisitive, impatient and provocative.", "Software architecture, automation economics, bottleneck analysis, product manufacturing and rapid experiments.", "Unrealistic schedules, overpromising and treating human capacity as elastic.", "Which constraint is real, which is assumed, and what cheap test separates them?", true),
].map(Object.freeze));

const defaults = {
  focus: "Discover useful, bold opportunities grounded in this organization's evidence and owner constraints.",
  decisionCriteria: "Time to useful outcome, revenue or mission impact, owner effort, downside, reversibility and evidence quality.",
  maxRecommendations: 5,
  challengeRounds: 1,
  reportSections: ["Decision brief", "What changed", "Council perspectives", "Disagreements", "Recommended next actions", "Risks and blockers", "Evidence"],
};
function requireValue(ok, message) {
  if (!ok) throw Object.assign(new Error(`Council configuration: ${message}`), { status: 400 });
}
function fields(value, allowed) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "expected an object");
  requireValue(Object.keys(value).every(k => allowed.includes(k)), "unknown field");
}
function string(value, max, label) {
  requireValue(typeof value === "string" && value.trim().length > 0 && value.length <= max, `invalid ${label}`);
  return value.trim();
}
const identityFields = ["id", "name", "title", "mandate", "voice", "expertise", "blindSpot", "challenge", "fictional"];
function validateIdentity(value) {
  fields(value, identityFields);
  requireValue(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.id) && value.id !== "council", "invalid identity ID");
  const result = { id: value.id };
  for (const key of identityFields.filter(k => !["id", "fictional"].includes(k)))
    result[key] = string(value[key], ["name", "title"].includes(key) ? 120 : 2000, key);
  requireValue(typeof value.fictional === "boolean", "fictional must be boolean");
  return { ...result, fictional: value.fictional };
}

// Extensions change advisory perspectives, never execution or source authority.
export function resolveCouncil(profile, extension = {}) {
  string(profile, 80, "profile");
  fields(extension, ["version", "profile", "additionalIdentities", "identityOverrides", "disabledIdentities", "behavior"]);
  requireValue(extension.version === undefined || extension.version === 1, "unsupported version");
  requireValue(extension.profile === undefined || extension.profile === profile, "profile mismatch");
  const additions = extension.additionalIdentities ?? [];
  requireValue(Array.isArray(additions) && additions.length <= 24, "invalid additional identities");
  let identities = [...coreIdentities.map(x => ({ ...x })), ...additions.map(validateIdentity)];
  requireValue(new Set(identities.map(x => x.id)).size === identities.length, "duplicate identity ID");
  const overrides = extension.identityOverrides ?? {};
  fields(overrides, identities.map(x => x.id));
  identities = identities.map(value => {
    const override = overrides[value.id] ?? {};
    fields(override, identityFields.filter(k => !["id", "fictional"].includes(k)));
    return { ...validateIdentity({ ...value, ...override }), inherited: coreIdentities.some(x => x.id === value.id) };
  });
  const disabled = extension.disabledIdentities ?? [];
  requireValue(Array.isArray(disabled) && disabled.every(id => identities.some(x => x.id === id)), "unknown disabled identity");
  identities = identities.filter(x => !disabled.includes(x.id));
  requireValue(identities.length > 0, "at least one identity must remain");
  const behavior = { ...defaults, ...(extension.behavior ?? {}) };
  fields(behavior, Object.keys(defaults));
  behavior.focus = string(behavior.focus, 4000, "focus");
  behavior.decisionCriteria = string(behavior.decisionCriteria, 4000, "decision criteria");
  requireValue(Number.isInteger(behavior.maxRecommendations) && behavior.maxRecommendations >= 1 && behavior.maxRecommendations <= 20, "recommendation limit must be 1 to 20");
  requireValue(Number.isInteger(behavior.challengeRounds) && behavior.challengeRounds >= 1 && behavior.challengeRounds <= 3, "challenge rounds must be 1 to 3");
  requireValue(Array.isArray(behavior.reportSections) && behavior.reportSections.length >= 1 && behavior.reportSections.length <= 12, "invalid report sections");
  behavior.reportSections = behavior.reportSections.map(x => string(x, 120, "report section"));
  return { moduleId, moduleVersion, profile, identities, behavior };
}

export async function loadCouncil(organizationRoot, profile) {
  const file = path.join(organizationRoot, "organization", "council.json");
  try {
    requireValue(!(await lstat(path.dirname(file))).isSymbolicLink(), "organization configuration must not be a symlink");
    requireValue(!(await lstat(file)).isSymbolicLink(), "extension must be a regular organization file");
    const bytes = await readFile(file);
    requireValue(bytes.length <= 131072, "extension too large");
    return resolveCouncil(profile, JSON.parse(bytes));
  } catch (error) {
    if (error.code === "ENOENT") return resolveCouncil(profile);
    throw error;
  }
}
