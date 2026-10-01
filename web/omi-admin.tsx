import React, { useEffect, useState, type FormEvent } from "react";
import "./omi-admin.css";
import { AdminSave } from "./admin-save";

type Run = { status: string; code?: string; pages: number; fetched: number; changed: number; excluded: number; finishedAt?: string; coverage: string };
type Status = { revision: number; enabled: boolean; councilEnabled: boolean; keyConfigured: boolean; historyCount: number; folder: string | null; retryAt: string | null; lastRun: Run | null; connectionVerifiedAt?: string; backfill?: { status: string; offset: number } | null; pendingReviewCount?: number; newestConversationAt?: string; councilFailure?: { at: string; code: string } | null; lastCouncil?: { publishedAt: string; conversationCount: number; pageCount: number } | null };
type History = { total: number; records: { id: string; title: string; createdAt: string; segmentCount: number; version: number }[] };
type Transcript = { record: { title: string; segments: { text: string; speaker_name: string | null; start: number }[] } };

function yesterday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Reuses the shared workspace panel/forms. No secret is saved in browser storage. */
export function OmiAdmin({ profile, token }: { profile: string; token: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState("");
  const [sameAccount, setSameAccount] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [council, setCouncil] = useState(true);
  const [folder, setFolder] = useState("");
  const [day, setDay] = useState(yesterday);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [offset, setOffset] = useState(0);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const endpoint = `/api/${profile.toLowerCase()}/integrations/omi`;
  async function request<T>(suffix = "", body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(endpoint + suffix, { method: body ? "POST" : "GET", cache: "no-store", signal,
      headers: { "X-Vorton-Session": token, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Omi request could not be completed.");
    return result;
  }
  function apply(value: Status) { setStatus(value); setEnabled(value.enabled); setCouncil(value.councilEnabled); setFolder(value.folder ?? ""); }
  useEffect(() => {
    const controller = new AbortController();
    request<Status>("", undefined, controller.signal).then(apply).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [profile, token]);
  async function act(label: string, body: object) {
    if (busy) return;
    setBusy(label); setError(""); setMessage("");
    try {
      const result = await request<{ status?: string; code?: string }>("", body);
      apply(await request<Status>());
      setMessage(result.status === "failed" ? `Synchronization stopped: ${result.code}. Retained history is available.` : label === "Save changes" ? "Changes saved." : `${label} finished.`);
      setHistory(null); setTranscript(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); setKey(""); }
  }
  async function loadHistory(next: number) {
    setError("");
    try { setHistory(await request<History>(`/history?offset=${next}`)); setOffset(next); setTranscript(null); }
    catch (e) { setError((e as Error).message); }
  }
  const saveKey = (event: FormEvent) => { event.preventDefault(); void act("Save changes", { action: "save", key, expectedRevision: status?.revision, sameAccount, enabled, councilEnabled: council, folder: folder.trim() || null }); };
  const dirty = status && (Boolean(key) || enabled !== status.enabled || council !== status.councilEnabled || (folder.trim() || null) !== status.folder);
  const time = (value?: string) => value ? new Date(value).toLocaleString() : "Not yet";
  return <section className="omi-admin" aria-labelledby="omi-heading" aria-busy={Boolean(busy)}>
    <h2 id="omi-heading" className="sr-only">Omi conversation intelligence</h2>
    {error && <p role="alert" className="error">{error}</p>}
    {(busy || message) && <p role="status">{busy ? `${busy} in progress…` : message}</p>}
    {!status ? <p>Loading Omi settings…</p> : <>
      <div className="omi-overview" aria-label="Omi status">
        <div><span className="omi-caption">Connection</span><strong>{!status.keyConfigured ? "Not connected" : ["http_401", "http_403"].includes(status.lastRun?.code ?? "") ? "Access needs attention" : "Connected"}</strong><span>{status.keyConfigured ? `Verified ${time(status.connectionVerifiedAt)}` : "Add your Developer key below"}</span></div>
        <div><span className="omi-caption">Conversation archive</span><strong>{status.historyCount.toLocaleString()}</strong><span>{status.backfill?.status === "pending" ? "Historical catch-up in progress" : "Conversations retained securely"}</span></div>
        <div><span className="omi-caption">Daily Council</span><strong>{!status.councilEnabled ? "Paused" : status.councilFailure ? "Needs attention" : status.lastCouncil ? "Review recorded" : "Awaiting first review"}</strong><span>Pending review: {(status.pendingReviewCount ?? status.historyCount).toLocaleString()}</span></div>
      </div>
      {status.councilFailure && <p role="status" className="omi-notice">The last Council review was not published. Conversation evidence remains queued. Check the Council workflow's failure receipt before retrying.</p>}
      <form onSubmit={saveKey} className="panel omi-settings" aria-label="Omi settings">
        <header><h2>Connection & preferences</h2><p>Choose what this workspace receives and shares with its daily Council.</p></header>
        <fieldset disabled={Boolean(busy)}>
        <div className="omi-setting"><div><h3>Developer key</h3><p>{status.keyConfigured ? "Your key is saved securely. Leave this blank to keep it." : "Connect your Omi account with a Developer key."}</p></div><div>
        <label htmlFor="omi-key">{status.keyConfigured ? "Replace Developer key" : "Omi Developer key"}</label><input id="omi-key" aria-label="Omi Developer key" type="password" name="omi-developer-key" autoComplete="new-password" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} placeholder={status.keyConfigured ? "Enter a replacement key" : "omi_dev_…"} />
        {key && status.historyCount > 0 && <label className="omi-check"><input type="checkbox" checked={sameAccount} onChange={e => setSameAccount(e.target.checked)} />This key belongs to the same Omi account as the retained history.</label>}
        <details className="omi-help"><summary>Where to get a Developer key</summary>
        <p>Generate your key in the <a href="https://app.omi.me" target="_blank" rel="noopener noreferrer">Omi web app</a>: sign in to the account you want to connect, open <strong>Developer → API Keys</strong>, and create a dedicated Vorton key with only <code>conversations:read</code> selected.</p>
        <p className="quiet">Copy the new key immediately and paste it below. Omi shows the secret only once. If you no longer have an existing key, create a replacement and revoke the old key in Omi. Use a Developer key beginning with omi_dev_, not an MCP key. <a href="https://docs.omi.me/doc/developer/api/overview" target="_blank" rel="noopener noreferrer">Official Omi key instructions</a></p>
        <p className="quiet">Vorton only reads conversations. Read validation does not prove that broader key permissions are absent.</p>
        </details></div></div>
        <div className="omi-setting"><div><h3>Automatic synchronization</h3><p>Retrieve conversations when the existing Council workflow runs, with catch-up for late arrivals.</p></div><label className="omi-check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={!status.keyConfigured && !key} />Enable Omi synchronization</label></div>
        <div className="omi-setting"><div><h3>Council evidence</h3><p>Let the selected Council model review conversations and propose recommendations. Nothing is accepted automatically.</p></div><label className="omi-check"><input type="checkbox" checked={council} onChange={e => setCouncil(e.target.checked)} />Include Omi evidence in daily Council reviews</label></div>
        <div className="omi-setting"><div><h3>Conversation scope</h3><p>Leave blank to retrieve across your Omi account. A folder limits retrieval, not the key's permissions.</p></div><div><label htmlFor="omi-folder">Folder ID, optional</label><input id="omi-folder" value={folder} onChange={e => setFolder(e.target.value)} maxLength={200} placeholder="All folders" /></div></div>
        </fieldset>
        <AdminSave busy={busy === "Save changes"} disabled={Boolean(busy) || !dirty || (Boolean(key) && status.historyCount > 0 && !sameAccount)}>{dirty ? "Unsaved changes" : "All changes saved"}</AdminSave>
      </form>
      <section className="panel omi-sync"><header><h2>Synchronization</h2><p>{status.lastRun?.status === "running" ? "Synchronization is running. Completed pages are retained as it progresses." : status.lastRun?.status === "failed" ? "The last sync stopped. Retained conversations are still available." : status.lastRun?.code === "request_budget" ? "Catch-up is in progress. More pages remain to be checked." : status.lastRun ? "The last scan finished. Omi source coverage remains unverified." : "No conversations have been synchronized yet."}</p></header>
      <dl className="omi-run"><div><dt>Last sync</dt><dd>{time(status.lastRun?.finishedAt)}</dd></div><div><dt>Retrieved</dt><dd>{status.lastRun?.fetched ?? 0}</dd></div><div><dt>Updated</dt><dd>{status.lastRun?.changed ?? 0}</dd></div><div><dt>Excluded</dt><dd>{status.lastRun?.excluded ?? 0}</dd></div></dl>
      <p className="quiet">Newest retained conversation: {time(status.newestConversationAt)}. New recordings become available after Omi uploads and completes them.</p>
      <button disabled={Boolean(busy) || !status.enabled || Boolean(dirty)} onClick={() => void act("Sync recent conversations", { action: "sync", day: yesterday(), mode: "recent" })}>Sync now</button>
      {status.retryAt && <p role="status">Next permitted retry: {new Date(status.retryAt).toLocaleString()}.</p>}
      <details className="omi-help"><summary>Catch-up & replay</summary>
      <div className="actions">
        <label>Pacific day<input type="date" value={day} onChange={e => setDay(e.target.value)} disabled={Boolean(busy)} /></label>
        <button disabled={Boolean(busy) || !status.enabled || !day} onClick={() => void act("Backfill history", { action: "sync", day, mode: "backfill" })}>Continue historical backfill</button>
        <button disabled={Boolean(busy) || !status.enabled || !day} onClick={() => void act("Replay selected day", { action: "sync", day, mode: "replay" })}>Replay selected day</button>
      </div>
      <p className="quiet">Omi can filter records after pagination. A stopped scan is not proof that every account record was returned. Coverage limitations remain visible to the Council.</p>
      </details></section>
      <section className="panel omi-history"><header><h2>Retained history</h2><p>Encrypted in this {profile} installation until you delete it. Your recording consent practices apply. Model-provider retention is separate.</p></header>
      {status.lastCouncil && <p>Last confirmed Council review: {time(status.lastCouncil.publishedAt)}. {status.lastCouncil.conversationCount} conversations across {status.lastCouncil.pageCount} evidence pages.</p>}
      <button disabled={Boolean(busy)} onClick={() => void loadHistory(0)}>Browse retained history</button>
      {history && <div><p>{history.total} retained conversations</p><ul>{history.records.map(record => <li key={record.id}><button onClick={async () => { try { setTranscript(await request<Transcript>(`/transcript?id=${encodeURIComponent(record.id)}`)); } catch (e) { setError((e as Error).message); } }}>{record.title}</button> <span>{new Date(record.createdAt).toLocaleString()} · {record.segmentCount} segments · version {record.version}</span></li>)}</ul>
        <div className="actions"><button disabled={offset === 0} onClick={() => void loadHistory(Math.max(0, offset - 25))}>Previous</button><button disabled={offset + 25 >= history.total} onClick={() => void loadHistory(offset + 25)}>Next</button></div></div>}
      {transcript && <article aria-label="Retained transcript"><h3>{transcript.record.title}</h3>{transcript.record.segments.map((segment, index) => <p key={index}><strong>{segment.speaker_name || "Speaker"}</strong> {segment.text}</p>)}<button onClick={() => setTranscript(null)}>Close transcript</button></article>}
      <details className="omi-help"><summary>Disconnect or delete history</summary>
      {status.keyConfigured && <><p>Disconnecting removes the saved key and stops synchronization. Retained history stays available. Revoke the key in Omi to invalidate it there.</p><button disabled={Boolean(busy)} onClick={() => void act("Remove key", { action: "key.remove", expectedRevision: status.revision })}>Disconnect Omi</button></>}
      <p>Delete this workspace's local transcript history. Omi cloud records and existing Council reports are kept. Backups must be handled separately. Disable synchronization first.</p><label>Type DELETE OMI HISTORY<input value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label><button disabled={Boolean(busy) || status.enabled || confirmation !== "DELETE OMI HISTORY"} onClick={() => void act("Delete history", { action: "history.delete", expectedRevision: status.revision, confirmation })}>Delete local Omi history</button></details>
      </section>
    </>}
  </section>;
}
