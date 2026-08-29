import {
  CodexSubscriptionAdapter,
  OpenAIResponsesAdapter,
  type ExecutiveWorkerProvider,
} from "@aubos/workers";

import {
  dropRuntimePrivileges,
  prepareCodexRuntimeStorage,
} from "./codex-auth.js";
import { readWorkerEnvironment } from "./env.js";
import { createWorkerServer } from "./server.js";

async function createProvider(): Promise<{
  provider: ExecutiveWorkerProvider;
  port: number;
  release: string;
  secret: string;
}> {
  const env = readWorkerEnvironment();
  if (env.storeResponses) {
    throw new Error(
      "The stateless recommendation worker requires provider response storage to remain false",
    );
  }
  if (env.provider === "openai-responses") {
    dropRuntimePrivileges();
    return {
      provider: new OpenAIResponsesAdapter({
        model: env.model,
        apiKey: env.openAiApiKey,
        baseUrl: env.openAiBaseUrl,
        store: false,
        dataClassificationCeiling: env.classificationCeiling,
      }),
      port: env.port,
      release: env.release,
      secret: env.sharedSecret,
    };
  }

  await prepareCodexRuntimeStorage({
    codexHome: env.codexHome!,
    workdir: env.codexWorkdir!,
    authSeed: env.codexAuthJson,
  });
  delete process.env.AUBOS_CODEX_AUTH_JSON;
  dropRuntimePrivileges();
  return {
    provider: new CodexSubscriptionAdapter({
      model: env.model,
      reasoningEffort: env.codexReasoningEffort!,
      codexHome: env.codexHome!,
      codexPath: env.codexPath,
      cwd: env.codexWorkdir!,
      executionTimeoutMs: env.codexExecutionTimeoutMs!,
      dataClassificationCeiling: env.classificationCeiling,
    }),
    port: env.port,
    release: env.release,
    secret: env.sharedSecret,
  };
}

async function main(): Promise<void> {
  const runtime = await createProvider();
  const server = createWorkerServer({
    secret: runtime.secret,
    provider: runtime.provider,
    release: runtime.release,
  });

  server.listen(runtime.port, "::", () => {
    console.log(`AubOS worker listening on port ${String(runtime.port)}`);
  });

  async function shutdown(signal: string): Promise<void> {
    console.log(`AubOS worker received ${signal}`);
    server.close();
  }

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((error: unknown) => {
  console.error(
    "AubOS worker failed to start",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
});
