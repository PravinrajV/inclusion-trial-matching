import type { FactSheet } from "../schema/fact-sheet";
import type { Judgment, TypedCheck } from "../schema/criterion";

export function judgeTypedCheck(sheet: FactSheet, check: TypedCheck): Judgment {
  const raw = rawJudgment(sheet, check);
  if (check.polarity === "exclusion") {
    if (raw === "met") return "not_met";
    if (raw === "not_met") return "met";
    return "unknown";
  }
  return raw;
}

function rawJudgment(sheet: FactSheet, check: TypedCheck): Judgment {
  switch (check.kind) {
    case "age_min":
      return compareNumber(sheet.ageYears, check.numberValue, ">=");
    case "age_max":
      return compareNumber(sheet.ageYears, check.numberValue, "<=");
    case "ecog_max":
      return compareNumber(sheet.ecog, check.numberValue, "<=");
    case "stage_in":
      if (sheet.stage === "unknown") return "unknown";
      if (!check.stages?.length) return "unknown";
      return check.stages.includes(sheet.stage) ? "met" : "not_met";
    case "histology_in":
      if (sheet.histology === "unknown") return "unknown";
      if (!check.histologies?.length) return "unknown";
      return check.histologies.includes(sheet.histology) ? "met" : "not_met";
    case "egfr_status":
      return matchPresence(sheet.biomarkers.egfr.status, check.presence);
    case "alk_status":
      return matchPresence(sheet.biomarkers.alk.status, check.presence);
    case "kras_status":
      return matchPresence(sheet.biomarkers.kras.status, check.presence);
    case "ros1_status":
      return matchPresence(sheet.biomarkers.ros1.status, check.presence);
    case "braf_status":
      return matchPresence(sheet.biomarkers.braf.status, check.presence);
    case "egfr_variant_in":
      return matchVariant(sheet.biomarkers.egfr.status, sheet.biomarkers.egfr.variant, check.stringValue);
    case "kras_variant_in":
      return matchVariant(sheet.biomarkers.kras.status, sheet.biomarkers.kras.variant, check.stringValue);
    case "pdl1_min":
      return compareNumber(sheet.biomarkers.pdL1TpsPercent, check.numberValue, ">=");
    case "pdl1_max":
      return compareNumber(sheet.biomarkers.pdL1TpsPercent, check.numberValue, "<=");
    case "prior_lines_min":
      return compareNumber(sheet.priorSystemicLines, check.numberValue, ">=");
    case "prior_lines_max":
      return compareNumber(sheet.priorSystemicLines, check.numberValue, "<=");
    case "prior_therapy_required":
      return matchTherapy(sheet.priorTherapies, check.stringValue, true);
    case "prior_therapy_excluded":
      return matchTherapy(sheet.priorTherapies, check.stringValue, true);
    case "brain_mets":
      if (sheet.brainMets.status === "unknown") return "unknown";
      if (!check.allowedBrainMets?.length) return "unknown";
      return check.allowedBrainMets.includes(sheet.brainMets.status) ? "met" : "not_met";
    case "creatinine_max":
      return compareNumber(sheet.organFunction.creatinineMgDl, check.numberValue, "<=");
    case "egfr_min":
      return compareNumber(sheet.organFunction.egfrMlMin, check.numberValue, ">=");
    case "anc_min":
      return compareNumber(sheet.organFunction.ancPerUl, check.numberValue, ">=");
    case "platelets_min":
      return compareNumber(sheet.organFunction.plateletsPerUl, check.numberValue, ">=");
    case "hemoglobin_min":
      return compareNumber(sheet.organFunction.hemoglobinGdl, check.numberValue, ">=");
    case "bilirubin_max":
      return compareNumber(sheet.organFunction.totalBilirubinMgDl, check.numberValue, "<=");
    case "ast_max":
      return compareNumber(sheet.organFunction.astUL, check.numberValue, "<=");
    case "alt_max":
      return compareNumber(sheet.organFunction.altUL, check.numberValue, "<=");
  }
}

function compareNumber(
  actual: number | null | undefined,
  expected: number | undefined,
  op: ">=" | "<=",
): Judgment {
  if (actual === null || actual === undefined || expected === undefined || Number.isNaN(actual)) {
    return "unknown";
  }
  if (op === ">=") return actual >= expected ? "met" : "not_met";
  return actual <= expected ? "met" : "not_met";
}

function matchPresence(actual: FactSheet["biomarkers"]["egfr"]["status"], expected?: FactSheet["biomarkers"]["egfr"]["status"]): Judgment {
  if (!expected || actual === "unknown") return "unknown";
  return actual === expected ? "met" : "not_met";
}

function matchVariant(status: FactSheet["biomarkers"]["egfr"]["status"], variant: string | null, expected?: string): Judgment {
  if (!expected) return "unknown";
  if (status === "unknown" && !variant) return "unknown";
  if (status === "absent") return "not_met";
  if (!variant) return "unknown";
  const a = normalize(variant);
  const b = normalize(expected);
  return a.includes(b) || b.includes(a) ? "met" : "not_met";
}

function matchTherapy(prior: string[], expected: string | undefined, required: boolean): Judgment {
  if (!expected) return "unknown";
  if (!prior.length) return "unknown";
  const needle = normalize(expected);
  const found = prior.some((p) => {
    const n = normalize(p);
    return n.includes(needle) || needle.includes(n);
  });
  if (required) return found ? "met" : "not_met";
  return found ? "not_met" : "met";
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
