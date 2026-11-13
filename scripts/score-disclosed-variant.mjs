#!/usr/bin/env node
/**
 * Score the disclosed (not shipped) variant: Gemini proposes; the
 * normalizer may fill only classes that had 0 unsafe on all three official
 * (a) sets. Never fills prior_therapy_*. Set 3 is no longer truly held out
 * for this variant. Does not write public/ or Firestore.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractTypedChecks,
  checksJudgmentEquivalent,
  SIX_TYPE_GROUPS,
  SIX_TYPE_KINDS,
} from "./lib/normalize-eligibility.mjs";
import { scoreItem, classifyMissSafety } from "./lib/postprocess-parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const PRIOR_KINDS = new Set(SIX_TYPE_GROUPS.prior);
const FILLABLE_KINDS = new Set(
  Object.values(SIX_TYPE_GROUPS).flat().filter((k) => !PRIOR_KINDS.has(k)),
);

const GOLD_SETS = [
  { set: 1, gold: resolve(root, "gold/held-out-criteria-2026-11-11T211725-0500.json"), out: resolve(root, "notes/accuracy-raw/set1-disclosed-variant-score.json"), maxUnsafe: 0, priorTherapyCap: 0 },
  { set: 2, gold: resolve(root, "gold/held-out-2-criteria-2026-11-11T213510-0500.json"), out: resolve(root, "notes/accuracy-raw/set2-disclosed-variant-score.json"), maxUnsafe: 0, priorTherapyCap: 0 },
  { set: 3, gold: resolve(root, "gold/held-out-3-criteria-2026-11-11T214338-0500.json"), out: resolve(root, "notes/accuracy-raw/set3-disclosed-variant-score.json"), maxUnsafe: 4, priorTherapyCap: 4 },
];

function groupOf(kind) {
  for (const [name, kinds] of Object.entries(SIX_TYPE_GROUPS)) {
    if (kinds.includes(kind)) return name;
  }
  return "other";
}

function fillParse(rec, eligibility, minimumAge) {
  const filled = [...(rec.typedChecks || [])];
  const added = [];
  if (!eligibility) return { rec: { ...rec, typedChecks: filled }, added };
  const norm = extractTypedChecks(eligibility, rec.nctId, { minimumAge });
  for (const check of norm.typedChecks || []) {
    if (!FILLABLE_KINDS.has(check.kind)) continue;
    const already = filled.some((t) => checksJudgmentEquivalent(t, check) || (`${t.kind}|${t.polarity}` === `${check.kind}|${check.polarity}` && t.value === check.value));
    if (already) continue;
    filled.push({ ...check, filledBy: "normalizer-zero-unsafe-class" });
    added.push({ nctId: rec.nctId, kind: check.kind, polarity: check.polarity, value: check.value });
  }
  return { rec: { ...rec, typedChecks: filled, variant: "gemini-plus-normalizer-fill-zero-unsafe-classes" }, added };
}

function scoreGoldSet(spec, parsesById) {
  const gold = JSON.parse(readFileSync(spec.gold, "utf8"));
  const rows = [];
  const missing = [];
  for (const item of gold.criteria) {
    const rec = parsesById[item.nctId];
    if (!rec || rec.ok === false) {
      missing.push(item.nctId);
      rows.push({ id: item.id, nctId: item.nctId, kind: item.kind, group: groupOf(item.kind), verdict: "miss", detail: rec?.error || "pipeline parse missing", safety: "safe", safetyReason: "omitted; no competing typed check because the trial was not parsed" });
      continue;
    }
    const parsed = { typedChecks: rec.typedChecks || [], fuzzyCriteria: rec.fuzzyCriteria || [] };
    const scored = scoreItem(item, parsed);
    const safety = classifyMissSafety(item, parsed);
    rows.push({
      id: item.id, nctId: item.nctId, kind: item.kind, group: groupOf(item.kind), ...scored,
      safety: scored.verdict === "hit" ? "not_a_miss" : safety.safety,
      safetyReason: scored.verdict === "hit" ? "official hit" : safety.reason,
    });
  }
  const typedRows = rows.filter((r) => r.kind !== "fuzzy");
  const typedHits = typedRows.filter((r) => r.verdict === "hit").length;
  const typedTotal = typedRows.length;
  const unsafeRows = typedRows.filter((r) => r.safety === "unsafe");
  const unsafeMisses = unsafeRows.length;
  const priorTherapyUnsafe = unsafeRows.filter((r) => String(r.kind).startsWith("prior_therapy_")).length;
  const otherUnsafe = unsafeMisses - priorTherapyUnsafe;
  const worse = unsafeMisses > spec.maxUnsafe || priorTherapyUnsafe > spec.priorTherapyCap || otherUnsafe > 0;
  const summary = {
    ranAt: new Date().toISOString(),
    pipeline: "disclosed-variant-gemini-plus-normalizer-fill-zero-unsafe-classes",
    note: "Set 3 is no longer truly held out for this variant. Not shipped.",
    fillableClasses: [...FILLABLE_KINDS],
    neverFilled: [...PRIOR_KINDS],
    set: spec.set,
    typedHits,
    typedTotal,
    coverage: typedTotal ? Math.round((typedHits / typedTotal) * 1000) / 10 : 0,
    unsafeMisses,
    priorTherapyUnsafe,
    otherUnsafe,
    worseThanBaseline: worse,
    missingParses: [...new Set(missing)],
    unsafeReport: `${unsafeMisses} unsafe out of ${typedTotal} criteria`,
    unsafeRows: unsafeRows.map((r) => ({ id: r.id, nctId: r.nctId, kind: r.kind, detail: r.detail, reason: r.safetyReason })),
  };
  mkdirSync(dirname(spec.out), { recursive: true });
  writeFileSync(spec.out, JSON.stringify({ summary, rows }, null, 2));
  return summary;
}

const index = JSON.parse(readFileSync(resolve(root, "data/ai-logic-parses/index.json"), "utf8"));
const region = JSON.parse(readFileSync(resolve(root, "data/ctgov/region-trials.json"), "utf8"));
const elig = new Map((region.trials || []).map((t) => [t.nctId, t]));
const parses = {};
const addedAll = [];
for (const rec of index.trials || []) {
  if (!rec.ok) continue;
  const trial = elig.get(rec.nctId) || {};
  const out = fillParse(rec, trial.eligibilityCriteria, trial.minimumAge);
  parses[rec.nctId] = out.rec;
  addedAll.push(...out.added);
}
const scores = GOLD_SETS.map((spec) => scoreGoldSet(spec, parses));
const summaryPath = resolve(root, "notes/accuracy-raw/disclosed-variant-score-summary.json");
writeFileSync(summaryPath, JSON.stringify({
  note: "Disclosed variant only. Set 3 is no longer truly held out. Do not ship without review.",
  addedCheckCount: addedAll.length,
  addedByKind: addedAll.reduce((acc, a) => { acc[a.kind] = (acc[a.kind] || 0) + 1; return acc; }, {}),
  scores,
}, null, 2));
process.stderr.write(`Filled ${addedAll.length} normalizer checks into ${Object.keys(parses).length} parses (never prior_therapy). Not shipped.\n`);
for (const s of scores) {
  process.stderr.write(`set ${s.set}: ${s.typedHits}/${s.typedTotal} coverage ${s.coverage}%  ${s.unsafeReport}  prior-therapy unsafe ${s.priorTherapyUnsafe}  other unsafe ${s.otherUnsafe}  worse=${s.worseThanBaseline}\n`);
}
process.stderr.write(`Wrote ${summaryPath}\n`);
