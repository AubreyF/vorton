import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { BackgroundAtmosphere } from "./design-system/background-atmosphere.js";
import { AppearanceTileStrip } from "./design-system/theme-controls.js";

export interface BrowserRuntimeConfig {
  installationSlug: string;
  installationName: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiUrl: string;
}

interface BrowserRuntimeConfigSource {
  installationSlug?: unknown;
  installationNameBase64?: unknown;
  supabaseUrl?: unknown;
  supabaseAnonKey?: unknown;
  apiUrl?: unknown;
}

export interface RuntimeBootstrap {
  installations: Array<{
    id: string;
    slug: string;
    displayName: string;
    personKind: "owner" | "member";
    workItems: Array<{
      id: string;
      title: string;
      requestedOutcome: string;
      acceptanceCriteria: string[];
      state:
        | "proposed"
        | "ready"
        | "leased"
        | "blocked"
        | "review"
        | "completed"
        | "cancelled";
      priority: number;
      parentWorkId: string | null;
      custodianName: string | null;
      custodianKind: "person" | "worker" | null;
      updatedAt: string;
    }>;
    proposalBindings: Array<{
      workId: string;
      workTitle: string;
      workerId: string;
      workerName: string;
      roleId: string;
      roleName: string;
      evidence: Array<{ id: string; summary: string; classification: string }>;
    }>;
  }>;
}

export type CouncilPhase = "proposal" | "review" | "synthesis" | "complete";

export interface CouncilRecord {
  id: string;
  kind: "proposal" | "review";
  summary: string;
  actorWorkerId: string;
  recommendation: {
    summary: string;
    evidenceRecordIds: string[];
    alternatives: Array<{
      title: string;
      description: string;
      expectedOutcome: string;
      risks: string[];
    }>;
    recommendedAction: {
      title: string;
      description: string;
      capability: string;
      mode: string;
      externalEffect: boolean;
    };
    confidence: number;
    uncertainties: string[];
  };
  phase: Exclude<CouncilPhase, "complete">;
  roleId: string;
  inputRecordIds: string[];
  peerRecordIds: string[];
  providerJob: {
    id: string;
    provider: string;
    model: string;
    store: boolean;
    background: boolean;
  };
}

export interface ExecutiveCouncilState {
  protocol: "vorton.executive-council.v1";
  installationId: string;
  work: {
    id: string;
    title: string;
    requestedOutcome: string;
    acceptanceCriteria: string[];
    state: string;
  };
  authority: "none";
  phase: CouncilPhase;
  nextStep: null | {
    phase: Exclude<CouncilPhase, "complete">;
    roleId: string;
    roleName: string;
  };
  counts: {
    proposals: number;
    reviews: number;
    syntheses: number;
    total: number;
    required: number;
  };
  roles: Array<{
    roleId: string;
    workerId: string;
    name: string;
    version: number;
    status: "awaiting_proposal" | "awaiting_review" | "complete";
    proposal: CouncilRecord | null;
    review: CouncilRecord | null;
  }>;
  synthesis: CouncilRecord | null;
}

export interface RuntimeContextValue {
  session: Session;
  bootstrap: RuntimeBootstrap;
  signOut(): Promise<void>;
  submitExecutive(
    stage: "proposals" | "reviews" | "decisions" | "approvals" | "work",
    request: unknown,
  ): Promise<unknown>;
  refreshBootstrap(): Promise<void>;
  getExecutiveCouncil(
    workId: string,
    installationId: string,
  ): Promise<ExecutiveCouncilState>;
  installExecutiveCouncil(
    workId: string,
    installationId: string,
  ): Promise<ExecutiveCouncilState>;
  advanceExecutiveCouncil(
    workId: string,
    installationId: string,
  ): Promise<ExecutiveCouncilState>;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);
let browserRuntimeClient: { key: string; client: SupabaseClient } | undefined;

function getBrowserRuntimeClient(config: BrowserRuntimeConfig) {
  const key = `${config.supabaseUrl}\n${config.supabaseAnonKey}`;
  if (browserRuntimeClient?.key === key) return browserRuntimeClient.client;
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  browserRuntimeClient = { key, client };
  return client;
}

export function RuntimeProvider({
  value,
  children,
}: {
  value: RuntimeContextValue;
  children: ReactNode;
}) {
  return (
    <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
  );
}

export function readBrowserRuntimeConfig(
  source: BrowserRuntimeConfigSource = readInjectedRuntimeConfig(),
): BrowserRuntimeConfig {
  const installationSlug = readInstallationSlug(source.installationSlug);
  const installationName = readInstallationName(source.installationNameBase64);
  const supabaseUrl = readRequiredString(source.supabaseUrl);
  const supabaseAnonKey = readRequiredString(source.supabaseAnonKey);
  const apiUrl = readRequiredString(source.apiUrl);
  if (
    !installationSlug ||
    !installationName ||
    !supabaseUrl ||
    !supabaseAnonKey ||
    !apiUrl
  ) {
    throw new Error(
      "installationSlug, installationNameBase64, supabaseUrl, supabaseAnonKey, and apiUrl are required in the public runtime configuration",
    );
  }

  const parsedSupabaseUrl = parsePublicServiceUrl(supabaseUrl, "supabaseUrl");
  const parsedApiUrl = parsePublicServiceUrl(apiUrl, "apiUrl");
  return {
    installationSlug,
    installationName,
    supabaseUrl: normalizeServiceUrl(parsedSupabaseUrl),
    supabaseAnonKey,
    apiUrl: normalizeServiceUrl(parsedApiUrl),
  };
}

function readInjectedRuntimeConfig(): BrowserRuntimeConfigSource {
  const value = (
    globalThis as typeof globalThis & {
      __VORTON_RUNTIME_CONFIG__?: unknown;
    }
  ).__VORTON_RUNTIME_CONFIG__;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Public runtime configuration is unavailable");
  }
  return value as BrowserRuntimeConfigSource;
}

function readRequiredString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function readInstallationSlug(value: unknown): string | undefined {
  const slug = readRequiredString(value);
  if (!slug) return undefined;
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
    throw new Error(
      "installationSlug must begin with a lowercase letter and contain only lowercase letters, numbers, and hyphens",
    );
  }
  return slug;
}

function readInstallationName(value: unknown): string | undefined {
  const encoded = readRequiredString(value);
  if (!encoded) return undefined;
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  ) {
    throw new Error("installationNameBase64 must be valid base64");
  }
  let name: string;
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) =>
      character.charCodeAt(0),
    );
    name = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    throw new Error("installationNameBase64 must contain valid UTF-8 text");
  }
  if (!name || Array.from(name).length > 120) {
    throw new Error("installationName must contain 1 to 120 characters");
  }
  return name;
}

function parsePublicServiceUrl(value: string, field: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }
  const localDevelopment =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !localDevelopment) {
    throw new Error(`${field} must use HTTPS outside local development`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      `${field} must not contain credentials, a query, or a hash`,
    );
  }
  return parsed;
}

function normalizeServiceUrl(value: URL): string {
  return value.toString().replace(/\/$/, "");
}

export function BrowserRuntime({
  config,
  children,
}: {
  config: BrowserRuntimeConfig;
  children: ReactNode;
}) {
  const client = getBrowserRuntimeClient(config);
  const [session, setSession] = useState<Session | null>();
  const [bootstrap, setBootstrap] = useState<RuntimeBootstrap>();
  const [runtimeError, setRuntimeError] = useState<string>();

  useEffect(() => {
    document.title = config.installationName;
  }, [config.installationName]);

  const refreshBootstrap = useCallback(async () => {
    if (!session) return;
    setRuntimeError(undefined);
    try {
      setBootstrap(
        await getRuntimeBootstrap(config.apiUrl, session.access_token),
      );
    } catch (error) {
      setRuntimeError(
        error instanceof Error ? error.message : "Runtime bootstrap failed",
      );
    }
  }, [config.apiUrl, session]);

  useEffect(() => {
    void client.auth.getSession().then(({ data, error }) => {
      if (error) setSession(null);
      else setSession(data.session);
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) =>
      setSession(nextSession),
    );
    return () => data.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    if (!session) {
      setBootstrap(undefined);
      return;
    }
    void refreshBootstrap();
  }, [refreshBootstrap, session]);

  if (session === undefined)
    return (
      <RuntimeState
        installationName={config.installationName}
        title="Opening secure session"
        detail="Checking Supabase Auth."
      />
    );
  if (!session)
    return (
      <SignIn client={client} installationName={config.installationName} />
    );
  if (runtimeError)
    return (
      <RuntimeState
        installationName={config.installationName}
        title="Runtime unavailable"
        detail={runtimeError}
        actions={
          <>
            <button type="button" onClick={() => void refreshBootstrap()}>
              Retry
            </button>
            <button type="button" onClick={() => void client.auth.signOut()}>
              Sign out
            </button>
          </>
        }
      />
    );
  if (!bootstrap)
    return (
      <RuntimeState
        installationName={config.installationName}
        title="Opening control plane"
        detail="Loading your accessible installation and governed Work."
      />
    );
  const installation = bootstrap.installations.find(
    (candidate) => candidate.slug === config.installationSlug,
  );
  if (!installation)
    return (
      <RuntimeState
        installationName={config.installationName}
        title="Installation unavailable"
        detail={`Your account does not have access to ${config.installationName}.`}
        actions={
          <button type="button" onClick={() => void client.auth.signOut()}>
            Sign out
          </button>
        }
      />
    );
  if (installation.displayName !== config.installationName)
    return (
      <RuntimeState
        installationName={config.installationName}
        title="Installation configuration mismatch"
        detail="The deployed installation identity does not match its authoritative record."
        actions={
          <button type="button" onClick={() => void client.auth.signOut()}>
            Sign out
          </button>
        }
      />
    );
  return (
    <RuntimeProvider
      value={{
        session,
        bootstrap: { installations: [installation] },
        signOut: async () => {
          await client.auth.signOut();
        },
        submitExecutive: (stage, request) =>
          postExecutiveRequest(
            config.apiUrl,
            session.access_token,
            stage,
            request,
          ),
        refreshBootstrap,
        getExecutiveCouncil: (workId, installationId) =>
          getExecutiveCouncil(
            config.apiUrl,
            session.access_token,
            workId,
            installationId,
          ),
        installExecutiveCouncil: (workId, installationId) =>
          installExecutiveCouncil(
            config.apiUrl,
            session.access_token,
            workId,
            installationId,
          ),
        advanceExecutiveCouncil: (workId, installationId) =>
          advanceExecutiveCouncil(
            config.apiUrl,
            session.access_token,
            workId,
            installationId,
          ),
      }}
    >
      {children}
    </RuntimeProvider>
  );
}

export async function getExecutiveCouncil(
  apiUrl: string,
  accessToken: string,
  workId: string,
  installationId: string,
  requestFetch: typeof fetch = fetch,
): Promise<ExecutiveCouncilState> {
  const query = new URLSearchParams({ installationId });
  return requestCouncilState(
    `${apiUrl}/v1/executive/councils/${encodeURIComponent(workId)}?${query.toString()}`,
    accessToken,
    undefined,
    requestFetch,
  );
}

export async function installExecutiveCouncil(
  apiUrl: string,
  accessToken: string,
  workId: string,
  installationId: string,
  requestFetch: typeof fetch = fetch,
): Promise<ExecutiveCouncilState> {
  return requestCouncilState(
    `${apiUrl}/v1/executive/councils/${encodeURIComponent(workId)}/install`,
    accessToken,
    installationId,
    requestFetch,
  );
}

export async function advanceExecutiveCouncil(
  apiUrl: string,
  accessToken: string,
  workId: string,
  installationId: string,
  requestFetch: typeof fetch = fetch,
): Promise<ExecutiveCouncilState> {
  return requestCouncilState(
    `${apiUrl}/v1/executive/councils/${encodeURIComponent(workId)}/advance`,
    accessToken,
    installationId,
    requestFetch,
  );
}

async function requestCouncilState(
  url: string,
  accessToken: string,
  installationId: string | undefined,
  requestFetch: typeof fetch,
): Promise<ExecutiveCouncilState> {
  const response = await requestFetch(url, {
    ...(installationId
      ? {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ installationId }),
        }
      : { headers: { authorization: `Bearer ${accessToken}` } }),
  });
  const payload = (await response.json()) as
    ExecutiveCouncilState | { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const message =
      "error" in payload && payload.error?.message
        ? payload.error.message
        : `Executive council API rejected the request with HTTP ${String(response.status)}`;
    throw new Error(message);
  }
  return payload as ExecutiveCouncilState;
}

export async function getRuntimeBootstrap(
  apiUrl: string,
  accessToken: string,
  requestFetch: typeof fetch = fetch,
): Promise<RuntimeBootstrap> {
  const response = await requestFetch(`${apiUrl}/v1/runtime/bootstrap`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(
      `Runtime bootstrap failed with HTTP ${String(response.status)}`,
    );
  }
  return (await response.json()) as RuntimeBootstrap;
}

export async function postExecutiveRequest(
  apiUrl: string,
  accessToken: string,
  stage: "proposals" | "reviews" | "decisions" | "approvals" | "work",
  request: unknown,
  requestFetch: typeof fetch = fetch,
): Promise<unknown> {
  const response = await requestFetch(`${apiUrl}/v1/executive/${stage}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(
      `Executive API rejected the request with HTTP ${String(response.status)}`,
    );
  }
  return payload;
}

export function useBrowserRuntime(): RuntimeContextValue {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error("Browser runtime context is unavailable");
  return value;
}

export function SignIn({
  client,
  installationName,
}: {
  client: SupabaseClient;
  installationName: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error) setError(result.error.message);
  }
  return (
    <main className="runtime-gate">
      <BackgroundAtmosphere />
      <form
        data-installation-name={installationName}
        onSubmit={(event) => void submit(event)}
      >
        <p className="eyebrow">{installationName} / Control plane</p>
        <h1>Sign in to {installationName}</h1>
        <p>
          Supabase Auth verifies your identity. Roles describe competence. They
          grant no authority.
        </p>
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="runtime-gate__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit">Sign in</button>
      </form>
      <AppearanceTileStrip className="login-theme-switcher" />
    </main>
  );
}

export function RuntimeState({
  installationName,
  title,
  detail,
  actions,
}: {
  installationName: string;
  title: string;
  detail: string;
  actions?: ReactNode;
}) {
  return (
    <main className="runtime-gate">
      <BackgroundAtmosphere />
      <section data-installation-name={installationName}>
        <p className="eyebrow">{installationName} / Runtime</p>
        <h1>{title}</h1>
        <p>{detail}</p>
        {actions ? (
          <div className="runtime-gate__actions">{actions}</div>
        ) : null}
      </section>
    </main>
  );
}
