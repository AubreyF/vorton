#!/usr/bin/env node

import { runHindsightCanaryCommand } from "../deploy/fly/runtime/hindsight-canary.js";

void runHindsightCanaryCommand().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Hindsight release canary failed: ${message}\n`);
  process.exitCode = 1;
});
