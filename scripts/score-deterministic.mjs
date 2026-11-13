#!/usr/bin/env node
/**
 * Score the deterministic normalizer against a gold label set. No model calls.
 * Usage: node scripts/score-deterministic.mjs --gold PATH --input PATH
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractTypedChecks, SIX_TYPE_GROUPS, SIX_TYPE_KINDS } from "./lib/normalize-eligibility.mjs";
import { scoreItem, classifyMissSafety } from "./lib/postprocess-parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function parseArgs(argv) {
  const out = {
    gold: resolve(root, "gold/held-out-criteria-2026-11-11T211725-0500.json"),
    input: resolve(root, "gold/held-out-parser-input-trials.json"),
    out: resolve(root, "notes/accuracy-raw/set1-deterministic-score.json"),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--gold") out.gold = resolve(argv[++i]);
    else if (argv[i] === "--input") out.input = resolve(argv[++i]);
    else if (argv[i] === "--out") out.out = resolve(argv[++i]);
  }
  return out;
}

function groupOf(kind) {
  for (const [name, kinds] of Object.entries(SIX_TYPE_GROUPS)) {
    if (kinds.includes(kind)) return name;
  }
  return "other";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const gold = JSON.parse(readFileSync(args.gold, "utf8"));
  const trials = JSON.parse(readFileSync(args.input, "utf8"));
  const byId = Object.fromEntries((trials.trials || []).map((t) => [t.nctId, t]));
  const parses = {};
  for (const t of trials.trials || []) {
    parses[t.nctId] = extractTypedChecks(t.eligibilityCriteria, t.nctId, { minimumAge: t.minimumAge });
  }

  const rows = [];
  for (const item of gold.criteria) {
    const parsed = parses[item.nctId] || { typedChecks: [], fuzzyCriteria: [] };
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
  const unsafeMisses = typedRows.filter((r) => r.verdict === "miss" && r.safety === "unsafe").length;

  function decidedShare(subset) {
    const total = subset.length;
    const decided = subset.filter((r) => r.verdict === "hit").length;
    const discuss = total - decided;
    return {
      total,
      decided,
      discuss,
      decidedShare: total ? Math.round((decided / total) * 1000) / 10 : 0,
    };
  }

  const perTrial = {};
  for (const nct of gold.nctIds || [...new Set(rows.map((r) => r.nctId))]) {
    const subset = typedRows.filter((r) => r.nctId === nct);
    const parsed = parses[nct];
    perTrial[nct] = {
      ...decidedShare(subset),
      typedEmitted: parsed?.typedChecks?.length || 0,
      fuzzyEmitted: parsed?.fuzzyCriteria?.length || 0,
      hits: subset.filter((r) => r.verdict === "hit").map((r) => r.id),
      unsafe: subset.filter((r) => r.safety === "unsafe").map((r) => ({ id: r.id, kind: r.kind, detail: r.detail, reason: r.safetyReason })),
      safe: subset.filter((r) => r.safety === "safe").map((r) => ({ id: r.id, kind: r.kind, reason: r.safetyReason })),
    };
  }

  const perGroup = {};
  for (const name of [...Object.keys(SIX_TYPE_GROUPS), "other"]) {
    perGroup[name] = decidedShare(typedRows.filter((r) => r.group === name));
  }

  const summary = {
    ranAt: new Date().toISOString(),
    parserModel: "deterministic-normalizer",
    promptVersion: "4-deterministic",
    labelSet: gold.labelSet,
    goldPath: args.gold,
    typedHits,
    typedTotal,
    typedAccuracy: typedTotal ? Math.round((typedHits / typedTotal) * 1000) / 10 : 0,
    coverage: typedTotal ? Math.round((typedHits / typedTotal) * 1000) / 10 : 0,
    safeMisses,
    unsafeMisses,
    unsafeReport: `${unsafeMisses} unsafe out of ${typedTotal} criteria`,
    decidedShare: decidedShare(typedRows),
    sixTypeDecidedShare: decidedShare(typedRows.filter((r) => SIX_TYPE_KINDS.has(r.kind))),
    perGroup,
    perTrial,
    unsafeRows: typedRows.filter((r) => r.safety === "unsafe"),
    rows,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify({ summary, parses }, null, 2));
  const slim = { ...summary, rows: undefined };
  console.log(JSON.stringify(slim, null, 2));
  process.stderr.write(
    `typed ${typedHits}/${typedTotal} (${summary.typedAccuracy}%), coverage ${summary.coverage}%, safe ${safeMisses}, ${summary.unsafeReport}\n`,
  );
}

main();
