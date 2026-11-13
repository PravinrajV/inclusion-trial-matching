import type { FactSheet } from "../schema/fact-sheet";
import type { Judgment, TypedCheck } from "../schema/criterion";
import { driverRowMetThroughOrList, geneKeyFromKind, unknownDriverCoveredByOrList } from "./driver-or";
import { markSic } from "./sic";

export interface VerdictCopy {
  headline: string;
  quoteLabel: string;
}

const GENE: Record<string, string> = {
  egfr_status: "EGFR",
  alk_status: "ALK",
  kras_status: "KRAS",
  ros1_status: "ROS1",
  braf_status: "BRAF",
  egfr_variant_in: "EGFR",
  kras_variant_in: "KRAS",
};

export const TRIAL_WORDS_CAPTION = "Trial's own words";

export function quoteLabelFor(_section?: "inclusion" | "exclusion", _polarity?: "inclusion" | "exclusion"): string {
  return TRIAL_WORDS_CAPTION;
}

export function describeVerdict(sheet: FactSheet, check: TypedCheck, judgment: Judgment): VerdictCopy {
  const headline = headlineFor(sheet, check, judgment);
  return { headline, quoteLabel: quoteLabelFor(check.section, check.polarity) };
}

function headlineFor(sheet: FactSheet, check: TypedCheck, judgment: Judgment): string {
  const exclusion = check.polarity === "exclusion";
  switch (check.kind) {
    case "brain_mets":
      return brainLine(sheet, check, judgment, exclusion);
    case "egfr_status":
    case "alk_status":
    case "kras_status":
    case "ros1_status":
    case "braf_status":
      return statusLine(sheet, check, judgment, exclusion, GENE[check.kind] || check.kind);
    case "egfr_variant_in":
    case "kras_variant_in":
      return variantLine(sheet, check, judgment, exclusion, GENE[check.kind] || check.kind);
    case "stage_in":
      return stageLine(sheet, check, judgment, exclusion);
    case "histology_in":
      return histologyLine(sheet, check, judgment, exclusion);
    case "ecog_max":
      return numberLine(sheet, check, judgment, exclusion, "ECOG", sheet.ecog);
    case "age_min":
      return boundLine(judgment, exclusion, "age", "or older", check.numberValue, sheet.ageYears, "years");
    case "age_max":
      return boundLine(judgment, exclusion, "age", "or younger", check.numberValue, sheet.ageYears, "years");
    case "prior_lines_min":
      return boundLine(judgment, exclusion, "prior systemic therapy lines", "or more", check.numberValue, sheet.priorSystemicLines, "");
    case "prior_lines_max":
      return boundLine(judgment, exclusion, "prior systemic therapy lines", "or fewer", check.numberValue, sheet.priorSystemicLines, "");
    case "prior_therapy_required":
      return therapyLine(sheet, check, judgment, exclusion, false);
    case "prior_therapy_excluded":
      return therapyLine(sheet, check, judgment, exclusion, true);
    case "pdl1_min":
      return labLine(judgment, exclusion, "PD-L1 TPS", "≥", check.numberValue, sheet.biomarkers.pdL1TpsPercent, "%");
    case "pdl1_max":
      return labLine(judgment, exclusion, "PD-L1 TPS", "≤", check.numberValue, sheet.biomarkers.pdL1TpsPercent, "%");
    case "egfr_min":
      return labLine(judgment, exclusion, "eGFR", "≥", check.numberValue, sheet.organFunction.egfrMlMin, "mL/min");
    case "hemoglobin_min":
      return labLine(judgment, exclusion, "Hemoglobin", "≥", check.numberValue, sheet.organFunction.hemoglobinGdl, "g/dL");
    case "anc_min":
      return labLine(judgment, exclusion, "ANC", "≥", check.numberValue, sheet.organFunction.ancPerUl, "/µL");
    case "platelets_min":
      return labLine(judgment, exclusion, "Platelets", "≥", check.numberValue, sheet.organFunction.plateletsPerUl, "/µL");
    case "creatinine_max":
      return labLine(judgment, exclusion, "Creatinine", "≤", check.numberValue, sheet.organFunction.creatinineMgDl, "mg/dL");
    case "bilirubin_max":
      return labLine(judgment, exclusion, "Total bilirubin", "≤ × ULN", check.numberValue, sheet.organFunction.totalBilirubinMgDl, "", "mg/dL");
    case "ast_max":
      return labLine(judgment, exclusion, "AST", "≤ × ULN", check.numberValue, sheet.organFunction.astUL, "", "U/L");
    case "alt_max":
      return labLine(judgment, exclusion, "ALT", "≤ × ULN", check.numberValue, sheet.organFunction.altUL, "", "U/L");
    default:
      return fallbackLine(check, judgment, exclusion);
  }
}

function brainPhrase(status: FactSheet["brainMets"]["status"]): string {
  if (status === "none") return "no brain metastases";
  if (status === "treated_stable") return "treated and stable brain metastases";
  if (status === "untreated") return "untreated brain metastases";
  return "unknown brain-metastasis status";
}

function brainLine(sheet: FactSheet, check: TypedCheck, judgment: Judgment, exclusion: boolean): string {
  const allowed = check.allowedBrainMets || [];
  const actual = sheet.brainMets.status;
  const onlyUntreated = allowed.length === 1 && allowed[0] === "untreated";
  const anyBrain = allowed.includes("untreated") && allowed.includes("treated_stable") && !allowed.includes("none");
  if (judgment === "unknown") return "Brain metastases still need a closer look with your care team.";
  if (exclusion) {
    if (judgment === "met") {
      if (onlyUntreated) return "Exclusion avoided: no untreated or unstable brain metastases in the chart.";
      if (anyBrain && actual === "none") return "Exclusion avoided: no brain metastases in the chart.";
      return `Exclusion avoided: chart shows ${brainPhrase(actual)}.`;
    }
    return `Excluded for brain metastases: chart shows ${brainPhrase(actual)}.`;
  }
  if (judgment === "met") {
    if (allowed.includes("none") && allowed.includes("treated_stable") && !allowed.includes("untreated")) {
      return `Requires no untreated brain metastases: chart shows ${brainPhrase(actual)}.`;
    }
    return `Brain-metastasis rule met: chart shows ${brainPhrase(actual)}.`;
  }
  return `Brain-metastasis rule not met: chart shows ${brainPhrase(actual)}.`;
}

function statusLine(sheet: FactSheet, check: TypedCheck, judgment: Judgment, exclusion: boolean, gene: string): string {
  const actual = presenceOf(sheet, check.kind);
  const expected = check.presence;
  const article = /^[AEIOUaeiou]/.test(gene) ? "an" : "a";
  const named = chartVariantPhrase(sheet, gene);
  const chart =
    actual === "present"
      ? named
        ? `chart: ${named}`
        : `chart shows ${article} ${gene} alteration`
      : actual === "absent"
        ? `chart shows ${gene} is absent`
        : `${gene} status is not on the fact sheet`;
  if (judgment === "unknown") return `${gene} status still needs a closer look with your care team.`;
  if (exclusion) {
    if (judgment === "met") {
      if (expected === "present") return `Exclusion avoided: no ${gene} alteration in the chart.`;
      return `Exclusion avoided: ${chart}.`;
    }
    return `Excluded if ${gene} is ${expected === "absent" ? "absent" : "present"}: ${chart}.`;
  }
  if (expected === "present") {
    return `Requires ${article} ${gene} alteration: ${chart}.`;
  }
  if (expected === "absent") {
    return `Requires no ${gene} alteration: ${chart}.`;
  }
  return `${gene} rule ${judgment === "met" ? "met" : "not met"}: ${chart}.`;
}

function variantLine(sheet: FactSheet, check: TypedCheck, judgment: Judgment, exclusion: boolean, gene: string): string {
  const needed = prettyVariant(check.stringValue || "a listed variant");
  const actualStatus = check.kind === "kras_variant_in" ? sheet.biomarkers.kras.status : sheet.biomarkers.egfr.status;
  const actualVariant = check.kind === "kras_variant_in" ? sheet.biomarkers.kras.variant : sheet.biomarkers.egfr.variant;
  const chart =
    actualVariant
      ? `chart: ${gene} ${prettyVariant(actualVariant)}`
      : actualStatus === "absent"
        ? `chart shows ${gene} is absent`
        : `${gene} variant is not on the fact sheet`;
  if (judgment === "unknown") return `${gene} ${needed} still needs a closer look with your care team.`;
  if (exclusion) {
    return judgment === "met"
      ? `Exclusion avoided: ${gene} ${needed} is not in the chart.`
      : `Excluded if ${gene} ${needed} is present: ${chart}.`;
  }
  return judgment === "met"
    ? `Requires ${gene} ${needed}: ${chart}.`
    : `Requires ${gene} ${needed}: ${chart}.`;
}

function stageLine(sheet: FactSheet, check: TypedCheck, judgment: Judgment, exclusion: boolean): string {
  const need = listOr(check.stages || []);
  const chart = sheet.stage === "unknown" ? "stage is not on the fact sheet" : `chart shows stage ${sheet.stage}`;
  if (judgment === "unknown") return "Stage still needs a closer look with your care team.";
  if (exclusion) {
    return judgment === "met"
      ? `Exclusion avoided: the chart is not in the excluded stages (${need}).`
      : `Excluded for stages ${need}: ${chart}.`;
  }
  return `Requires stage ${need}: ${chart}.`;
}

function histologyLine(sheet: FactSheet, check: TypedCheck, judgment: Judgment, exclusion: boolean): string {
  const need = listOr((check.histologies || []).map(prettyHistology));
  const chart = sheet.histology === "unknown" ? "histology is not on the fact sheet" : `chart shows ${prettyHistology(sheet.histology)}`;
  if (judgment === "unknown") return "Histology still needs a closer look with your care team.";
  if (exclusion) {
    return judgment === "met" ? `Exclusion avoided: the chart is not ${need}.` : `Excluded if histology is ${need}: ${chart}.`;
  }
  return `Requires ${need}: ${chart}.`;
}

function boundLine(
  judgment: Judgment,
  exclusion: boolean,
  noun: string,
  direction: string,
  expected: number | undefined,
  actual: number | null | undefined,
  unit: string,
): string {
  const need = expected == null ? noun : `${formatNum(expected)}${unit ? " " + unit : ""} ${direction}`.trim();
  const chart = actual == null ? `${noun} is not on the fact sheet` : `chart shows ${formatNum(actual)}${unit ? " " + unit : ""}`;
  if (judgment === "unknown") return `${capitalize(noun)} still needs a closer look with your care team.`;
  if (exclusion) {
    return judgment === "met" ? `Exclusion avoided: ${chart}.` : `Excluded by the ${noun} rule (${need}): ${chart}.`;
  }
  return `Requires ${need}: ${chart}.`;
}


function withUnit(n: number, unit: string): string {
  if (!unit) return formatNum(n);
  if (unit.startsWith("/")) return `${formatNum(n)}${unit}`;
  return `${formatNum(n)} ${unit}`;
}

/** Lab headlines name the test and the trial's threshold, then the chart value. */
function labLine(
  judgment: Judgment,
  exclusion: boolean,
  noun: string,
  op: "≥" | "≤" | "≤ × ULN",
  expected: number | undefined,
  actual: number | null | undefined,
  unit: string,
  actualUnit?: string,
): string {
  let threshold = noun;
  if (expected != null) {
    if (op === "≤ × ULN") {
      threshold = expected <= 10 ? `${noun} ≤ ${formatNum(expected)} × ULN` : `${noun} ≤ ${formatNum(expected)}`;
    } else {
      threshold = `${noun} ${op} ${withUnit(expected, unit)}`;
    }
  }
  const shownUnit = actualUnit ?? unit;
  const chart = actual == null ? "chart does not list this test" : `chart shows ${withUnit(actual, shownUnit)}`;
  if (judgment === "unknown") return `${threshold} still needs a closer look with your care team.`;
  if (exclusion) {
    return judgment === "met" ? `Exclusion avoided: ${threshold}: ${chart}.` : `Excluded by ${threshold}: ${chart}.`;
  }
  return `${threshold}: ${chart}.`;
}

function numberLine(
  _sheet: FactSheet,
  check: TypedCheck,
  judgment: Judgment,
  exclusion: boolean,
  noun: string,
  actual: number | null | undefined,
): string {
  const max = check.numberValue;
  const need = max == null ? noun : `${noun} ${rangeTo(max)}`;
  const chart = actual == null ? `${noun} is not on the fact sheet` : `chart shows ${noun} ${actual}`;
  if (judgment === "unknown") return `${noun} still needs a closer look with your care team.`;
  if (exclusion) {
    return judgment === "met" ? `Exclusion avoided: ${chart}.` : `Excluded by the ${noun} rule: ${chart}.`;
  }
  return `Requires ${need}: ${chart}.`;
}

function therapyLine(sheet: FactSheet, check: TypedCheck, judgment: Judgment, exclusion: boolean, excludedKind: boolean): string {
  const drug = check.stringValue || "the listed therapy";
  const list = sheet.priorTherapies.length ? `chart lists ${sheet.priorTherapies.join(", ")}` : "no prior therapies are listed on the fact sheet";
  if (judgment === "unknown") return `Prior therapy (${drug}) still needs a closer look with your care team.`;
  const asExclusion = exclusion || excludedKind;
  if (asExclusion && judgment === "met") return `Exclusion avoided: ${drug} is not in the prior therapies listed.`;
  if (asExclusion && judgment === "not_met") return `Excluded if prior ${drug} is present: ${list}.`;
  if (judgment === "met") return `Requires prior ${drug}: ${list}.`;
  return `Requires prior ${drug}: ${list}.`;
}

function fallbackLine(_check: TypedCheck, judgment: Judgment, exclusion: boolean): string {
  if (judgment === "unknown") return "This criterion still needs a closer look with your care team.";
  if (exclusion) return judgment === "met" ? "Exclusion avoided, based on the fact sheet." : "An exclusion rule was not met, based on the fact sheet.";
  return judgment === "met" ? "This criterion was met, based on the fact sheet." : "This criterion was not met, based on the fact sheet.";
}

function presenceOf(sheet: FactSheet, kind: string): FactSheet["biomarkers"]["egfr"]["status"] {
  if (kind.startsWith("alk")) return sheet.biomarkers.alk.status;
  if (kind.startsWith("kras")) return sheet.biomarkers.kras.status;
  if (kind.startsWith("ros1")) return sheet.biomarkers.ros1.status;
  if (kind.startsWith("braf")) return sheet.biomarkers.braf.status;
  return sheet.biomarkers.egfr.status;
}

function prettyVariant(raw: string): string {
  return raw.replace(/\s*,\s*/g, " or ").replace(/\bex19del\b/gi, "exon 19 deletion").trim();
}

function chartVariantPhrase(sheet: FactSheet, gene: string): string | null {
  const key = gene.toLowerCase() === "ras" ? "kras" : gene.toLowerCase();
  const markers = sheet.biomarkers;
  const marker =
    key === "egfr" ? markers.egfr :
    key === "alk" ? markers.alk :
    key === "kras" ? markers.kras :
    key === "ros1" ? markers.ros1 :
    key === "braf" ? markers.braf :
    null;
  if (!marker?.variant) return null;
  return `${gene} ${prettyVariant(marker.variant)}`;
}

function prettyHistology(h: string): string {
  if (h === "adenocarcinoma") return "adenocarcinoma";
  if (h === "squamous") return "squamous histology";
  if (h === "large_cell") return "large-cell histology";
  if (h === "nsclc_nos") return "NSCLC, not otherwise specified";
  return h.replaceAll("_", " ");
}

function rangeTo(max: number): string {
  if (max <= 0) return "0";
  const parts = [];
  for (let i = 0; i <= max; i++) parts.push(String(i));
  return listOr(parts);
}

function listOr(items: string[]): string {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} or ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, or ${clean[clean.length - 1]}`;
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Highlight only an interior evidence span. If the quote is the whole line, leave it unhighlighted. */
export function renderQuoteHtml(sourceText: string, evidenceQuote: string, escape: (s: string) => string): string {
  const source = markSic((sourceText || "").trim());
  const ev = (evidenceQuote || "").trim();
  if (!source && !ev) return "";
  if (!ev || !source) return escape(source || ev);
  if (source.toLowerCase() === ev.toLowerCase()) return escape(source);
  const idx = source.toLowerCase().indexOf(ev.toLowerCase());
  if (idx < 0) return escape(source);
  const before = source.slice(0, idx);
  const hit = source.slice(idx, idx + ev.length);
  const after = source.slice(idx + ev.length);
  return `${escape(before)}<mark>${escape(hit)}</mark>${escape(after)}`;
}

export function askYourOncologistItems(
  results: {
    judgment: Judgment;
    headline?: string;
    quote?: string;
    check?: {
      kind: string;
      polarity?: string;
      presence?: string;
      stringValue?: string;
      numberValue?: number;
      stages?: string[];
      evidence_quote?: string;
      sourceText?: string;
    };
  }[],
  discussItems: { sourceText: string; reason?: string | undefined }[],
  limit = 2,
): string[] {
  const driverItems = results.filter((r) => geneKeyFromKind(r.check?.kind));
  const skipCoveredUnknownDrivers = driverRowMetThroughOrList(driverItems);
  const asks: string[] = [];
  for (const r of results) {
    if (r.judgment !== "unknown") continue;
    if (
      skipCoveredUnknownDrivers &&
      r.check &&
      geneKeyFromKind(r.check.kind) &&
      unknownDriverCoveredByOrList(r, driverItems)
    ) {
      continue;
    }
    const ask = askFromUnknownCheck(r.check, r.headline);
    if (!ask) continue;
    asks.push(ask);
    if (asks.length >= limit) return asks;
  }
  for (const d of discussItems) {
    const ask = specificDiscussAsk(d.reason, d.sourceText);
    if (!ask) continue;
    asks.push(ask);
    if (asks.length >= limit) return asks;
  }
  return asks;
}

function askFromUnknownCheck(
  check: { kind: string; polarity?: string; presence?: string; stringValue?: string; numberValue?: number; stages?: string[] } | undefined,
  _headline?: string,
): string | null {
  if (!check) return null;
  const kind = check.kind;
  const drug = check.stringValue || "the listed therapy";
  if (kind === "prior_therapy_excluded") return `Have you had prior ${drug}? The trial excludes it.`;
  if (kind === "prior_therapy_required") return `Have you had prior ${drug}? The trial requires it.`;
  if (kind === "egfr_status") return presenceAsk("EGFR", check.presence);
  if (kind === "alk_status") return presenceAsk("ALK", check.presence);
  if (kind === "kras_status") return presenceAsk("KRAS", check.presence);
  if (kind === "ros1_status") return presenceAsk("ROS1", check.presence);
  if (kind === "braf_status") return presenceAsk("BRAF", check.presence);
  if (kind === "egfr_variant_in") return `Does the chart document EGFR ${prettyVariant(check.stringValue || "the listed variant")}? This trial requires it.`;
  if (kind === "kras_variant_in") return `Does the chart document KRAS ${prettyVariant(check.stringValue || "the listed variant")}? This trial requires it.`;
  if (kind === "brain_mets") return "What is the current status of any brain metastases? This trial has a rule about them.";
  if (kind === "ecog_max") return check.numberValue == null ? "What is the current ECOG performance status? This trial has an ECOG limit." : `What is the current ECOG performance status? This trial requires ECOG ${rangeTo(check.numberValue)} or lower.`;
  if (kind === "stage_in") return check.stages?.length ? `What is the documented stage? This trial requires stage ${listOr(check.stages)}.` : null;
  if (kind === "histology_in") return "What histology is documented? This trial limits which histologies it will consider.";
  if (kind === "pdl1_min") return `What is the PD-L1 TPS? This trial requires ${formatNum(check.numberValue ?? 0)}% or higher.`;
  if (kind === "pdl1_max") return `What is the PD-L1 TPS? This trial requires ${formatNum(check.numberValue ?? 0)}% or lower.`;
  if (kind === "age_min") return `The trial requires age ${formatNum(check.numberValue ?? 18)} or older. Is that consistent with the chart?`;
  if (kind === "age_max") return `The trial requires age ${formatNum(check.numberValue ?? 0)} or younger. Is that consistent with the chart?`;
  if (kind === "prior_lines_min") return `How many prior systemic therapy lines are documented? This trial requires ${formatNum(check.numberValue ?? 0)} or more.`;
  if (kind === "prior_lines_max") return `How many prior systemic therapy lines are documented? This trial allows ${formatNum(check.numberValue ?? 0)} or fewer.`;
  if (kind === "egfr_min") return `What is the kidney function (eGFR)? This trial requires ${formatNum(check.numberValue ?? 0)} mL/min or higher.`;
  if (kind === "hemoglobin_min") return `What is the hemoglobin? This trial requires ${formatNum(check.numberValue ?? 0)} g/dL or higher.`;
  if (kind === "anc_min") return `What is the neutrophil count? This trial has a minimum ANC.`;
  if (kind === "platelets_min") return `What is the platelet count? This trial has a minimum platelet level.`;
  if (kind === "creatinine_max") return `What is the creatinine? This trial has a maximum creatinine level.`;
  if (kind === "bilirubin_max") return `What is the total bilirubin? This trial has a maximum bilirubin level.`;
  if (kind === "ast_max") return `What is the AST? This trial has a maximum AST level.`;
  if (kind === "alt_max") return `What is the ALT? This trial has a maximum ALT level.`;
  return null;
}

function presenceAsk(gene: string, presence?: string): string {
  if (presence === "absent") return `Is ${gene} absent in the tumor? This trial requires no ${gene} alteration.`;
  return `Does the chart document a ${gene} alteration? This trial requires it.`;
}

export function plainDiscussAsk(reason: string | undefined, sourceText: string): string | null {
  return specificDiscussAsk(reason, sourceText);
}

function specificDiscussAsk(reason: string | undefined, sourceText: string): string | null {
  const why = (reason || "").toLowerCase();
  if (why.includes("minimumage") || why.includes("structured age") || why.includes("verbatim eligibility")) return null;
  if (why.includes("not in the six-type") || why.includes("held for discussion")) {
    return namedCriterionAsk(sourceText);
  }
  return namedCriterionAsk(sourceText);
}

function namedCriterionAsk(sourceText: string): string | null {
  const text = (sourceText || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const prior = text.match(/\bprior(?:\s+(?:treatment|therapy|exposure|use))(?:\s+with)?\s+([^.,;]{3,80}?)(?:\s+(?:is|are|was|within|therapy|treatment)\b|[.,;]|$)/i);
  const received = text.match(/(?:received|treated with|treatment with)\s+([^.,;]{3,80}?)(?:\s+within|[.,;]|$)/i);
  const noPrior = /\bno prior\b|\bmust not have (?:received|been treated)|\nexclusion[\s\S]{0,40}prior/i.test(text);
  const hit = prior || received;
  if (hit) {
    const drug = hit[1].replace(/\s+/g, " ").trim().replace(/\.$/, "").replace(/^(?:prior\s+)+/i, "");
    if (drug.length < 3) return null;
    if (/^(to|enrollment|study)\b|last dose|four months|within \d/i.test(drug)) return null;
    return noPrior || /exclud/i.test(text)
      ? `Have you had prior ${drug}? The trial excludes it.`
      : `Have you had prior ${drug}? The trial mentions this therapy.`;
  }
  const driver = text.match(/\b(KRAS\s*G12C|EGFR\s+exon\s*\d+\s+\w+|EGFR|ALK|ROS1|BRAF|MET|HER-?2|MTAP[-\s]?deleted)\b/i);
  if (driver && /prior|inhibitor|treated|received/i.test(text)) {
    return `Have you had prior ${driver[1]} inhibitor treatment? The trial mentions it.`;
  }
  return null;
}
