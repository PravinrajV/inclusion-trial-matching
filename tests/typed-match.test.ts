import { describe, expect, it } from "vitest";
import { judgeTypedCheck } from "../src/match/typed";
import { emptyFactSheet } from "../src/schema/fact-sheet";
import type { TypedCheck } from "../src/schema/criterion";

function sheet() {
  const s = emptyFactSheet("self_entry");
  s.ageYears = 62;
  s.stage = "IV";
  s.histology = "adenocarcinoma";
  s.ecog = 1;
  s.biomarkers.egfr = { status: "present", variant: "exon 19 deletion" };
  s.biomarkers.alk = { status: "absent", variant: null };
  s.biomarkers.kras = { status: "absent", variant: null };
  s.biomarkers.pdL1TpsPercent = 30;
  s.priorSystemicLines = 1;
  s.priorTherapies = ["osimertinib"];
  s.brainMets = { status: "none", detail: null };
  s.organFunction.creatinineMgDl = 0.9;
  s.organFunction.egfrMlMin = 85;
  return s;
}

describe("typed matcher", () => {
  it("matches age, ECOG, stage and histology", () => {
    const s = sheet();
    expect(judgeTypedCheck(s, { id: "1", kind: "age_min", polarity: "inclusion", sourceText: ">=18", numberValue: 18 })).toBe("met");
    expect(judgeTypedCheck(s, { id: "2", kind: "ecog_max", polarity: "inclusion", sourceText: "ECOG 0-1", numberValue: 1 })).toBe("met");
    expect(judgeTypedCheck(s, { id: "3", kind: "ecog_max", polarity: "inclusion", sourceText: "ECOG 0", numberValue: 0 })).toBe("not_met");
    expect(
      judgeTypedCheck(s, {
        id: "4",
        kind: "stage_in",
        polarity: "inclusion",
        sourceText: "stage IV",
        stages: ["IV", "IVA", "IVB"],
      }),
    ).toBe("met");
  });

  it("matches biomarker presence and variants", () => {
    const s = sheet();
    expect(judgeTypedCheck(s, { id: "5", kind: "egfr_status", polarity: "inclusion", sourceText: "EGFR+", presence: "present" })).toBe("met");
    expect(
      judgeTypedCheck(s, {
        id: "6",
        kind: "egfr_variant_in",
        polarity: "inclusion",
        sourceText: "exon 19 deletion",
        stringValue: "exon 19 deletion",
      }),
    ).toBe("met");
    expect(judgeTypedCheck(s, { id: "7", kind: "alk_status", polarity: "exclusion", sourceText: "no ALK", presence: "present" })).toBe("met");
  });

  it("returns unknown when a typed field is missing", () => {
    const s = sheet();
    s.organFunction.ancPerUl = null;
    const check: TypedCheck = { id: "8", kind: "anc_min", polarity: "inclusion", sourceText: "ANC >= 1500", numberValue: 1500 };
    expect(judgeTypedCheck(s, check)).toBe("unknown");
  });

  it("treats an excluded prior therapy as not met when the patient has taken it", () => {
    const s = sheet();
    expect(
      judgeTypedCheck(s, {
        id: "9",
        kind: "prior_therapy_excluded",
        polarity: "exclusion",
        sourceText: "no prior osimertinib",
        stringValue: "osimertinib",
      }),
    ).toBe("not_met");
  });
});
