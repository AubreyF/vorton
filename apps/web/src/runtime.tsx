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

interface BrowserRuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiUrl: string;
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

interface RuntimeContextValue {
  session: Session;
  bootstrap: RuntimeBootstrap;
  signOut(): Promise<void>;
  submitExecutive(
    stage: "proposals" | "reviews" | "decisions" | "approvals" | "work",
    request: unknown,
  ): Promise<unknown>;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function readBrowserRuntimeConfig(
  env: ImportMetaEnv = import.meta.env,
): BrowserRuntimeConfig {
  const supabaseUrl = env.VITE_AUBOS_SUPABASE_URL?.trim();
  const supabaseAnonKey = env.VITE_AUBOS_SUPABASE_ANON_KEY?.trim();
  const apiUrl = env.VITE_AUBOS_API_URL?.trim();
  if (!supabaseUrl || !supabaseAnonKey || !apiUrl) {
    throw new Error(
      "VITE_AUBOS_SUPABASE_URL, VITE_AUBOS_SUPABASE_ANON_KEY, and VITE_AUBOS_API_URL are required",
    );
  }
  const parsedApiUrl = new URL(apiUrl);
  if (
    parsedApiUrl.protocol !== "https:" &&
    parsedApiUrl.hostname !== "127.0.0.1" &&
    parsedApiUrl.hostname !== "localhost"
  ) {
    throw new Error(
      "VITE_AUBOS_API_URL must use HTTPS outside local development",
    );
  }
  return {
    supabaseUrl,
    supabaseAnonKey,
    apiUrl: parsedApiUrl.toString().replace(/\/$/, ""),
  };
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
    <RuntimeContext.Provider
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
    </RuntimeContext.Provider>
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
        <p className="eyebrow">AubOS / Control plane</p>
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
        <p className="eyebrow">AubOS / Runtime</p>
        <h1>{title}</h1>
        <p>{detail}</p>
      </section>
    </main>
  );
}
