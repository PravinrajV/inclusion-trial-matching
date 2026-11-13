#!/usr/bin/env node
/**
 * Option (a) batch parse: Firebase AI Logic (gemini-3.5-flash-lite, ONLY_IN_CLOUD)
 * with the v3 schema-locked prompt, a verbatim evidence-quote gate, a two-run
 * consistency gate, and the deterministic normalizer as a fail-closed verifier.
 *
 * Public ClinicalTrials.gov eligibility text only. Never send persona or chart text.
 * Pace: at most one request every 4 seconds (free Gemini Developer API, 15 RPM).
 * Hard-stops on billing, Blaze, TOS, or daily quota. Do not enable billing.
 *
 * App Check is enforced on AI Logic. This Node job uses the registered local
 * debug token from gitignored .env.local. The token is never logged or printed.
 *
 * Usage:
 *   node scripts/batch-parse-ai-logic.mjs --gold-first
 *   node scripts/batch-parse-ai-logic.mjs --resume
 *   node scripts/batch-parse-ai-logic.mjs --score-only
 *   node scripts/batch-parse-ai-logic.mjs --gold-only   # parse gold NCTs, score, stop
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import { initializeAppCheck, CustomProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";
import { parserResponseSchema } from "./parser-response-schema.mjs";
import { scoreItem, classifyMissSafety } from "./lib/postprocess-parse.mjs";
import { SIX_TYPE_GROUPS, SIX_TYPE_KINDS } from "./lib/normalize-eligibility.mjs";
import {
  mergeTwoRuns,
  PIPELINE_ID,
  PARSER_MODEL,
  PROMPT_VERSION,
} from "./lib/ai-logic-parse-pipeline.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const MODEL_NAME = PARSER_MODEL;
const PARSE_DIR = resolve(root, "data/ai-logic-parses");
const INDEX_PATH = resolve(PARSE_DIR, "index.json");
const LOG_PATH = resolve(root, "notes/batch-parse-log.jsonl");
const LIVE_PATH = resolve(root, "notes/batch-parse-live.txt");
const MIN_INTERVAL_MS = 4000;

const GOLD_SETS = [
  {
    set: 1,
    labelSet: "held-out-2026-11-11",
    gold: resolve(root, "gold/held-out-criteria-2026-11-11T211725-0500.json"),
    out: resolve(root, "notes/accuracy-raw/set1-ai-logic-score.json"),
    maxUnsafe: 0,
    priorTherapyCap: 0,
  },
  {
    set: 2,
    labelSet: "held-out-2-2026-11-11",
    gold: resolve(root, "gold/held-out-2-criteria-2026-11-11T213510-0500.json"),
    out: resolve(root, "notes/accuracy-raw/set2-ai-logic-score.json"),
    maxUnsafe: 0,
    priorTherapyCap: 0,
  },
  {
    set: 3,
    labelSet: "held-out-3-2026-11-11",
    gold: resolve(root, "gold/held-out-3-criteria-2026-11-11T214338-0500.json"),
    out: resolve(root, "notes/accuracy-raw/set3-ai-logic-score.json"),
    maxUnsafe: 4,
    priorTherapyCap: 4,
  },
];

function loadEnv(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[line.slice(0, i).trim()] = v;
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
  if (/genai config not found|TOS_REQUIRED|pay-as-you-go|\bBlaze\b|billing account|enable billing|upgrade your plan/i.test(message)) return true;
  if (/GenerateRequestsPerDay|RequestsPerDay|free_tier_input_token|tokens per day/i.test(message)) return true;
  if (/requests per day limit exceeded|Generate content requests per day/i.test(message)) return true;
  if (/\bbilling\b/i.test(message) && !/check your plan and billing details/i.test(message) && !/requests per minute/i.test(message)) return true;
  // Daily RPD retry windows are hours (reset at midnight Pacific). Do not sit on them.
  const hinted = parseRetryDelayMs(message);
  if (hinted != null && hinted >= 15 * 60 * 1000) return true;
  return false;
}

function isRpmLimit(message) {
  // The free-tier generate_content metric name is also used on daily-cap 429s.
  // Only treat an error as RPM when the message is clearly per-minute.
  if (/GenerateRequestsPerDay|RequestsPerDay|requests per day/i.test(message)) return false;
  return /requests per minute|GenerateRequestsPerMinute/i.test(message);
}

function isRetryable(message) {
  return isRpmLimit(message) || /(?:\b500\b|high demand|high-demand|unavailable|overloaded|\b503\b|\b429\b|too many requests|deadline exceeded|UNAVAILABLE|try again|App Check|appcheck|403|unauthenticated|PERMISSION_DENIED|fetch failed|timed out|ECONNRESET|ETIMEDOUT|network|socket)/i.test(message);
}

function parseRetryDelayMs(message) {
  const quoted = message.match(/retryDelay":"(\d+)s"/);
  if (quoted) return Number(quoted[1]) * 1000 + 1000;
  const prose = message.match(/Please retry in ([\d.]+)/i);
  if (prose) return Math.ceil(Number(prose[1]) * 1000) + 1000;
  return null;
}

function parseArgs(argv) {
  const out = { resume: true, goldFirst: false, goldOnly: false, scoreOnly: false, limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--gold-first") out.goldFirst = true;
    else if (argv[i] === "--gold-only") {
      out.goldFirst = true;
      out.goldOnly = true;
    } else if (argv[i] === "--score-only") out.scoreOnly = true;
    else if (argv[i] === "--no-resume") out.resume = false;
    else if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--resume") out.resume = true;
  }
  return out;
}

function goldNctIds() {
  const ids = new Set();
  for (const s of GOLD_SETS) {
    const gold = JSON.parse(readFileSync(s.gold, "utf8"));
    for (const item of gold.criteria || []) if (item.nctId) ids.add(item.nctId);
  }
  return ids;
}

function appendLog(row) {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, JSON.stringify(row) + "\n");
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function renderLive(state) {
  const rpm = state.elapsedMs > 0 ? ((state.requestCount / state.elapsedMs) * 60000).toFixed(1) : "0.0";
  const last = state.lastLine || "waiting for the first call";
  const view = [
    "Inclusion  ·  Firebase AI Logic  ·  gemini-3.5-flash-lite  ·  ONLY_IN_CLOUD",
    "prompt v3  ·  quote + two-run + normalizer verifier  ·  ≤15 RPM  ·  Spark",
    "",
    last,
    `${String(state.done).padStart(3)}/${state.total} trials   ${state.requestCount} requests   ${rpm} RPM   ${fmtDuration(state.elapsedMs)} elapsed   ${state.hardStops} hard-stops`,
  ].join("\n");
  writeFileSync(LIVE_PATH, view + "\n");
  process.stderr.write("\n---------- clip ----------\n" + view + "\n---------- /clip ----------\n");
  return view;
}

async function initAppCheckDebug(app, env) {
  const debugToken = String(env.VITE_APPCHECK_DEBUG_TOKEN || env.FIREBASE_APPCHECK_DEBUG_TOKEN || "").trim();
  if (!debugToken) {
    throw new Error("AI Logic is App Check enforced. Set VITE_APPCHECK_DEBUG_TOKEN in gitignored .env.local (the registered local debug token). The token is never logged.");
  }
  // Do not set FIREBASE_APPCHECK_DEBUG_TOKEN on globalThis: the JS SDK prints
  // that value to the console. Exchange the registered token ourselves instead.
  let cached = null;
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: async () => {
        if (cached && cached.expireTimeMillis > Date.now() + 30_000) return cached;
        const url = `https://firebaseappcheck.googleapis.com/v1/projects/${env.VITE_FIREBASE_PROJECT_ID}/apps/${env.VITE_FIREBASE_APP_ID}:exchangeDebugToken?key=${env.VITE_FIREBASE_API_KEY}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ debugToken }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.token) {
          const msg = body.error?.message || `HTTP ${res.status}`;
          throw new Error(`App Check debug exchange failed: ${msg}`);
        }
        const ttlRaw = body.ttl ? Number(String(body.ttl).replace(/s$/i, "")) : 3600;
        const ttlMs = (Number.isFinite(ttlRaw) ? ttlRaw : 3600) * 1000;
        cached = { token: body.token, expireTimeMillis: Date.now() + ttlMs };
        return cached;
      },
    }),
    isTokenAutoRefreshEnabled: true,
  });
}

async function generateWithBackoff(model, user, { tries = 6, baseMs = 8000 } = {}) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      const result = await Promise.race([
        model.generateContent(user),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("generateContent timed out after 60000ms")), 60000);
        }),
      ]);
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
      process.stderr.write(`Retry ${i + 1} after ${wait}ms: ${message.slice(0, 240)}\n`);
      await sleep(wait);
    }
  }
  throw lastError;
}

function parseModelJson(text) {
  const trimmed = String(text || "").trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : trimmed;
  return JSON.parse(raw);
}

function groupOf(kind) {
  for (const [name, kinds] of Object.entries(SIX_TYPE_GROUPS)) {
    if (kinds.includes(kind)) return name;
  }
  return "other";
}

function scoreGoldSet(spec, parsesById) {
  const gold = JSON.parse(readFileSync(spec.gold, "utf8"));
  const rows = [];
  const missing = [];
  for (const item of gold.criteria) {
    const rec = parsesById[item.nctId];
    if (!rec || !rec.ok) {
      missing.push(item.nctId);
      rows.push({
        id: item.id,
        nctId: item.nctId,
        kind: item.kind,
        group: groupOf(item.kind),
        verdict: "miss",
        detail: rec?.error || "pipeline parse missing",
        safety: "safe",
        safetyReason: "omitted; no competing typed check because the trial was not parsed",
      });
      continue;
    }
    const parsed = { typedChecks: rec.typedChecks || [], fuzzyCriteria: rec.fuzzyCriteria || [] };
    const scored = scoreItem(item, parsed);
    const safety = classifyMissSafety(item, parsed);
    rows.push({
      id: item.id,
      nctId: item.nctId,
      kind: item.kind,
      group: groupOf(item.kind),
      ...scored,
      safety: scored.verdict === "hit" ? "not_a_miss" : safety.safety,
      safetyReason: scored.verdict === "hit" ? "official hit" : safety.reason,
    });
  }
  const typedRows = rows.filter((r) => r.kind !== "fuzzy");
  const typedHits = typedRows.filter((r) => r.verdict === "hit").length;
  const typedTotal = typedRows.length;
  const safeMisses = typedRows.filter((r) => r.verdict === "miss" && r.safety === "safe").length;
  const unsafeRows = typedRows.filter((r) => r.safety === "unsafe");
  const unsafeMisses = unsafeRows.length;
  const priorTherapyUnsafe = unsafeRows.filter((r) => String(r.kind).startsWith("prior_therapy_")).length;
  const otherUnsafe = unsafeMisses - priorTherapyUnsafe;

  function decidedShare(subset) {
    const total = subset.length;
    const decided = subset.filter((r) => r.verdict === "hit").length;
    return { total, decided, discuss: total - decided, decidedShare: total ? Math.round((decided / total) * 1000) / 10 : 0 };
  }

  const perGroup = {};
  for (const name of [...Object.keys(SIX_TYPE_GROUPS), "other"]) {
    perGroup[name] = decidedShare(typedRows.filter((r) => r.group === name));
  }

  const worse =
    unsafeMisses > spec.maxUnsafe ||
    priorTherapyUnsafe > spec.priorTherapyCap ||
    otherUnsafe > 0;

  const summary = {
    ranAt: new Date().toISOString(),
    pipeline: PIPELINE_ID,
    parserModel: MODEL_NAME,
    promptVersion: PROMPT_VERSION,
    labelSet: gold.labelSet || spec.labelSet,
    goldPath: spec.gold,
    set: spec.set,
    typedHits,
    typedTotal,
    typedAccuracy: typedTotal ? Math.round((typedHits / typedTotal) * 1000) / 10 : 0,
    coverage: typedTotal ? Math.round((typedHits / typedTotal) * 1000) / 10 : 0,
    safeMisses,
    unsafeMisses,
    priorTherapyUnsafe,
    otherUnsafe,
    worseThanBaseline: worse,
    missingParses: [...new Set(missing)],
    unsafeReport: `${unsafeMisses} unsafe out of ${typedTotal} criteria`,
    decidedShare: decidedShare(typedRows),
    sixTypeDecidedShare: decidedShare(typedRows.filter((r) => SIX_TYPE_KINDS.has(r.kind))),
    perGroup,
    unsafeRows,
    rows,
  };
  mkdirSync(dirname(spec.out), { recursive: true });
  writeFileSync(spec.out, JSON.stringify({ summary, parses: Object.fromEntries(Object.entries(parsesById).filter(([id]) => (gold.criteria || []).some((c) => c.nctId === id))) }, null, 2));
  return summary;
}

function loadCompletedParses() {
  const byId = {};
  if (existsSync(INDEX_PATH)) {
    const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
    for (const t of index.trials || []) {
      if (t.nctId && t.ok && t.runA && t.runB) byId[t.nctId] = t;
    }
  }
  // Also honor merge-ok rows in the jsonl when the parse file exists, so a
  // missing or partial index entry does not redo a finished trial.
  if (existsSync(LOG_PATH)) {
    for (const line of readFileSync(LOG_PATH, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row.runId !== "merge" || !row.ok || !row.nctId || byId[row.nctId]) continue;
      const recPath = resolve(PARSE_DIR, `${row.nctId}.json`);
      if (!existsSync(recPath)) continue;
      const rec = JSON.parse(readFileSync(recPath, "utf8"));
      if (rec.ok && rec.runA && rec.runB) byId[row.nctId] = rec;
    }
  }
  return byId;
}

function writeIndex(trials, extras = {}) {
  const index = {
    pipeline: PIPELINE_ID,
    parserModel: MODEL_NAME,
    promptVersion: PROMPT_VERSION,
    parsedAt: new Date().toISOString(),
    regionalTotal: trials.length,
    ok: trials.filter((t) => t.ok).length,
    failed: trials.filter((t) => t.ok === false).length,
    ...extras,
    trials,
  };
  mkdirSync(PARSE_DIR, { recursive: true });
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  return index;
}

async function pace(lastCallAt) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(PARSE_DIR, { recursive: true });
  mkdirSync(dirname(LOG_PATH), { recursive: true });

  if (args.scoreOnly) {
    const parses = loadCompletedParses();
    const scores = GOLD_SETS.map((spec) => scoreGoldSet(spec, parses));
    reportScores(scores);
    process.exit(scores.some((s) => s.worseThanBaseline) ? 4 : 0);
  }

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
  const goldIds = goldNctIds();

  const completed = args.resume ? loadCompletedParses() : {};
  const records = args.resume && existsSync(INDEX_PATH)
    ? JSON.parse(readFileSync(INDEX_PATH, "utf8")).trials || []
    : [];
  const byId = new Map(records.map((r) => [r.nctId, r]));

  const remaining = all.filter((t) => !(completed[t.nctId] && completed[t.nctId].ok && completed[t.nctId].runA && completed[t.nctId].runB));
  const goldQueue = remaining.filter((t) => goldIds.has(t.nctId));
  const restQueue = remaining.filter((t) => !goldIds.has(t.nctId));
  let queue = args.goldFirst ? [...goldQueue, ...restQueue] : remaining;
  if (args.goldOnly) queue = goldQueue;
  queue = queue.slice(0, args.limit);

  process.stderr.write(
    `Batch parse ${queue.length} trials (gold remaining ${goldQueue.length}, other remaining ${args.goldOnly ? 0 : restQueue.length}) at <=15 RPM. Already done: ${Object.keys(completed).length}. Spark only.\n`,
  );

  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  await initAppCheckDebug(app, env);
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

  const jobStarted = Date.now();
  const state = {
    total: Object.keys(completed).length + queue.length,
    done: Object.keys(completed).length,
    requestCount: 0,
    elapsedMs: 0,
    hardStops: 0,
    lastLine: "App Check debug exchange ok. Starting generateContent calls.",
  };
  if (args.resume) {
    let prior = 0;
    if (existsSync(INDEX_PATH)) {
      prior = Number(JSON.parse(readFileSync(INDEX_PATH, "utf8")).requestCount) || 0;
    }
    if (prior === 0 && existsSync(LOG_PATH)) {
      for (const line of readFileSync(LOG_PATH, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (Number(row.requestCount) > prior) prior = Number(row.requestCount);
        } catch { /* skip a bad log line */ }
      }
    }
    state.requestCount = prior;
  }
  renderLive(state);

  let lastCallAt = 0;
  let stopped = null;
  let scoredAfterGold = false;

  async function oneRun(trial, runId) {
    await pace(lastCallAt);
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
    const generated = await generateWithBackoff(model, user);
    lastCallAt = Date.now();
    state.requestCount += 1;
    state.elapsedMs = Date.now() - jobStarted;
    const raw = parseModelJson(generated.text);
    const row = {
      at: new Date().toISOString(),
      nctId: trial.nctId,
      runId,
      requestCount: state.requestCount,
      model: MODEL_NAME,
      promptVersion: PROMPT_VERSION,
      pipeline: PIPELINE_ID,
      mode: "only_in_cloud",
      attempts: generated.attempts,
      ms: Date.now() - started,
      typedEmitted: Array.isArray(raw.typedChecks) ? raw.typedChecks.length : 0,
      fuzzyEmitted: Array.isArray(raw.fuzzyCriteria) ? raw.fuzzyCriteria.length : 0,
      ok: true,
    };
    appendLog(row);
    return { raw, meta: row };
  }

  for (const trial of queue) {
    const started = Date.now();
    try {
      state.lastLine = `${trial.nctId}  run A …`;
      renderLive(state);
      const runA = await oneRun(trial, "A");
      state.lastLine = `${trial.nctId}  run A ok (${runA.meta.typedEmitted} typed)  ·  run B …`;
      renderLive(state);
      const runB = await oneRun(trial, "B");
      const merged = mergeTwoRuns(
        runA.raw,
        runB.raw,
        trial.eligibilityCriteria,
        trial.nctId,
        { minimumAge: trial.minimumAge },
      );
      const rec = {
        ok: true,
        schemaVersion: "1",
        nctId: trial.nctId,
        briefTitle: trial.briefTitle || "",
        parsedAt: new Date().toISOString(),
        parserModel: MODEL_NAME,
        promptVersion: PROMPT_VERSION,
        pipeline: PIPELINE_ID,
        dataTimestamp,
        typedChecks: merged.typedChecks,
        fuzzyCriteria: merged.fuzzyCriteria,
        gates: merged.gates,
        runA: { typedEmitted: runA.meta.typedEmitted, fuzzyEmitted: runA.meta.fuzzyEmitted, attempts: runA.meta.attempts, ms: runA.meta.ms },
        runB: { typedEmitted: runB.meta.typedEmitted, fuzzyEmitted: runB.meta.fuzzyEmitted, attempts: runB.meta.attempts, ms: runB.meta.ms },
        ms: Date.now() - started,
        isGold: goldIds.has(trial.nctId),
      };
      // Persist raw model JSON next to the merged record for audit, not in the public cache.
      writeFileSync(resolve(PARSE_DIR, `${trial.nctId}.json`), JSON.stringify({ ...rec, rawA: runA.raw, rawB: runB.raw }, null, 2));
      byId.set(trial.nctId, rec);
      state.done += 1;
      state.elapsedMs = Date.now() - jobStarted;
      const g = merged.gates;
      state.lastLine = `${trial.nctId}  A ok  ·  B ok  ·  quote ${g.quoteA.kept}+${g.quoteB.kept}  ·  consistent ${g.consistency.agreed}  ·  verified ${g.verifier.verified}  ·  discuss ${merged.fuzzyCriteria.length}`;
      renderLive(state);
      appendLog({
        at: new Date().toISOString(),
        nctId: trial.nctId,
        runId: "merge",
        requestCount: state.requestCount,
        model: MODEL_NAME,
        promptVersion: PROMPT_VERSION,
        pipeline: PIPELINE_ID,
        gateOutcomes: g,
        typedVerified: merged.typedChecks.length,
        discuss: merged.fuzzyCriteria.length,
        ok: true,
        ms: rec.ms,
      });
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      if (err.blocked || isHardStop(message)) {
        stopped = message;
        state.hardStops += 1;
        state.lastLine = `${trial.nctId}  HARD STOP  (billing/tos/daily-quota)`;
        renderLive(state);
        appendLog({
          at: new Date().toISOString(),
          nctId: trial.nctId,
          runId: "stop",
          requestCount: state.requestCount,
          model: MODEL_NAME,
          ok: false,
          hardStop: true,
          error: message.slice(0, 400),
        });
        break;
      }
      process.stderr.write(`${trial.nctId} FAILED: ${message}\n`);
      const rec = { ok: false, nctId: trial.nctId, error: message.slice(0, 400), ms: Date.now() - started };
      byId.set(trial.nctId, rec);
      writeFileSync(resolve(PARSE_DIR, `${trial.nctId}.json`), JSON.stringify(rec, null, 2));
      appendLog({
        at: new Date().toISOString(),
        nctId: trial.nctId,
        runId: "error",
        requestCount: state.requestCount,
        model: MODEL_NAME,
        ok: false,
        error: message.slice(0, 400),
      });
      state.lastLine = `${trial.nctId}  FAILED  ·  ${message.slice(0, 80)}`;
      renderLive(state);
    }

    writeIndex([...byId.values()], { dataTimestamp, apiVersion: region.meta.apiVersion, requestCount: state.requestCount });

    const goldRemaining = goldQueue.filter((t) => !(byId.get(t.nctId) && byId.get(t.nctId).ok)).length;
    if (args.goldFirst && !scoredAfterGold && goldRemaining === 0) {
      scoredAfterGold = true;
      const parses = Object.fromEntries([...byId.entries()].filter(([, r]) => r.ok));
      const scores = GOLD_SETS.map((spec) => scoreGoldSet(spec, parses));
      reportScores(scores);
      writeFileSync(resolve(root, "notes/accuracy-raw/ai-logic-score-summary.json"), JSON.stringify(scores.map(slimScore), null, 2));
      if (scores.some((s) => s.worseThanBaseline)) {
        process.stderr.write("Unsafe is worse than the current official numbers (0, 0, 4 prior therapy). Not shipping. Stopping before the remaining regional trials.\n");
        process.exit(4);
      }
      if (args.goldOnly) {
        process.stderr.write("Gold-only run complete. Unsafe is not worse than baseline.\n");
        process.exit(0);
      }
      process.stderr.write("Gold scores are not worse than baseline. Continuing the remaining regional trials.\n");
    }
  }

  writeIndex([...byId.values()], { dataTimestamp, apiVersion: region.meta.apiVersion, requestCount: state.requestCount, stopped: stopped || null });
  const parses = Object.fromEntries([...byId.entries()].filter(([, r]) => r.ok));
  const goldReady = GOLD_SETS.every((spec) => {
    const gold = JSON.parse(readFileSync(spec.gold, "utf8"));
    return [...new Set((gold.criteria || []).map((c) => c.nctId))].every((id) => parses[id]);
  });
  if (goldReady) {
    const scores = GOLD_SETS.map((spec) => scoreGoldSet(spec, parses));
    reportScores(scores);
    writeFileSync(resolve(root, "notes/accuracy-raw/ai-logic-score-summary.json"), JSON.stringify(scores.map(slimScore), null, 2));
  }
  if (stopped) {
    process.stderr.write(`STOPPED: ${stopped}\n`);
    process.exit(3);
  }
  const failed = [...byId.values()].filter((t) => t.ok === false).length;
  const ok = [...byId.values()].filter((t) => t.ok).length;
  process.stderr.write(`Batch finished. ok=${ok} failed=${failed} requests=${state.requestCount}\n`);
  // Firebase SDK handles keep the event loop alive unless we exit.
  process.exit(failed ? 2 : 0);
}

function slimScore(s) {
  return {
    set: s.set,
    coverage: s.coverage,
    typedHits: s.typedHits,
    typedTotal: s.typedTotal,
    unsafeMisses: s.unsafeMisses,
    priorTherapyUnsafe: s.priorTherapyUnsafe,
    otherUnsafe: s.otherUnsafe,
    worseThanBaseline: s.worseThanBaseline,
    unsafeReport: s.unsafeReport,
    unsafeRows: (s.unsafeRows || []).map((r) => ({ id: r.id, nctId: r.nctId, kind: r.kind, detail: r.detail, reason: r.safetyReason })),
  };
}

function reportScores(scores) {
  process.stderr.write("\n=== AI Logic pipeline scores (quote + two-run + verifier) ===\n");
  for (const s of scores) {
    process.stderr.write(
      `set ${s.set}: ${s.typedHits}/${s.typedTotal} coverage ${s.coverage}%  ${s.unsafeReport}  prior-therapy unsafe ${s.priorTherapyUnsafe}  other unsafe ${s.otherUnsafe}  worse=${s.worseThanBaseline}\n`,
    );
  }
}

main().catch((err) => {
  const message = String(err && err.message ? err.message : err);
  process.stderr.write(`batch-parse failed: ${message}\n`);
  if (isHardStop(message)) process.exit(3);
  process.exit(1);
});
