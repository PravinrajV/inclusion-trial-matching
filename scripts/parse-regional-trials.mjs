#!/usr/bin/env node
/**
 * Parse regional recruiting NSCLC trials with prompt v3 + postprocess.
 * Public eligibility text only. Never send persona or chart text.
 * Pace: at most one request every 4 seconds (Gemini free-tier flash-lite cap is 15 RPM).
 * Backoff on 429 per-minute limits (honors RetryInfo) and on 500/high-demand.
 * Hard-stops on billing, Blaze, TOS, or daily/token quota. Do not enable billing.
 *
 * Usage: node scripts/parse-regional-trials.mjs [--limit N] [--resume]
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";
import { parserResponseSchema } from "./parser-response-schema.mjs";
import { postprocessParse } from "./lib/postprocess-parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const MODEL_NAME = "gemini-3.5-flash-lite";
const PROMPT_VERSION = "3";
const CACHE_DIR = resolve(root, "data/criteria-cache");
const INDEX_PATH = resolve(CACHE_DIR, "index.json");
const LOG_PATH = resolve(root, "notes/accuracy-raw/parse-regional.log");

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

function loadPrompt() {
  const md = readFileSync(resolve(root, "prompts/cloud-eligibility-parser.md"), "utf8");
  const start = md.indexOf("## System");
  const end = md.indexOf("## User payload");
  if (start < 0 || end < 0) throw new Error("Could not find System section in parser prompt");
  return md.slice(start, end).replace(/^## System\s*/m, "").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isHardStop(message) {
  // Billing, TOS, or daily/token quota. A free-tier per-minute 429 is retryable, not a hard stop.
  if (/genai config not found|TOS_REQUIRED|pay-as-you-go|\bBlaze\b|billing account|enable billing|upgrade your plan/i.test(message)) return true;
  if (/GenerateRequestsPerDay|RequestsPerDay|free_tier_input_token|tokens per day/i.test(message)) return true;
  if (/\bbilling\b/i.test(message) && !/check your plan and billing details/i.test(message) && !/requests per minute/i.test(message)) return true;
  return false;
}

function isRpmLimit(message) {
  return /requests per minute|GenerateRequestsPerMinute|generate_content_free_tier_requests/i.test(message);
}

function isRetryable(message) {
  return isRpmLimit(message) || /(?:\b500\b|high demand|high-demand|unavailable|overloaded|\b503\b|\b429\b|too many requests|deadline exceeded|UNAVAILABLE|try again)/i.test(message);
}

function parseRetryDelayMs(message) {
  const quoted = message.match(/retryDelay":"(\d+)s"/);
  if (quoted) return Number(quoted[1]) * 1000 + 1000;
  const prose = message.match(/Please retry in ([\d.]+)/i);
  if (prose) return Math.ceil(Number(prose[1]) * 1000) + 1000;
  return null;
}

async function generateWithBackoff(model, user, { tries = 6, baseMs = 8000 } = {}) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      const result = await model.generateContent(user);
      return { text: result.response.text(), attempts: i + 1 };
    } catch (err) {
      lastError = err;
      const message = String(err && err.message ? err.message : err);
      if (isHardStop(message)) {
        err.blocked = true;
        throw err;
      }
      if (!isRetryable(message) || i === tries - 1) {
        err.attempts = i + 1;
        throw err;
      }
      const hinted = parseRetryDelayMs(message);
      const wait = hinted || baseMs * 2 ** i + Math.floor(Math.random() * 1000);
      log(`Retry ${i + 1} after ${wait}ms: ${message.slice(0, 240)}`);
      await sleep(wait);
    }
  }
  throw lastError;
}

function log(line) {
  const row = `${new Date().toISOString()} ${line}`;
  process.stderr.write(row + "\n");
  writeFileSync(LOG_PATH, (existsSync(LOG_PATH) ? readFileSync(LOG_PATH, "utf8") : "") + row + "\n");
}

function parseArgs(argv) {
  const out = { limit: Infinity, resume: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--no-resume") out.resume = false;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv(resolve(root, ".env.local"));
  for (const k of [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIREBASE_APP_ID",
  ]) {
    if (!env[k]) throw new Error(`Missing ${k} in .env.local`);
  }
  const region = JSON.parse(readFileSync(resolve(root, "data/ctgov/region-trials.json"), "utf8"));
  const dataTimestamp = region.meta.dataTimestampFromApi;
  const all = region.trials;
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(dirname(LOG_PATH), { recursive: true });

  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: MODEL_NAME,
      systemInstruction: loadPrompt(),
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: parserResponseSchema(),
      },
    },
  });

  const done = new Set();
  if (args.resume && existsSync(INDEX_PATH)) {
    const prev = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
    for (const t of prev.trials || []) if (t.nctId && t.ok) done.add(t.nctId);
    log(`Resuming; ${done.size} already parsed.`);
  }

  const queue = all.filter((t) => !done.has(t.nctId)).slice(0, args.limit);
  log(`Parsing ${queue.length} of ${all.length} regional trials at <= 15 req/min (4s floor). Spark only.`);

  const records = args.resume && existsSync(INDEX_PATH) ? JSON.parse(readFileSync(INDEX_PATH, "utf8")).trials || [] : [];
  const byId = new Map(records.map((r) => [r.nctId, r]));

  let stopped = null;
  for (const trial of queue) {
    const started = Date.now();
    const user = JSON.stringify({
      nctId: trial.nctId,
      briefTitle: trial.briefTitle,
      phases: trial.phases,
      minimumAge: trial.minimumAge,
      maximumAge: trial.maximumAge,
      sex: trial.sex,
      conditions: trial.conditions,
      eligibilityCriteria: trial.eligibilityCriteria,
    });
    log(`Parsing ${trial.nctId}...`);
    try {
      const generated = await generateWithBackoff(model, user);
      const rawParsed = JSON.parse(String(generated.text || "").trim());
      const processed = postprocessParse(rawParsed, trial.eligibilityCriteria, trial.nctId);
      const rec = {
        ok: true,
        schemaVersion: "1",
        nctId: trial.nctId,
        briefTitle: trial.briefTitle || "",
        parsedAt: new Date().toISOString(),
        parserModel: MODEL_NAME,
        promptVersion: PROMPT_VERSION,
        dataTimestamp,
        typedChecks: processed.typedChecks,
        fuzzyCriteria: processed.fuzzyCriteria,
        postprocessActions: processed.postprocessActions,
        attempts: generated.attempts,
        ms: Date.now() - started,
      };
      byId.set(trial.nctId, rec);
      writeFileSync(resolve(CACHE_DIR, `${trial.nctId}.json`), JSON.stringify(rec, null, 2));
      log(`${trial.nctId} ok typed=${rec.typedChecks.length} fuzzy=${rec.fuzzyCriteria.length} ${rec.ms}ms`);
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      if (err.blocked || isHardStop(message)) {
        stopped = message;
        log(`STOPPED (billing/tos/daily-quota): ${message}`);
        // Do not persist this NCT as failed, so a later resume retries it.
        break;
      }
      log(`${trial.nctId} FAILED: ${message}`);
      byId.set(trial.nctId, { ok: false, nctId: trial.nctId, error: message, ms: Date.now() - started });
    }
    const index = {
      dataTimestamp,
      apiVersion: region.meta.apiVersion,
      parsedAt: new Date().toISOString(),
      promptVersion: PROMPT_VERSION,
      model: MODEL_NAME,
      regionalTotal: all.length,
      ok: [...byId.values()].filter((r) => r.ok).length,
      failed: [...byId.values()].filter((r) => !r.ok).length,
      trials: [...byId.values()],
    };
    writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
    writeFileSync(resolve(root, "public/criteria-cache.json"), JSON.stringify({
      dataTimestamp,
      promptVersion: PROMPT_VERSION,
      model: MODEL_NAME,
      trials: index.trials.filter((r) => r.ok).map((r) => ({
        schemaVersion: "1",
        nctId: r.nctId,
        briefTitle: r.briefTitle,
        parsedAt: r.parsedAt,
        parserModel: r.parserModel,
        promptVersion: r.promptVersion,
        dataTimestamp: r.dataTimestamp,
        typedChecks: r.typedChecks,
        fuzzyCriteria: r.fuzzyCriteria,
      })),
    }));
    const elapsed = Date.now() - started;
    const MIN_INTERVAL_MS = 4000; // free-tier flash-lite is 15 RPM
    if (elapsed < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - elapsed);
  }

  const index = {
    dataTimestamp,
    apiVersion: region.meta.apiVersion,
    parsedAt: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    model: MODEL_NAME,
    regionalTotal: all.length,
    ok: [...byId.values()].filter((r) => r.ok).length,
    failed: [...byId.values()].filter((r) => !r.ok).length,
    trials: [...byId.values()],
  };
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  const ok = index.ok;
  log(`Done. ok=${ok} failed=${index.failed} of regional ${all.length}. stopped=${stopped || "no"}`);
  if (stopped) process.exit(3);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
