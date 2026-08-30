import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface BrowserRuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiUrl: string;
}

interface BrowserRuntimeConfigSource {
  supabaseUrl?: unknown;
  supabaseAnonKey?: unknown;
  apiUrl?: unknown;
}

export interface RuntimeBootstrap {
  installations: Array<{
    id: string;
    displayName: string;
    personKind: "owner" | "member";
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

export interface RuntimeContextValue {
  session: Session;
  bootstrap: RuntimeBootstrap;
  signOut(): Promise<void>;
  submitExecutive(
    stage: "proposals" | "reviews" | "decisions" | "approvals" | "work",
    request: unknown,
  ): Promise<unknown>;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

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
  const supabaseUrl = readRequiredString(source.supabaseUrl);
  const supabaseAnonKey = readRequiredString(source.supabaseAnonKey);
  const apiUrl = readRequiredString(source.apiUrl);
  if (!supabaseUrl || !supabaseAnonKey || !apiUrl) {
    throw new Error(
      "supabaseUrl, supabaseAnonKey, and apiUrl are required in the public runtime configuration",
    );
  }

  const parsedSupabaseUrl = parsePublicServiceUrl(supabaseUrl, "supabaseUrl");
  const parsedApiUrl = parsePublicServiceUrl(apiUrl, "apiUrl");
  return {
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
  const client = useMemo(
    () =>
      createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }),
    [config],
  );
  const [session, setSession] = useState<Session | null>();
  const [bootstrap, setBootstrap] = useState<RuntimeBootstrap>();
  const [runtimeError, setRuntimeError] = useState<string>();

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
    void getRuntimeBootstrap(config.apiUrl, session.access_token)
      .then(setBootstrap)
      .catch((error: unknown) =>
        setRuntimeError(
          error instanceof Error ? error.message : "Runtime bootstrap failed",
        ),
      );
  }, [config.apiUrl, session]);

  if (session === undefined)
    return (
      <RuntimeState
        title="Opening secure session"
        detail="Checking Supabase Auth."
      />
    );
  if (!session) return <SignIn client={client} />;
  if (runtimeError)
    return <RuntimeState title="Runtime unavailable" detail={runtimeError} />;
  if (!bootstrap)
    return (
      <RuntimeState
        title="Opening control plane"
        detail="Loading your accessible installation and governed Work."
      />
    );
  return (
    <RuntimeProvider
      value={{
        session,
        bootstrap,
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
      }}
    >
      {children}
    </RuntimeProvider>
  );
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

function SignIn({ client }: { client: SupabaseClient }) {
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
      <form onSubmit={(event) => void submit(event)}>
        <p className="eyebrow">Vorton / Control plane</p>
        <h1>Sign in</h1>
        <p>
          Supabase Auth verifies your identity. Roles describe competence. They
          grant no authority.
        </p>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
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
    </main>
  );
}

export function RuntimeState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <main className="runtime-gate">
      <section>
        <p className="eyebrow">Vorton / Runtime</p>
        <h1>{title}</h1>
        <p>{detail}</p>
      </section>
    </main>
  );
}
