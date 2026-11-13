#!/usr/bin/env node
/**
 * Cloud eligibility-parser accuracy spike (prompt v3, locked responseSchema + postprocess).
 * Public ClinicalTrials.gov eligibility text only. Never send persona or chart text.
 *
 * Requires the Firebase AI Logic Get started workflow to be finished on
 * inclusion-hybridai (Gemini Developer API, no billing). Exits clearly if
 * the genai config is still missing or if a call would require billing.
 *
 * Usage:
 *   node scripts/run-accuracy-spike.mjs --run-id a
 *   node scripts/run-accuracy-spike.mjs --run-id b
 *   node scripts/run-accuracy-spike.mjs --compare a b
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";
import { KINDS, parserResponseSchema } from "./parser-response-schema.mjs";
import { postprocessParse, scoreItem, classifyMissSafety } from "./lib/postprocess-parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const PROMPT_VERSION = "3";
const MODEL_NAME = "gemini-3.5-flash-lite";
const RUN_PREFIX = "schema-v3";

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
  return md
    .slice(start, end)
    .replace(/^## System\s*/m, "")
    .trim();
}

function parseArgs(argv) {
  const out = { runId: "a", compare: null, heldOut: false, inputPath: null, goldPath: null, prefix: RUN_PREFIX };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run-id") out.runId = String(argv[++i] || "a");
    else if (argv[i] === "--compare") out.compare = [String(argv[++i] || "a"), String(argv[++i] || "b")];
    else if (argv[i] === "--held-out") {
      out.heldOut = true;
      out.prefix = "held-out-v3";
      out.inputPath = resolve(root, "gold/held-out-parser-input-trials.json");
      out.goldPath = resolve(root, "gold/held-out-criteria-2026-11-11T211725-0500.json");
    }
    else if (argv[i] === "--input") out.inputPath = String(argv[++i]);
    else if (argv[i] === "--gold") out.goldPath = String(argv[++i]);
    else if (argv[i] === "--prefix") out.prefix = String(argv[++i]);
  }
  return out;
}

function parseModelJson(text) {
  const trimmed = String(text || "").trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : trimmed;
  return JSON.parse(raw);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isBlocked(message) {
  return /genai config not found|TOS_REQUIRED|BILLING|Blaze|pay-as-you-go|billing account/i.test(message);
}

function isRetryable(message) {
  return /(?:\b500\b|high demand|high-demand|unavailable|overloaded|\b503\b|\b429\b|quota|RESOURCE_EXHAUSTED|too many requests|deadline exceeded|UNAVAILABLE|try again)/i.test(message);
}

async function generateWithBackoff(model, user, { tries = 4, baseMs = 8000 } = {}) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      const result = await model.generateContent(user);
      return { text: result.response.text(), attempts: i + 1 };
    } catch (err) {
      lastError = err;
      const message = String(err && err.message ? err.message : err);
      if (isBlocked(message)) throw err;
      if (!isRetryable(message) || i === tries - 1) {
        err.attempts = i + 1;
        throw err;
      }
      const wait = baseMs * 2 ** i + Math.floor(Math.random() * 1000);
      process.stderr.write(`Retry ${i + 1}/${tries - 1} after ${wait}ms: ${message.slice(0, 240)}\n`);
      await sleep(wait);
    }
  }
  lastError.attempts = tries;
  throw lastError;
}

function scorePath(outDir, runId, prefix = RUN_PREFIX) {
  return resolve(outDir, `${prefix}-run-${runId}-score.json`);
}

function summarizeParses(gold, trials, parses, runId) {
  const rows = [];
  let hits = 0;
  for (const item of gold.criteria) {
    const rec = parses[item.nctId];
    if (!rec || !rec.ok) {
      rows.push({
        id: item.id,
        nctId: item.nctId,
        kind: item.kind,
        verdict: "miss",
        detail: rec && rec.error ? rec.error : "no parse",
      });
      continue;
    }
    const parsed = rec.processed || rec.parsed;
    const scored = scoreItem(item, parsed);
    const safety = classifyMissSafety(item, parsed);
    if (scored.verdict === "hit") hits += 1;
    rows.push({
      id: item.id,
      nctId: item.nctId,
      kind: item.kind,
      ...scored,
      safety: scored.verdict === "hit" ? "not_a_miss" : safety.safety,
      safetyReason: scored.verdict === "hit" ? "official hit" : safety.reason,
    });
  }
  const total = gold.criteria.length;
  const typedTotal = gold.criteria.filter((c) => c.kind !== "fuzzy").length;
  const typedHits = rows.filter((r) => r.kind !== "fuzzy" && r.verdict === "hit").length;
  const fuzzyHits = rows.filter((r) => r.kind === "fuzzy" && r.verdict === "hit").length;
  const typedMisses = rows.filter((r) => r.kind !== "fuzzy" && r.verdict === "miss");
  const safeMisses = typedMisses.filter((r) => r.safety === "safe").length;
  const unsafeMisses = typedMisses.filter((r) => r.safety === "unsafe").length;
  return {
    ranAt: new Date().toISOString(),
    model: MODEL_NAME,
    promptVersion: PROMPT_VERSION,
    schemaLocked: true,
    postprocessed: true,
    responseMimeType: "application/json",
    runId,
    labelSet: gold.labelSet || "original-gold",
    heldOut: Boolean(gold.labelSet && String(gold.labelSet).startsWith("held-out")),
    dataTimestamp: trials.dataTimestamp,
    schemaVersion: gold.schemaVersion,
    hits,
    total,
    percent: Math.round((hits / total) * 1000) / 10,
    typedHits,
    typedTotal,
    fuzzyHits,
    fuzzyTotal: total - typedTotal,
    safeMisses,
    unsafeMisses,
    typedTargetMet: typedHits >= 21,
    unsafeTargetMet: unsafeMisses === 0,
    retries: Object.fromEntries(Object.entries(parses).map(([k, v]) => [k, v.attempts || 1])),
    rows,
  };
}

function loadScore(outDir, runId, prefix = RUN_PREFIX) {
  const path = scorePath(outDir, runId, prefix);
  if (!existsSync(path)) throw new Error(`Missing score file ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function compareRuns(outDir, idA, idB, prefix = RUN_PREFIX) {
  const a = loadScore(outDir, idA, prefix);
  const b = loadScore(outDir, idB, prefix);
  const rowsA = Object.fromEntries(a.summary.rows.map((r) => [r.id, r]));
  const rowsB = Object.fromEntries(b.summary.rows.map((r) => [r.id, r]));
  const ids = [...new Set([...Object.keys(rowsA), ...Object.keys(rowsB)])];
  const itemAgreement = [];
  let sameVerdict = 0;
  let bothHit = 0;
  let flipped = 0;
  for (const id of ids) {
    const ra = rowsA[id];
    const rb = rowsB[id];
    const agree = ra && rb && ra.verdict === rb.verdict;
    if (agree) sameVerdict += 1;
    if (agree && ra.verdict === "hit") bothHit += 1;
    if (ra && rb && ra.verdict !== rb.verdict) flipped += 1;
    itemAgreement.push({
      id,
      kind: (ra || rb).kind,
      nctId: (ra || rb).nctId,
      runA: ra ? ra.verdict : "missing",
      runB: rb ? rb.verdict : "missing",
      safetyA: ra && ra.safety,
      safetyB: rb && rb.safety,
      agree: Boolean(agree),
      detailA: ra && ra.detail,
      detailB: rb && rb.detail,
    });
  }
  const summary = {
    comparedAt: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    postprocessed: true,
    runA: {
      runId: idA,
      ranAt: a.summary.ranAt,
      typedHits: a.summary.typedHits,
      typedTotal: a.summary.typedTotal,
      fuzzyHits: a.summary.fuzzyHits,
      fuzzyTotal: a.summary.fuzzyTotal,
      hits: a.summary.hits,
      total: a.summary.total,
      safeMisses: a.summary.safeMisses,
      unsafeMisses: a.summary.unsafeMisses,
    },
    runB: {
      runId: idB,
      ranAt: b.summary.ranAt,
      typedHits: b.summary.typedHits,
      typedTotal: b.summary.typedTotal,
      fuzzyHits: b.summary.fuzzyHits,
      fuzzyTotal: b.summary.fuzzyTotal,
      hits: b.summary.hits,
      total: b.summary.total,
      safeMisses: b.summary.safeMisses,
      unsafeMisses: b.summary.unsafeMisses,
    },
    sameVerdict,
    totalItems: ids.length,
    bothHit,
    flipped,
    verdictAgreementPercent: Math.round((sameVerdict / ids.length) * 1000) / 10,
    itemAgreement,
  };
  writeFileSync(resolve(outDir, `${RUN_PREFIX}-stability.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function runSpike(runId, opts = {}) {
  const env = loadEnv(resolve(root, ".env.local"));
  const required = [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIREBASE_APP_ID",
  ];
  for (const k of required) {
    if (!env[k]) throw new Error(`Missing ${k} in .env.local`);
  }
  const trials = JSON.parse(readFileSync(opts.inputPath || resolve(root, "gold/parser-input-trials.json"), "utf8"));
  const gold = JSON.parse(readFileSync(opts.goldPath || resolve(root, "gold/criteria.json"), "utf8"));
  const system = loadPrompt();
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
      systemInstruction: system,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: parserResponseSchema(),
      },
    },
  });

  const outDir = resolve(root, "notes/accuracy-raw");
  mkdirSync(outDir, { recursive: true });
  const prefix = opts.prefix || RUN_PREFIX;
  const logPath = resolve(outDir, `${prefix}-run-${runId}.log`);
  const log = (line) => {
    process.stderr.write(line + "\n");
    writeFileSync(logPath, (existsSync(logPath) ? readFileSync(logPath, "utf8") : "") + line + "\n");
  };
  writeFileSync(logPath, `schema-v2 run ${runId} start ${new Date().toISOString()}\n`);

  const parses = {};
  for (const trial of trials.trials) {
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
    const started = Date.now();
    let attempts = 1;
    try {
      const generated = await generateWithBackoff(model, user);
      const text = generated.text;
      attempts = generated.attempts;
      const rawParsed = parseModelJson(text);
      const processed = postprocessParse(rawParsed, trial.eligibilityCriteria, trial.nctId);
      const invalidKind = (processed.typedChecks || []).filter((t) => t.kind && !KINDS.includes(t.kind));
      parses[trial.nctId] = {
        ok: true,
        parsed: processed,
        rawParsed,
        processed,
        raw: text,
        attempts,
        ms: Date.now() - started,
        invalidKind,
        postprocessActions: processed.postprocessActions,
      };
      log(
        `${trial.nctId} ok typed=${(processed.typedChecks || []).length} fuzzy=${(processed.fuzzyCriteria || []).length} post=${(processed.postprocessActions || []).length} invalidKind=${invalidKind.length} ${Date.now() - started}ms`,
      );
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      if (isBlocked(message)) {
        console.error("BLOCKED:", message);
        process.exit(2);
      }
      attempts = err.attempts || attempts;
      log(`${trial.nctId} FAILED after ${attempts} attempt(s): ${message}`);
      parses[trial.nctId] = { ok: false, error: message, raw: undefined, attempts, ms: Date.now() - started };
    }
    await sleep(1500);
  }

  const summary = summarizeParses(gold, trials, parses, runId);
  const slimParses = Object.fromEntries(
    Object.entries(parses).map(([k, v]) => [
      k,
      {
        ok: v.ok,
        parsed: v.parsed,
        rawParsed: v.rawParsed,
        processed: v.processed,
        error: v.error,
        raw: v.raw,
        attempts: v.attempts,
        ms: v.ms,
        invalidKind: v.invalidKind,
        postprocessActions: v.postprocessActions,
      },
    ]),
  );
  writeFileSync(scorePath(outDir, runId, prefix), JSON.stringify({ summary, parses: slimParses }, null, 2));
  writeFileSync(resolve(outDir, `${prefix}-run-${runId}-summary.json`), JSON.stringify(summary, null, 2));
  log(`Done run ${runId}: typed ${summary.typedHits}/${summary.typedTotal}, fuzzy ${summary.fuzzyHits}/${summary.fuzzyTotal}, all ${summary.hits}/${summary.total}, safeMiss ${summary.safeMisses}, unsafeMiss ${summary.unsafeMisses}`);
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(root, "notes/accuracy-raw");
  mkdirSync(outDir, { recursive: true });
  if (args.compare) {
    compareRuns(outDir, args.compare[0], args.compare[1], args.prefix || RUN_PREFIX);
    return;
  }
  await runSpike(args.runId, {
    inputPath: args.inputPath,
    goldPath: args.goldPath,
    prefix: args.prefix || RUN_PREFIX,
    heldOut: args.heldOut,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
