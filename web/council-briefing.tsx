"use client";

import "./workspace.css";
import { useEffect, useState } from "react";
import type { Profile, State } from "./types";
import { RoundtableBriefing } from "./council-views";
import { LoadingIndicator } from "./loading-indicator";

type BriefingResult = { profile: Profile; state?: State; error?: string };

export function CouncilBriefing({ profile }: { profile: Profile }) {
  const [result, setResult] = useState<BriefingResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const councilPath = `/${profile.toLowerCase()}/council`;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/${profile.toLowerCase()}/state`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const state = await response.json() as State;
        if (state.profile !== profile) throw new Error("The briefing belongs to a different workspace. Refresh to try again.");
        if (!controller.signal.aborted) setResult({ profile, state });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ profile, error: error instanceof Error ? error.message : "The briefing could not be loaded." });
      }
    }
    void load();
    return () => controller.abort();
  }, [profile, attempt]);

  // A profile switch must never briefly show the previous workspace's records.
  const current = result?.profile === profile ? result : null;
  return <div className="vorton-workspace council-briefing">
    {!current ? <LoadingIndicator compact label="Loading council briefing" detail={`Reading ${profile}'s latest saved session`} />
      : current.error ? <section className="panel" role="alert">
        <h2>Council briefing unavailable</h2>
        <p>{current.error}</p>
        <button type="button" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>Retry briefing</button>
      </section>
      : !current.state?.councilSessions?.length ? <section className="panel" aria-label="Council briefing">
        <h2>Your council briefing</h2>
        <p>No council sessions have been published for {profile} yet.</p>
        <p><a href={councilPath}>Open Council</a></p>
        <button type="button" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>Refresh briefing</button>
      </section>
      : <RoundtableBriefing state={current.state} />}
  </div>;
}
