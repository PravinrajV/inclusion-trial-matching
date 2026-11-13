import { judgeTypedCheck } from "./typed";
import {
  assignTier,
  classifyTrial,
  compareMatches,
  firstLineDemoted,
  laterLineBonus,
  structuredResults,
  tkiNaiveConflict,
  type DriverMatch,
  type MatchTier,
  type PopulationClass,
} from "./population";
import type { TrialMeta } from "../cache/trial-meta";
import type { FactSheet } from "../schema/fact-sheet";
import type { FuzzyCriterion, Judgment, ParsedTrial, TypedCheck } from "../schema/criterion";
import { GROUP_DISCUSS, GROUP_MET, GROUP_NOT_MET, POSSIBLE_MATCH_LABEL, STRONG_MATCH_LABEL, UNLIKELY_LABEL } from "../ui/copy";
import { describeVerdict, TRIAL_WORDS_CAPTION } from "../ui/verdict";

export type { DriverMatch, MatchTier, PopulationClass };

export interface CheckResult {
  check: TypedCheck;
  judgment: Judgment;
  group: string;
  quote: string;
  headline: string;
  quoteLabel: string;
}

export interface DiscussItem {
  group: typeof GROUP_DISCUSS;
  sourceText: string;
  reason?: string | undefined;
  polarity?: "inclusion" | "exclusion" | undefined;
}

export interface TrialMatch {
  nctId: string;
  briefTitle?: string | undefined;
  results: CheckResult[];
  discussItems: DiscussItem[];
  met: number;
  notMet: number;
  unknown: number;
  discuss: number;
  /** True when no quoted typed or structured check is not_met. Never means the person qualifies. */
  possibleMatch: boolean;
  label: string;
  tier: MatchTier;
  driverMatch: DriverMatch;
  population: PopulationClass;
  nsclcSpecific: boolean;
  recruiting: boolean;
  firstLineDemoted: boolean;
  laterLineBonus: boolean;
  miles?: number;
}

export interface TrialInput {
  trial: ParsedTrial;
  briefTitle?: string | undefined;
  meta?: TrialMeta | undefined;
  miles?: number | undefined;
}

function quoteOf(check: TypedCheck): string {
  return (check.evidence_quote || check.sourceText || "").trim();
}

function sameDriver(a: TypedCheck, b: TypedCheck): boolean {
  if (a.kind !== b.kind) return false;
  if (a.polarity !== b.polarity) return false;
  if (a.presence && b.presence && a.presence !== b.presence) return false;
  if (a.kind.endsWith("_variant_in")) return (a.stringValue || "").toLowerCase() === (b.stringValue || "").toLowerCase();
  return true;
}


function geneKey(kind: string): string | null {
  if (kind.startsWith("egfr")) return "EGFR";
  if (kind.startsWith("alk")) return "ALK";
  if (kind.startsWith("kras")) return "KRAS";
  if (kind.startsWith("ros1")) return "ROS1";
  if (kind.startsWith("braf")) return "BRAF";
  return null;
}

const GENE_MENTION: Record<string, RegExp> = {
  EGFR: /\bEGFR\b|epidermal growth factor receptor/i,
  ALK: /\bALK\b|anaplastic lymphoma kinase/i,
  KRAS: /\bKRAS\b|\bRAS\b/,
  ROS1: /\bROS-?1\b/,
  BRAF: /\bBRAF\b/,
};

function looksLikeDriverInclusion(text: string, gene: string): boolean {
  const mention = GENE_MENTION[gene] || new RegExp("\\b" + gene + "\\b", "i");
  if (!mention.test(text)) return false;
  const priorOnly = /\b(?:prior|previous|progressed on|washout|received|treated with)\b/i.test(text);
  const presence = /\b(?:mutation|rearrangement|fusion|alteration|positive|harbou?ring|exon|oncogenic)\b/i.test(text);
  if (priorOnly && !presence) return false;
  return presence;
}

/** Prefer a verbatim inclusion sentence over a title fragment when one exists. */
export function eligibilityQuoteForGene(trial: ParsedTrial, gene: string): string | undefined {
  const candidates: string[] = [];
  for (const check of trial.typedChecks || []) {
    if (check.polarity === "exclusion" || check.section === "exclusion") continue;
    const text = (check.evidence_quote || check.sourceText || "").trim();
    if (text && looksLikeDriverInclusion(text, gene)) candidates.push(text);
  }
  for (const item of trial.fuzzyCriteria || []) {
    if (item.polarity === "exclusion") continue;
    const text = (item.sourceText || "").trim();
    if (text && looksLikeDriverInclusion(text, gene)) candidates.push(text);
  }
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

function preferEligibilityQuotes(trial: ParsedTrial, results: CheckResult[]): void {
  for (const result of results) {
    const gene = geneKey(result.check.kind);
    if (!gene) continue;
    const better = eligibilityQuoteForGene(trial, gene);
    if (!better) continue;
    result.quote = better;
    result.quoteLabel = TRIAL_WORDS_CAPTION;
    result.check = { ...result.check, sourceText: better, evidence_quote: better };
  }
}

function contradictsStructured(check: TypedCheck, structured: CheckResult[]): boolean {
  const gene = geneKey(check.kind);
  if (!gene || !check.presence) return false;
  return structured.some((s) => {
    if (s.judgment === "unknown") return false;
    if (geneKey(s.check.kind) !== gene) return false;
    if (!s.check.presence) return false;
    if (s.check.polarity !== "inclusion" || check.polarity !== "inclusion") return false;
    return s.check.presence !== check.presence;
  });
}

function alreadyCovered(results: CheckResult[], check: TypedCheck): boolean {
  return results.some((r) => sameDriver(r.check, check));
}

export function evaluateTrial(sheet: FactSheet, trial: ParsedTrial, briefTitle?: string, meta?: TrialMeta, miles?: number): TrialMatch {
  const pop = classifyTrial(meta ? { ...meta, briefTitle: meta.briefTitle || briefTitle } : { briefTitle });
  const structured = structuredResults(sheet, pop);
  const positiveDriverMatch = structured.positiveDriverMatch;

  const results: CheckResult[] = [...structured.results];
  preferEligibilityQuotes(trial, results);
  for (const check of trial.typedChecks || []) {
    if (contradictsStructured(check, structured.results)) continue;
    if (alreadyCovered(results, check)) continue;
    const judgment = judgeTypedCheck(sheet, check);
    const group = judgment === "met" ? GROUP_MET : judgment === "not_met" ? GROUP_NOT_MET : GROUP_DISCUSS;
    const copy = describeVerdict(sheet, check, judgment);
    results.push({ check, judgment, group, quote: quoteOf(check), headline: copy.headline, quoteLabel: copy.quoteLabel });
  }

  const naiveConflict = tkiNaiveConflict(sheet, pop.priorLineHint);
  if (naiveConflict) {
    const quote = pop.priorLineQuote || "TKI-naive";
    const check: TypedCheck = {
      id: "structured-tki-naive",
      kind: "prior_therapy_excluded",
      polarity: "inclusion",
      sourceText: quote,
      evidence_quote: quote,
      stringValue: "a prior TKI",
    };
    results.push({
      check,
      judgment: "not_met",
      group: GROUP_NOT_MET,
      quote,
      headline: "Requires no prior TKI: the chart lists a prior targeted TKI.",
      quoteLabel: TRIAL_WORDS_CAPTION,
    });
  }

  const discussItems: DiscussItem[] = (trial.fuzzyCriteria || []).map((f: FuzzyCriterion) => {
    const item: DiscussItem = {
      group: GROUP_DISCUSS,
      sourceText: f.sourceText,
      reason: f.reasonFuzzy,
    };
    if (f.polarity) item.polarity = f.polarity;
    return item;
  });
  const met = results.filter((r) => r.judgment === "met").length;
  const notMet = results.filter((r) => r.judgment === "not_met").length;
  const unknown = results.filter((r) => r.judgment === "unknown").length;
  const discuss = unknown + discussItems.length;
  const possibleMatch = notMet === 0 && (results.length > 0 || discussItems.length > 0);
  const demoted = firstLineDemoted(sheet, pop.priorLineHint);
  const later = laterLineBonus(sheet, pop.priorLineHint);
  const tier = assignTier({
    notMet,
    driverMatch: structured.driverMatch,
    positiveDriverMatch,
    population: pop.population,
    firstLineDemoted: demoted,
    tkiNaiveConflict: naiveConflict,
    recruiting: pop.recruiting,
  });
  const label = tier === "strong" ? STRONG_MATCH_LABEL : tier === "unlikely" ? UNLIKELY_LABEL : POSSIBLE_MATCH_LABEL;
  const out: TrialMatch = {
    nctId: trial.nctId,
    results,
    discussItems,
    met,
    notMet,
    unknown,
    discuss,
    possibleMatch,
    label,
    tier,
    driverMatch: structured.driverMatch,
    population: pop.population,
    nsclcSpecific: pop.nsclcSpecific,
    recruiting: pop.recruiting,
    firstLineDemoted: demoted,
    laterLineBonus: later,
  };
  if (briefTitle) out.briefTitle = briefTitle;
  if (miles != null) out.miles = miles;
  return out;
}

/** Rank by positive evidence: tier, confirmed driver, NSCLC-specific, later-line bonus, quoted met, recruiting, distance. */
export function rankTrials(sheet: FactSheet, trials: TrialInput[]): TrialMatch[] {
  return trials
    .map((item) => evaluateTrial(sheet, item.trial, item.briefTitle, item.meta, item.miles))
    .sort((a, b) =>
      compareMatches(
        {
          tier: a.tier,
          driverMatch: a.driverMatch,
          nsclcSpecific: a.nsclcSpecific,
          met: a.met,
          discuss: a.discuss,
          laterLineBonus: a.laterLineBonus,
          recruiting: a.recruiting,
          miles: a.miles,
        },
        {
          tier: b.tier,
          driverMatch: b.driverMatch,
          nsclcSpecific: b.nsclcSpecific,
          met: b.met,
          discuss: b.discuss,
          laterLineBonus: b.laterLineBonus,
          recruiting: b.recruiting,
          miles: b.miles,
        },
      ),
    );
}

/** Visible default list: Strong and Possible only, capped. */
export function visibleShortlist(ranked: TrialMatch[], cap = 8): {
  shown: TrialMatch[];
  strong: number;
  possible: number;
  unlikely: number;
} {
  const strong = ranked.filter((m) => m.tier === "strong").length;
  const possible = ranked.filter((m) => m.tier === "possible").length;
  const unlikely = ranked.filter((m) => m.tier === "unlikely").length;
  const shown = ranked.filter((m) => m.tier !== "unlikely").slice(0, cap);
  return { shown, strong, possible, unlikely };
}

/** Backward-compatible helper used by older tests: no quoted Not-met, then fewer Discuss, then more Met. */
export function rankPossibleMatches(sheet: FactSheet, trials: { trial: ParsedTrial; briefTitle?: string | undefined }[]): TrialMatch[] {
  return rankTrials(sheet, trials).filter((m) => m.possibleMatch && m.tier !== "unlikely");
}
