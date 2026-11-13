/**
 * Option (a) public-trial parse gates.
 * Gemini (Firebase AI Logic) produces the typed checks. The deterministic
 * normalizer only verifies them. Disagreements and unquoted items go to Discuss.
 * Public eligibility text only. Never takes a chart or persona.
 */
import { extractTypedChecks } from "./normalize-eligibility.mjs";
import {
  checksJudgmentEquivalent,
  normalizeEligibility,
  valuesMatchGold,
} from "./postprocess-parse.mjs";

export const PIPELINE_ID = "ai-logic-v3-quote-two-run-verifier";
export const PROMPT_VERSION = "3";
export const PARSER_MODEL = "gemini-3.5-flash-lite";
export const MIN_QUOTE_CHARS = 8;

export function quoteOf(check) {
  return String(check?.evidence_quote || check?.evidenceQuote || check?.sourceText || "").trim();
}

export function isVerbatimQuote(quote, eligibility, { minLength = MIN_QUOTE_CHARS } = {}) {
  const q = normalizeEligibility(quote);
  const t = normalizeEligibility(eligibility);
  if (q.length < minLength) return false;
  if (t.includes(q)) return true;
  return t.toLowerCase().includes(q.toLowerCase());
}

export function valueKey(check) {
  if (!check) return "empty";
  if (check.numberValue != null) return `n:${check.numberValue}`;
  if (check.stringValue) return `s:${String(check.stringValue).toLowerCase()}`;
  if (check.presence) return `p:${check.presence}`;
  if (check.stages) return `st:${[...check.stages].sort().join(",")}`;
  if (check.histologies) return `h:${[...check.histologies].sort().join(",")}`;
  if (check.allowedBrainMets) return `b:${[...check.allowedBrainMets].sort().join(",")}`;
  return "empty";
}

export function checksAgree(a, b) {
  if (!a || !b) return false;
  if (checksJudgmentEquivalent(a, b)) return true;
  if (a.kind === b.kind && a.polarity === b.polarity && valuesMatchGold(a, b) && valuesMatchGold(b, a)) return true;
  return a.kind === b.kind && a.polarity === b.polarity && valueKey(a) === valueKey(b);
}

function toDiscuss(check, reason) {
  return {
    id: check.id || `discuss-${check.kind || "item"}`,
    polarity: check.polarity || "inclusion",
    sourceText: quoteOf(check),
    reasonFuzzy: reason,
  };
}

/**
 * Keep a typed check only when its evidence quote is a verbatim substring
 * of the public eligibility text. Missing or paraphrased quotes go to Discuss.
 */
export function applyQuoteGate(parsed, eligibility) {
  const typedChecks = [];
  const fuzzyCriteria = Array.isArray(parsed?.fuzzyCriteria) ? parsed.fuzzyCriteria.map((f) => ({ ...f })) : [];
  const unquoted = [];
  for (const raw of parsed?.typedChecks || []) {
    const check = { ...raw };
    const q = quoteOf(check);
    if (isVerbatimQuote(q, eligibility)) {
      typedChecks.push({ ...check, sourceText: q, evidence_quote: q });
    } else {
      const reason = q
        ? "evidence quote was not a verbatim substring of the trial text"
        : "typed check had no evidence quote";
      unquoted.push({ kind: check.kind, polarity: check.polarity, reason, quote: q.slice(0, 160) });
      fuzzyCriteria.push(toDiscuss(check, reason));
    }
  }
  return { typedChecks, fuzzyCriteria, unquoted };
}

/**
 * Intersection of two independent model runs. A-only or B-only typed checks
 * are demoted to Discuss.
 */
export function applyConsistencyGate(runA, runB) {
  const usedB = new Set();
  const typedChecks = [];
  const disagreements = [];
  const fuzzyCriteria = [
    ...(runA?.fuzzyCriteria || []).map((f) => ({ ...f })),
    ...(runB?.fuzzyCriteria || []).map((f) => ({ ...f })),
  ];
  for (const a of runA?.typedChecks || []) {
    const idx = (runB?.typedChecks || []).findIndex((b, i) => !usedB.has(i) && checksAgree(a, b));
    if (idx >= 0) {
      usedB.add(idx);
      const b = runB.typedChecks[idx];
      const quote = quoteOf(a).length >= quoteOf(b).length ? quoteOf(a) : quoteOf(b);
      typedChecks.push({ ...a, sourceText: quote, evidence_quote: quote });
    } else {
      disagreements.push({ side: "a-only", kind: a.kind, polarity: a.polarity, value: valueKey(a) });
      fuzzyCriteria.push(toDiscuss(a, "two-run consistency: only in run A"));
    }
  }
  for (const [i, b] of (runB?.typedChecks || []).entries()) {
    if (usedB.has(i)) continue;
    disagreements.push({ side: "b-only", kind: b.kind, polarity: b.polarity, value: valueKey(b) });
    fuzzyCriteria.push(toDiscuss(b, "two-run consistency: only in run B"));
  }
  return { typedChecks, fuzzyCriteria, disagreements };
}

/**
 * Fail-closed verifier: the deterministic normalizer may confirm a model
 * check or reject it. It does not add typed checks the model did not emit.
 */
export function applyNormalizerVerifier(modelParsed, eligibility, nctId, options = {}) {
  const norm = extractTypedChecks(eligibility, nctId, options);
  const typedChecks = [];
  const rejectedByVerifier = [];
  const fuzzyCriteria = (modelParsed?.fuzzyCriteria || []).map((f) => ({ ...f }));
  for (const c of modelParsed?.typedChecks || []) {
    const hit = (norm.typedChecks || []).find((n) => checksAgree(c, n));
    if (hit) {
      typedChecks.push({ ...c, verifier: "deterministic-normalizer" });
    } else {
      rejectedByVerifier.push({ kind: c.kind, polarity: c.polarity, value: valueKey(c) });
      fuzzyCriteria.push(toDiscuss(c, "deterministic normalizer did not verify this model check"));
    }
  }
  return {
    typedChecks,
    fuzzyCriteria,
    rejectedByVerifier,
    normalizerTypedCount: (norm.typedChecks || []).length,
  };
}

/**
 * Full option-(a) merge of two raw model JSON payloads plus public eligibility text.
 * Does not run postprocess adders: those would let the normalizer produce checks.
 */
export function mergeTwoRuns(rawA, rawB, eligibility, nctId, options = {}) {
  const quotedA = applyQuoteGate(rawA || { typedChecks: [], fuzzyCriteria: [] }, eligibility);
  const quotedB = applyQuoteGate(rawB || { typedChecks: [], fuzzyCriteria: [] }, eligibility);
  const consistent = applyConsistencyGate(quotedA, quotedB);
  const verified = applyNormalizerVerifier(consistent, eligibility, nctId, options);
  return {
    pipeline: PIPELINE_ID,
    parserModel: PARSER_MODEL,
    promptVersion: PROMPT_VERSION,
    nctId,
    typedChecks: verified.typedChecks,
    fuzzyCriteria: verified.fuzzyCriteria,
    gates: {
      quoteA: { kept: quotedA.typedChecks.length, unquoted: quotedA.unquoted.length, unquotedItems: quotedA.unquoted },
      quoteB: { kept: quotedB.typedChecks.length, unquoted: quotedB.unquoted.length, unquotedItems: quotedB.unquoted },
      consistency: {
        agreed: consistent.typedChecks.length,
        disagreements: consistent.disagreements.length,
        disagreementItems: consistent.disagreements,
      },
      verifier: {
        verified: verified.typedChecks.length,
        rejected: verified.rejectedByVerifier.length,
        rejectedItems: verified.rejectedByVerifier,
        normalizerTypedCount: verified.normalizerTypedCount,
      },
    },
  };
}
