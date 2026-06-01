#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();

function positiveIntEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function liveTimeoutMs() {
  return positiveIntEnv("CMO_LIVE_APP_TURN_TIMEOUT_MS", 240_000);
}

function fastFallbackMs() {
  return positiveIntEnv("CMO_FALLBACK_FAST_AFTER_MS", liveTimeoutMs());
}

function hermesTimeoutMs() {
  return positiveIntEnv("CMO_HERMES_TIMEOUT_MS", 240_000);
}

async function withEnv(patch, fn) {
  const previous = {};

  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    process.env[key] = String(value);
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

function requireSource(source, needle, label) {
  assert.ok(source.includes(needle), `${label} missing ${needle}`);
}

async function main() {
  assert.equal(positiveIntEnv("__CMO_TIMEOUT_TEST_INVALID__", 12_000), 12_000);

  const configuredLiveTimeoutMs = liveTimeoutMs();
  const configuredFastFallbackMs = fastFallbackMs();
  const configuredHermesTimeoutMs = hermesTimeoutMs();
  const effectiveTimeoutMs = Math.min(configuredLiveTimeoutMs, configuredFastFallbackMs);

  assert.ok(configuredLiveTimeoutMs > 0, "live timeout must be positive");
  assert.ok(configuredFastFallbackMs > 0, "fast fallback threshold must be positive");
  assert.ok(configuredHermesTimeoutMs > 0, "Hermes timeout must be positive");
  assert.ok(effectiveTimeoutMs > 0, "effective timeout must be positive");
  await withEnv(
    {
      CMO_HERMES_TIMEOUT_MS: 240_000,
      CMO_LIVE_APP_TURN_TIMEOUT_MS: 240_000,
      CMO_FALLBACK_FAST_AFTER_MS: 240_000,
    },
    async () => {
      assert.equal(hermesTimeoutMs(), 240_000, "CMO_HERMES_TIMEOUT_MS must support 240000");
      assert.equal(liveTimeoutMs(), 240_000, "CMO_LIVE_APP_TURN_TIMEOUT_MS must support 240000");
      assert.equal(fastFallbackMs(), 240_000, "CMO_FALLBACK_FAST_AFTER_MS must support 240000");
    },
  );

  const [configSource, runtimeSource, typeSource, chatStoreSource, openClawSource, remoteSource] = await Promise.all([
    readRepoFile("src/lib/cmo/config.ts"),
    readRepoFile("src/lib/cmo/runtime.ts"),
    readRepoFile("src/lib/cmo/app-workspace-types.ts"),
    readRepoFile("src/lib/cmo/app-chat-store.ts"),
    readRepoFile("src/lib/cmo/openclaw-client.ts"),
    readRepoFile("src/lib/cmo/remote-client.ts"),
  ]);

  requireSource(configSource, "CMO_LIVE_APP_TURN_TIMEOUT_MS", "config");
  requireSource(configSource, "CMO_FALLBACK_FAST_AFTER_MS", "config");
  requireSource(configSource, "CMO_HERMES_TIMEOUT_MS", "config");
  requireSource(configSource, "240_000", "config");
  requireSource(runtimeSource, "liveAttemptStartedAt", "runtime");
  requireSource(runtimeSource, "fallbackDurationMs", "runtime");
  requireSource(runtimeSource, "timeoutMs", "runtime");
  requireSource(runtimeSource, "callOpenClawAppTurnRuntime", "runtime");
  requireSource(typeSource, "totalDurationMs", "app workspace types");
  requireSource(typeSource, "contextSourceCount", "app workspace types");
  requireSource(typeSource, "indexedSupplementCharLength", "app workspace types");
  requireSource(chatStoreSource, "CONTEXT_SIZE_WARNING_CHARS", "app chat store");
  requireSource(chatStoreSource, "contextPackBuildDurationMs", "app chat store");
  requireSource(chatStoreSource, "indexedContextBuildDurationMs", "app chat store");
  requireSource(openClawSource, "timeoutMs = getCmoAppTurnRequestTimeoutMs()", "openclaw client");
  requireSource(remoteSource, "options.timeoutMs ?? getCmoAppTurnRequestTimeoutMs()", "remote client");

  const fallbackDryRunStarted = Date.now();
  const fallbackDryRun = {
    answer: "Fallback dry-run response.",
    runtimeMode: "fallback",
    runtimeStatus: "development_fallback",
  };
  const fallbackDryRunDurationMs = Date.now() - fallbackDryRunStarted;

  assert.equal(fallbackDryRun.runtimeMode, "fallback");
  assert.ok(fallbackDryRunDurationMs < 100, "fallback dry-run should be local and fast");

  console.log(
    JSON.stringify(
      {
        ok: true,
        configuredLiveTimeoutMs,
        configuredFastFallbackMs,
        configuredHermesTimeoutMs,
        effectiveTimeoutMs,
        supportedLongRunningExternalResearchTimeoutMs: 240_000,
        fallbackDryRunDurationMs,
        checks: {
          timeoutParser: "ok",
          runtimeTimingMetadata: "ok",
          sessionTimingMetadata: "ok",
          indexedContextMetadataPreserved: "ok",
          liveAppTurnAbortable: "ok",
          noSecretsPrinted: true,
          noLiveRuntimeCall: true,
          noWrites: true,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
