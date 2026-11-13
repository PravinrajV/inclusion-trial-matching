#!/usr/bin/env node
/**
 * Ship the option-(a) Firebase AI Logic batch cache into the public snapshot
 * and data/criteria-cache, with the same demo typed-set restriction as before:
 * prior-therapy classes (still 1 unsafe on set 3), age, and other non-key
 * types are demoted to Discuss. Does not write Firestore (run
 * scripts/write-firestore-cache.mjs after this).
 *
 * Usage: node scripts/ship-ai-logic-cache.mjs
 */
import { readFileSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, existsSync, cpSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PIPELINE_ID, PARSER_MODEL, PROMPT_VERSION } from "./lib/ai-logic-parse-pipeline.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const PARSE_DIR = resolve(root, "data/ai-logic-parses");
const PARSE_INDEX = resolve(PARSE_DIR, "index.json");
const CACHE_DIR = resolve(root, "data/criteria-cache");
const INDEX_PATH = resolve(CACHE_DIR, "index.json");
const PUBLIC_PATH = resolve(root, "public/criteria-cache.json");
const RECORDS_PATH = resolve(root, "public/trial-records.json");
const BACKUP_DIR = resolve(root, "data/criteria-cache-deterministic-baseline");

const DEMO_TYPED_KINDS = new Set([
  "egfr_status",
  "alk_status",
  "kras_status",
  "ros1_status",
  "braf_status",
  "egfr_variant_in",
  "kras_variant_in",
  "stage_in",
  "ecog_max",
  "brain_mets",
  "creatinine_max",
  "egfr_min",
  "anc_min",
  "platelets_min",
  "hemoglobin_min",
  "bilirubin_max",
  "ast_max",
  "alt_max",
]);

function main() {
  if (!existsSync(PARSE_INDEX)) throw new Error("Missing data/ai-logic-parses/index.json");
  const parsed = JSON.parse(readFileSync(PARSE_INDEX, "utf8"));
  const region = JSON.parse(readFileSync(resolve(root, "data/ctgov/region-trials.json"), "utf8"));
  const expected = (region.trials || []).map((t) => t.nctId);
  const byId = new Map((parsed.trials || []).map((t) => [t.nctId, t]));
  const missing = expected.filter((id) => !byId.get(id)?.ok);
  const failed = (parsed.trials || []).filter((t) => t.ok === false);
  if (expected.length !== 277) {
    throw new Error(`Region file has ${expected.length} trials, expected 277.`);
  }
  if (missing.length || failed.length) {
    throw new Error(
      `Refusing to ship an incomplete cache. missing=${missing.length} failed=${failed.length} ok=${parsed.ok} of 277. Missing sample: ${missing.slice(0, 8).join(", ")}`,
    );
  }

  if (existsSync(INDEX_PATH) && !existsSync(resolve(BACKUP_DIR, "index.json"))) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    cpSync(INDEX_PATH, resolve(BACKUP_DIR, "index.json"));
    if (existsSync(PUBLIC_PATH)) cpSync(PUBLIC_PATH, resolve(BACKUP_DIR, "criteria-cache.json"));
    process.stderr.write(`Backed up the previous cache to ${BACKUP_DIR} (deterministic baseline, not for live revert).\n`);
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  for (const name of readdirSync(CACHE_DIR)) {
    if (name.endsWith(".json") && name !== "index.json") unlinkSync(resolve(CACHE_DIR, name));
  }

  const parsedAt = new Date().toISOString();
  const dataTimestamp = parsed.dataTimestamp || region.meta?.dataTimestampFromApi || "2026-11-10T10:00:05";
  const indexTrials = [];
  let typedKept = 0;
  let typedDemoted = 0;

  for (const trial of region.trials) {
    const src = byId.get(trial.nctId);
    const kept = [];
    const fuzzy = [...(src.fuzzyCriteria || [])];
    for (const check of src.typedChecks || []) {
      if (DEMO_TYPED_KINDS.has(check.kind)) {
        kept.push(check);
      } else {
        typedDemoted += 1;
        fuzzy.push({
          id: `${check.id || trial.nctId}-demo-discuss`,
          polarity: check.polarity,
          sourceText: check.evidence_quote || check.sourceText,
          reasonFuzzy:
            "Held for discussion in this demo. It is not in the six-type fail-closed set shown as a typed check.",
        });
      }
    }
    typedKept += kept.length;
    const rec = {
      ok: true,
      schemaVersion: "1",
      nctId: trial.nctId,
      briefTitle: trial.briefTitle || src.briefTitle || "",
      parsedAt: src.parsedAt || parsedAt,
      parserModel: PARSER_MODEL,
      promptVersion: PROMPT_VERSION,
      pipeline: PIPELINE_ID,
      dataTimestamp,
      typedChecks: kept,
      fuzzyCriteria: fuzzy,
      gates: src.gates || null,
    };
    writeFileSync(resolve(CACHE_DIR, `${trial.nctId}.json`), JSON.stringify(rec, null, 2) + "\n");
    indexTrials.push(rec);
  }

  const index = {
    dataTimestamp,
    apiVersion: parsed.apiVersion || region.meta?.apiVersion || "2.0.5",
    parsedAt,
    promptVersion: PROMPT_VERSION,
    model: PARSER_MODEL,
    parserModel: PARSER_MODEL,
    pipeline: PIPELINE_ID,
    requestCount: parsed.requestCount || null,
    regionalTotal: expected.length,
    ok: indexTrials.length,
    failed: 0,
    demoTypedKinds: [...DEMO_TYPED_KINDS],
    typedKept,
    typedDemotedToDiscuss: typedDemoted,
    note: "Option (a) Firebase AI Logic parse (prompt v3, quote gate, two-run consistency, normalizer as verifier). Demo cache still omits prior-therapy classes from typed checks because set 3 had 1 unsafe prior_therapy_excluded miss. Age and other non-key types also stay as Discuss.",
    trials: indexTrials,
  };
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");

  const publicDoc = {
    dataTimestamp,
    apiVersion: index.apiVersion,
    parsedAt,
    promptVersion: PROMPT_VERSION,
    parserModel: PARSER_MODEL,
    pipeline: PIPELINE_ID,
    trials: indexTrials.map((t) => ({
      schemaVersion: t.schemaVersion,
      nctId: t.nctId,
      briefTitle: t.briefTitle,
      parsedAt: t.parsedAt,
      parserModel: t.parserModel,
      promptVersion: t.promptVersion,
      dataTimestamp: t.dataTimestamp,
      typedChecks: t.typedChecks,
      fuzzyCriteria: t.fuzzyCriteria,
    })),
  };
  const payload = JSON.stringify(publicDoc) + "\n";
  writeFileSync(PUBLIC_PATH, payload);
  writeFileSync(RECORDS_PATH, payload);
  process.stderr.write(
    `Shipped ${indexTrials.length} trials. Typed kept ${typedKept}. Demoted to Discuss ${typedDemoted}. Wrote ${INDEX_PATH}, ${PUBLIC_PATH}, and ${RECORDS_PATH}.\n`,
  );
}

main();
