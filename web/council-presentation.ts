import type { CouncilConfig, Recommendation, State } from "./types";

export type CouncilIdentity = CouncilConfig["identities"][number];
export type CouncilSession = NonNullable<State["councilSessions"]>[number];

/** Hide legacy persona labels in reading views without rewriting saved evidence. */
export function councilReadingText(text: string): string {
  return text
    .replace(/(^|\n)([ \t]*)(?:\*\*)?Fictional interpretation(?:\*\*)?[.:](?:\*\*)?[ \t]*/gi, "$1$2")
    .replace(/This is an explicitly fictional interpretation, not the person's advice\.[ \t]*/g, "")
    .trim();
}
export type CouncilVoice = {
  identity: CouncilIdentity;
  submission: string | null;
  source: "session" | "recommendation" | "missing";
  sourceLabel: string;
  rosterSource: "session" | "current" | "recommendations";
  recommendations: Recommendation[];
};

function headingIdentity(heading: string, identities: CouncilIdentity[]) {
  const label = heading.replace(/\*\*([^*]+)\*\*/g, "$1").trim().toLowerCase();
  const matches = identities.filter((identity) =>
    [identity.id, identity.name].some((name) => {
      const alias = name.trim().toLowerCase();
      return alias && (label === alias || (label.startsWith(alias) && label.slice(alias.length).trimStart().startsWith(":")));
    }),
  );
  // A shared display name cannot establish which member wrote a section.
  return matches.length === 1 ? matches[0] : undefined;
}

function savedSubmissions(summary: string, identities: CouncilIdentity[]) {
  const lines = summary.split("\n");
  const headings: { line: number; text: string }[] = [];
  let fence: { marker: string; length: number } | undefined;
  for (let line = 0; line < lines.length; line++) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[line]);
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
      else if (delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[line]);
    if (heading) headings.push({ line, text: heading[1] });
  }

  const submissions = new Map<string, string>();
  headings.forEach((heading, index) => {
    const identity = headingIdentity(heading.text, identities);
    if (!identity || submissions.has(identity.id)) return;
    // Keep the first explicitly attributed excerpt exactly as saved. Every
    // heading ends it, including unknown identities and unrelated report sections.
    const submission = lines.slice(heading.line + 1, headings[index + 1]?.line ?? lines.length).join("\n").trim();
    if (submission) submissions.set(identity.id, submission);
  });
  return submissions;
}

function recordedIdentity(id: string): CouncilIdentity {
  return { id, name: id, title: "", mandate: "", voice: "", expertise: "", blindSpot: "", challenge: "", fictional: false, inherited: false };
}

/** Derive display content without modifying receipts or inventing member quotes. */
export function getSessionVoices(state: State, session: CouncilSession): CouncilVoice[] {
  const recommendationIds = new Set(session.recommendationIds);
  const recommendations = state.recommendations.filter((recommendation) => recommendationIds.has(recommendation.id));
  const rosterSource = session.council ? "session" : state.council ? "current" : "recommendations";
  // Saved identities preserve the session's names and membership across later
  // configuration changes. A legacy receipt's fallback is explicitly identified.
  const identities = session.council?.identities ?? state.council?.identities ?? [...new Set(recommendations.map((recommendation) => recommendation.role))].map(recordedIdentity);
  const submissions = savedSubmissions(session.summary, identities);
  return identities.map((identity) => {
    const related = recommendations.filter((recommendation) => recommendation.role === identity.id);
    const saved = submissions.get(identity.id);
    const rationale = related.find((recommendation) => recommendation.rationale.trim())?.rationale;
    const source = saved ? "session" : rationale ? "recommendation" : "missing";
    return {
      identity,
      submission: saved || rationale ? councilReadingText(saved ?? rationale!) : null,
      source,
      sourceLabel: source === "session" ? "Session submission" : source === "recommendation" ? "Recommendation rationale" : "No saved submission",
      rosterSource,
      recommendations: related,
    };
  });
}
