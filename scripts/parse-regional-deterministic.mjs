#!/usr/bin/env node
/**
 * Parse all regional trials with the fail-closed deterministic normalizer.
 * No model calls, no Gemini quota, no billing.
 *
 * Demo typed set: the six key types except prior-therapy class checks, which
 * missed the 0-unsafe bar on held-out set 3. Those, age, and anything else
 * are kept as fuzzy "Discuss" items. Do not tune the normalizer on set 3.
 *
 * Usage: node scripts/parse-regional-deterministic.mjs
 */
import { readFileSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractTypedChecks } from "./lib/normalize-eligibility.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const CACHE_DIR = resolve(root, "data/criteria-cache");
const INDEX_PATH = resolve(CACHE_DIR, "index.json");
const PUBLIC_PATH = resolve(root, "public/criteria-cache.json");
const RECORDS_PATH = resolve(root, "public/trial-records.json");
const PROMPT_VERSION = "4-deterministic-six-demo";
const PARSER_MODEL = "deterministic-normalizer";

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
  const region = JSON.parse(readFileSync(resolve(root, "data/ctgov/region-trials.json"), "utf8"));
  const trials = region.trials || [];
  const dataTimestamp = region.dataTimestampFromApi || region.dataTimestamp || "2026-11-10T10:00:05";
  const parsedAt = new Date().toISOString();
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(resolve(root, "public"), { recursive: true });

  // Replace prior v3 documents so the cache is a single pipeline.
  for (const name of readdirSync(CACHE_DIR)) {
    if (name.endsWith(".json") && name !== "index.json") {
      unlinkSync(resolve(CACHE_DIR, name));
    }
  }

  const indexTrials = [];
  let typedKept = 0;
  let typedDemoted = 0;
  for (const trial of trials) {
    const nctId = trial.nctId;
    const parsed = extractTypedChecks(trial.eligibilityCriteria || "", nctId, {
      minimumAge: trial.minimumAge,
    });
    const kept = [];
    const fuzzy = [...(parsed.fuzzyCriteria || [])];
    for (const check of parsed.typedChecks || []) {
      if (DEMO_TYPED_KINDS.has(check.kind)) {
        kept.push(check);
      } else {
        typedDemoted += 1;
        fuzzy.push({
          id: `${check.id || nctId}-demo-discuss`,
          polarity: check.polarity,
          sourceText: check.evidence_quote || check.sourceText,
          reasonFuzzy: "Held for discussion in this demo. It is not in the six-type fail-closed set shown as a typed check.",
        });
      }
    }
    typedKept += kept.length;
    const rec = {
      ok: true,
      schemaVersion: "1",
      nctId,
      briefTitle: trial.briefTitle || "",
      parsedAt,
      parserModel: PARSER_MODEL,
      promptVersion: PROMPT_VERSION,
      dataTimestamp,
      typedChecks: kept,
      fuzzyCriteria: fuzzy,
    };
    writeFileSync(resolve(CACHE_DIR, `${nctId}.json`), JSON.stringify(rec, null, 2) + "\n");
    indexTrials.push(rec);
  }

  const index = {
    dataTimestamp,
    apiVersion: region.apiVersion || "2.0.5",
    parsedAt,
    promptVersion: PROMPT_VERSION,
    model: PARSER_MODEL,
    regionalTotal: trials.length,
    ok: indexTrials.length,
    failed: 0,
    demoTypedKinds: [...DEMO_TYPED_KINDS],
    typedKept,
    typedDemotedToDiscuss: typedDemoted,
    note: "Fail-closed deterministic normalizer. Demo cache restricts typed checks to the six key types except prior-therapy classes, which missed the 0-unsafe bar on held-out set 3. No model calls.",
    trials: indexTrials,
  };
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
  const publicDoc = {
    dataTimestamp,
    apiVersion: index.apiVersion,
    parsedAt,
    promptVersion: PROMPT_VERSION,
    parserModel: PARSER_MODEL,
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
    `Parsed ${trials.length} trials. Typed kept ${typedKept}. Demoted to Discuss ${typedDemoted}. Wrote ${INDEX_PATH}, ${PUBLIC_PATH}, and ${RECORDS_PATH}.\n`,
  );
}

main();
