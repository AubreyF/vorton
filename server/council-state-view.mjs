import { check } from "./store.mjs";

/** Keep a lightweight timeline; fetch older report bodies only on selection. */
export function councilStateView(state, { sessionId = null, fullHistory = false } = {}) {
  const sessions = state.councilSessions ?? [];
  if (sessionId !== null) check(sessions.some(session => session.id === sessionId), "Council session not found in this workspace", 404);
  if (fullHistory) return state;
  const recent = new Set(sessions.slice(-14).map(session => session.id));
  return { ...state, councilSessions: sessions.map(session => {
    if (recent.has(session.id) || session.id === sessionId) return session;
    const { council, options, summary, ...metadata } = session;
    return { ...metadata, summary: "", summaryDeferred: true };
  }) };
}
