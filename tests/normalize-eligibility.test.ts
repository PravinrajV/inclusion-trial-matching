// @ts-nocheck — imports the .mjs normalizer used by the cache path.
import { describe, expect, it } from "vitest";
import {
  extractTypedChecks,
  isVerbatimQuote,
  normalizeSpan,
  splitEligibilitySections,
} from "../scripts/lib/normalize-eligibility.mjs";
import { classifyMissSafety, scoreItem } from "../scripts/lib/postprocess-parse.mjs";

describe("section split and verbatim quotes", () => {
  const text = `Inclusion Criteria:\n\n* ECOG performance status of 0 or 1\n* Metastatic NSCLC\n\nExclusion Criteria:\n\n* Patients with EGFR mutations are excluded\n`;
  it("splits inclusion and exclusion sections", () => {
    const s = splitEligibilitySections(text);
    expect(s.hasSplit).toBe(true);
    expect(s.inclusion).toContain("ECOG");
    expect(s.exclusion).toContain("EGFR");
    expect(s.inclusion).not.toContain("Patients with EGFR mutations are excluded");
  });

  it("requires a verbatim quote and demotes a quote from the wrong section", () => {
    expect(isVerbatimQuote("ECOG performance status of 0 or 1", text)).toBe(true);
    const wrong = normalizeSpan("Patients with EGFR mutations are excluded", "inclusion", text);
    expect(wrong.typedChecks).toHaveLength(0);
    const right = normalizeSpan("Patients with EGFR mutations are excluded", "exclusion", text);
    expect(right.typedChecks.some((c) => c.kind === "egfr_status" && c.polarity === "exclusion" && c.presence === "present")).toBe(true);
  });
});

describe("six-type rules", () => {
  it("reads ECOG 0 or 1 even when the full group name and (PS) appear", () => {
    const text = `Inclusion Criteria:\nHas an Eastern Cooperative Oncology Group (ECOG) Performance Status (PS) of 0 or 1.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const hit = out.typedChecks.find((c) => c.kind === "ecog_max");
    expect(hit?.numberValue).toBe(1);
    expect(hit?.polarity).toBe("inclusion");
    expect(isVerbatimQuote(hit.evidence_quote, text)).toBe(true);
  });

  it("reads Stage III B/C or IV as IIIB, IIIC, IV, IVA, IVB", () => {
    const text = `Inclusion Criteria:\nStage III B/C or IV NSCLC (based on AJCC Edition 8) not amenable to curative treatment.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const hit = out.typedChecks.find((c) => c.kind === "stage_in");
    expect(hit?.stages).toEqual(["IIIB", "IIIC", "IV", "IVA", "IVB"]);
  });

  it("encodes 'Absence of EGFR mutations' in inclusion as inclusion + absent", () => {
    const text = `Inclusion Criteria:\nAbsence of sensitising EGFR mutations, and ALK and ROS1 rearrangements.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const egfr = out.typedChecks.find((c) => c.kind === "egfr_status");
    expect(egfr?.polarity).toBe("inclusion");
    expect(egfr?.presence).toBe("absent");
  });

  it("does not emit a single prior_lines_max when two conditional caps are in the same span", () => {
    const text = `Inclusion Criteria:\nNo more than 1 prior line is allowed if ICI and platinum-based chemotherapy were administered concurrently and no more than 2 prior lines are allowed for sequential administration.\n`;
    const out = extractTypedChecks(text, "NCT0");
    expect(out.typedChecks.filter((c) => c.kind.startsWith("prior_lines"))).toHaveLength(0);
  });

  it("encodes exclusion 'brain metastases unless stable' as exclusion + untreated, equivalent to inclusion + none/treated_stable", () => {
    const text = `Exclusion Criteria:\nBrain metastases unless asymptomatic, stable, and not requiring steroids.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const hit = out.typedChecks.find((c) => c.kind === "brain_mets");
    expect(hit?.polarity).toBe("exclusion");
    expect(hit?.allowedBrainMets).toEqual(["untreated"]);
    const gold = { kind: "brain_mets", polarity: "inclusion", allowedBrainMets: ["none", "treated_stable"] };
    expect(scoreItem(gold, out).verdict).toBe("hit");
    expect(classifyMissSafety(gold, out).safety).toBe("not_a_miss");
  });
});

describe("fail-closed guards", () => {
  it("parses 'negative for EGFR' as absent, never present", () => {
    const text = `Inclusion Criteria:\nPatient must have a tumor that is negative for EGFR mutation/ALK translocations.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const egfr = out.typedChecks.find((c) => c.kind === "egfr_status");
    const alk = out.typedChecks.find((c) => c.kind === "alk_status");
    expect(egfr?.presence).toBe("absent");
    expect(alk?.presence).toBe("absent");
    expect(out.typedChecks.some((c) => c.kind.endsWith("_status") && c.presence === "present")).toBe(false);
  });

  it("does not type a specific required drug from an i.e. example list", () => {
    const text = `Inclusion Criteria:\nPatients with known actionable mutations with FDA-approved treatment options must have received all approved and standard of care treatment options (ie osimertinib for EGFR, alectinib for ALK, etc).\nPrior PD-1 and/or PD-L1 directed therapies are required.\n`;
    const out = extractTypedChecks(text, "NCT0");
    expect(out.typedChecks.some((c) => c.kind === "prior_therapy_required" && /osimertinib/i.test(c.stringValue || ""))).toBe(false);
  });

  it("does not type a mutation as required from a 'confirm EGFR/ALK status' biopsy sentence", () => {
    const text = `Inclusion Criteria:\nParticipants must have a tumor tissue sample available for biomarker testing, including PD-L1 IHC testing and sequencing to confirm EGFR/ALK status.\n`;
    const out = extractTypedChecks(text, "NCT0");
    expect(out.typedChecks.filter((c) => c.kind.endsWith("_status") || c.kind.endsWith("_variant_in"))).toHaveLength(0);
  });

  it("expands II-IIIB inclusively and does not drop IIIA", () => {
    const text = `Inclusion Criteria:\nParticipants with histologically confirmed stage II-IIIB(N2) NSCLC.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const hit = out.typedChecks.find((c) => c.kind === "stage_in");
    expect(hit?.stages).toEqual(["IIA", "IIB", "IIIA", "IIIB"]);
  });

  it("expands Stage III or IV to every III and IV token", () => {
    const text = `Inclusion Criteria:\nStage III or IV NSCLC that is not potentially curable by radiotherapy or surgery.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const hit = out.typedChecks.find((c) => c.kind === "stage_in");
    expect(hit?.stages).toEqual(["IIIA", "IIIB", "IIIC", "IV", "IVA", "IVB"]);
  });

  it("demotes a stage list when an unrepresentable token such as IIID remains", () => {
    const text = `Inclusion Criteria:\nStage IIIC, IIID, or IV unresectable or metastatic melanoma or Stage III or IV NSCLC.\n`;
    const out = extractTypedChecks(text, "NCT0");
    expect(out.typedChecks.filter((c) => c.kind === "stage_in")).toHaveLength(0);
  });

  it("accounts for locally advanced or metastatic by expanding both phrases", () => {
    const text = `Inclusion Criteria:\nLocally advanced or metastatic NSCLC that is not amenable to curative therapy.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const hit = out.typedChecks.find((c) => c.kind === "stage_in");
    expect(hit?.stages).toEqual(["IIIA", "IIIB", "IIIC", "IV", "IVA", "IVB"]);
  });

  it("does not treat a prior-line counting sentence about Stage I-III history as the required stage list", () => {
    const text = `Inclusion Criteria:\nConfirmation of stage IV non-small cell lung cancer (NSCLC) per AJCC, 8th edition.\nTreatment with systemic therapy for Stage I-III disease > 12 months prior to development of metastases do not count as a line of therapy.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const hit = out.typedChecks.find((c) => c.kind === "stage_in");
    expect(hit?.stages).toEqual(["IV", "IVA", "IVB"]);
    expect(hit?.stages).not.toContain("IA");
  });

  it("types Stage III or IV or recurrent without widening past the explicit III/IV list", () => {
    const text = `Inclusion Criteria:\nStage III or IV NSCLC or recurrent NSCLC that is not potentially curable by radiotherapy or surgery.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const hit = out.typedChecks.find((c) => c.kind === "stage_in");
    expect(hit?.stages).toEqual(["IIIA", "IIIB", "IIIC", "IV", "IVA", "IVB"]);
  });

  it("still demotes recurrent NSCLC when no explicit or metastatic stage language is present", () => {
    const text = `Inclusion Criteria:\nRecurrent NSCLC that is not potentially curable by radiotherapy or surgery.\n`;
    const out = extractTypedChecks(text, "NCT0");
    expect(out.typedChecks.filter((c) => c.kind === "stage_in")).toHaveLength(0);
  });

  it("types ECOG performance status written as 'score from 0 to 1'", () => {
    const text = `Inclusion Criteria:\nEastern Cooperative Oncology Group performance status (ECOG PS) score from 0 to 1.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const hit = out.typedChecks.find((c) => c.kind === "ecog_max");
    expect(hit?.numberValue).toBe(1);
  });
  it("types a comma list 'ECOG score of 0, 1, or 2' as ecog_max 2", () => {
    const text = `Inclusion Criteria:\nECOG score of 0, 1, or 2.\n`;
    const out = extractTypedChecks(text, "NCT0");
    const hit = out.typedChecks.find((c) => c.kind === "ecog_max");
    expect(hit?.numberValue).toBe(2);
  });


  it("does not type an exception-population lab cap such as Gilbert's 5 x ULN as the general bilirubin max", () => {
    const text = `Inclusion Criteria:\nTotal bilirubin <= 1.5 x institutional upper limit of normal (ULN) unless history of Gilbert's disease. Participants with history of Gilbert's disease must have total bilirubin <= 5 x institutional ULN.\n`;
    const out = extractTypedChecks(text, "NCT0");
    expect(out.typedChecks.filter((c) => c.kind === "bilirubin_max")).toHaveLength(0);
  });
});

describe("matcher-equivalent status scoring", () => {
  it("does not count inclusion+absent vs exclusion+present as unsafe or a miss", () => {
    const gold = { kind: "egfr_status", polarity: "exclusion", presence: "present", sourceText: "EGFR mutations are excluded" };
    const parsed = { typedChecks: [{ kind: "egfr_status", polarity: "inclusion", presence: "absent", sourceText: "Absence of EGFR mutations" }], fuzzyCriteria: [] };
    const scored = scoreItem(gold, parsed);
    const safety = classifyMissSafety(gold, parsed);
    expect(scored.verdict).toBe("hit");
    expect(safety.safety).toBe("not_a_miss");
  });
});
