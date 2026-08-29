import { OpenAIResponsesAdapter } from "@aubos/workers";

import { readWorkerEnvironment } from "./env.js";
import { createWorkerServer } from "./server.js";

const env = readWorkerEnvironment();
if (env.storeResponses) {
  throw new Error(
    "The stateless recommendation worker requires AUBOS_OPENAI_STORE_RESPONSES=false",
  );
}
const provider = new OpenAIResponsesAdapter({
  model: env.model,
  apiKey: env.openAiApiKey,
  baseUrl: env.openAiBaseUrl,
  store: env.storeResponses,
  dataClassificationCeiling: env.classificationCeiling,
});
const server = createWorkerServer({
  secret: env.sharedSecret,
  provider,
  release: env.release,
});

server.listen(env.port, "0.0.0.0", () => {
  console.log(`AubOS worker listening on port ${String(env.port)}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`AubOS worker received ${signal}`);
  server.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
