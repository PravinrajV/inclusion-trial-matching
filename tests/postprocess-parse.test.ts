// @ts-nocheck — this file imports a .mjs helper used by the spike runner.
import { describe, expect, it } from "vitest";
import {
  postprocessParse,
  scoreItem,
  classifyMissSafety,
  brainAllowedEquivalent,
  normalizeEligibility,
} from "../scripts/lib/postprocess-parse.mjs";

describe("normalizeEligibility", () => {
  it("unescapes CT.gov markdown slashes", () => {
    expect(normalizeEligibility("Creatinine clearance \\> 60 mL/min")).toContain("clearance > 60");
  });
});

describe("renal egfr_min from OR-compound creatinine/clearance", () => {
  it("extracts 60 mL/min from a creatinine-or-clearance rule with an AST qualifier", () => {
    const text =
      "Creatinine within normal institutional limits OR Creatinine clearance > 60 mL/min/1.73 m2 for subjects with above normal AST and ALT with alkaline phosphatase within < 1.5 times upper limit of normal.";
    const out = postprocessParse({ typedChecks: [], fuzzyCriteria: [] }, text, "NCT00000001");
    const hit = out.typedChecks.find((t) => t.kind === "egfr_min" && t.numberValue === 60);
    expect(hit).toBeTruthy();
    expect(hit.polarity).toBe("inclusion");
    expect(hit.exceptions).toBeTruthy();
  });

  it("extracts 40 mL/min from serum creatinine or creatinine clearance within normal limits or > 40", () => {
    const text = "Serum creatinine or creatinine clearance Within normal limits or > 40 mL/min; Total serum bilirubin < 1.5 × ULN";
    const out = postprocessParse({ typedChecks: [], fuzzyCriteria: [] }, text, "NCT00000002");
    expect(out.typedChecks.some((t) => t.kind === "egfr_min" && t.numberValue === 40)).toBe(true);
  });

  it("does not treat an EGFR gene mention as kidney egfr_min", () => {
    const text = "Patients must have a documented EGFR exon 19 deletion. Creatinine =< 1.5 x ULN.";
    const out = postprocessParse({ typedChecks: [], fuzzyCriteria: [] }, text, "NCT00000003");
    expect(out.typedChecks.filter((t) => t.kind === "egfr_min")).toHaveLength(0);
  });
});

describe("example-variant lists", () => {
  it("promotes an e.g. variant list to egfr_variant_in, including exon 19 deletion", () => {
    const text =
      "Patient must have somatic activating sensitizing mutation in EGFR (e.g. but not limited to Exon 19 deletion, L858R, E709X, G719X, exon 19 insertions, L861Q, S768I). Patients with non-sensitizing mutations in EGFR (EGFR exon 20 insertions) are not eligible.";
    const out = postprocessParse(
      {
        typedChecks: [
          {
            id: "status",
            kind: "egfr_status",
            polarity: "inclusion",
            sourceText: "Patient must have somatic activating sensitizing mutation in EGFR (e.g. but not limited to Exon 19 deletion, L858R, E709X, G719X, exon 19 insertions, L861Q, S768I).",
            presence: "present",
          },
        ],
        fuzzyCriteria: [],
      },
      text,
      "NCT00000004",
    );
    const variant = out.typedChecks.find((t) => t.kind === "egfr_variant_in" && t.polarity === "inclusion");
    expect(variant).toBeTruthy();
    expect(String(variant.stringValue).toLowerCase()).toContain("exon 19 deletion");
  });
});

describe("exception-laden prior therapy and lines", () => {
  it("emits prior_lines_max 0 for no prior systemic treatment for metastatic disease", () => {
    const text = "Patient must not have had any prior systemic treatment for metastatic disease.";
    const out = postprocessParse({ typedChecks: [], fuzzyCriteria: [] }, text, "NCT00000005");
    const hit = out.typedChecks.find((t) => t.kind === "prior_lines_max");
    expect(hit?.numberValue).toBe(0);
    expect(hit?.exceptions).toBeTruthy();
  });

  it("emits prior_lines_min 1 plus an exception note", () => {
    const text =
      "To be eligible for screening at progression, patients must have received at least one line of systemic therapy for any stage of disease (Stages I-IV) and must have progressed during or following their most recent line of therapy.";
    const out = postprocessParse({ typedChecks: [], fuzzyCriteria: [] }, text, "NCT00000006");
    expect(out.typedChecks.some((t) => t.kind === "prior_lines_min" && t.numberValue === 1)).toBe(true);
  });

  it("splits an EGFR TKI exclusion with an osimertinib start-window into typed checks plus exceptions", () => {
    const text =
      "NOTE: Prior treatment with an EGFR TKI is not allowed, however if a candidate for this study has already started osimertinib within 21 days prior to randomization, the exact osimertinib start date is known, and the patient had the required study baseline imaging completed prior to the osimertinib start date, the patient will be eligible.";
    const out = postprocessParse({ typedChecks: [], fuzzyCriteria: [] }, text, "NCT00000007");
    const osi = out.typedChecks.find((t) => t.kind === "prior_therapy_excluded" && /osimertinib/i.test(t.stringValue || ""));
    expect(osi).toBeTruthy();
    expect(osi.exceptions.toLowerCase()).toMatch(/however/);
  });

  it("emits EGFR and ALK exclusions with the unless clause on exceptions", () => {
    const text =
      "Patients with known EGFR sensitizing mutations, EGFR T790M mutation, ALK gene fusion, ROS 1 gene rearrangement, or BRAF V600E mutation are not eligible unless they have progressed following all standard of care targeted therapy.";
    const out = postprocessParse({ typedChecks: [], fuzzyCriteria: [] }, text, "NCT00000008");
    expect(out.typedChecks.some((t) => t.kind === "egfr_status" && t.polarity === "exclusion" && t.presence === "present")).toBe(true);
    expect(out.typedChecks.some((t) => t.kind === "alk_status" && t.polarity === "exclusion" && t.presence === "present")).toBe(true);
    expect(out.typedChecks.find((t) => t.kind === "egfr_status").exceptions.toLowerCase()).toMatch(/unless/);
  });
});

describe("brain mets polarity", () => {
  it("canonicalizes must-not-have-untreated to inclusion with none and treated_stable", () => {
    const text = "Participants must not have untreated central nervous system (CNS) metastases.";
    const out = postprocessParse(
      {
        typedChecks: [
          {
            id: "brain",
            kind: "brain_mets",
            polarity: "exclusion",
            sourceText: text,
            allowedBrainMets: ["untreated"],
          },
        ],
        fuzzyCriteria: [],
      },
      text,
      "NCT00000009",
    );
    const brain = out.typedChecks.find((t) => t.kind === "brain_mets" && t.polarity === "inclusion");
    expect(brain?.allowedBrainMets).toEqual(["none", "treated_stable"]);
  });

  it("keeps known-active CNS wording as exclusion with untreated", () => {
    const text = "Has known active central nervous system (CNS) metastases and/or carcinomatous meningitis.";
    const out = postprocessParse(
      {
        typedChecks: [
          {
            id: "brain",
            kind: "brain_mets",
            polarity: "exclusion",
            sourceText: text,
            allowedBrainMets: ["untreated"],
          },
        ],
        fuzzyCriteria: [],
      },
      text,
      "NCT00000010",
    );
    const brain = out.typedChecks.find((t) => t.kind === "brain_mets");
    expect(brain?.polarity).toBe("exclusion");
    expect(brain?.allowedBrainMets).toEqual(["untreated"]);
  });

  it("flips the unsafe invert of exclusion plus allowed statuses", () => {
    const out = postprocessParse(
      {
        typedChecks: [
          {
            id: "brain",
            kind: "brain_mets",
            polarity: "exclusion",
            sourceText: "Other CNS wording",
            allowedBrainMets: ["none", "treated_stable"],
          },
        ],
        fuzzyCriteria: [],
      },
      "Other CNS wording",
      "NCT00000011",
    );
    const brain = out.typedChecks.find((t) => t.kind === "brain_mets");
    expect(brain?.polarity).toBe("inclusion");
    expect(brain?.allowedBrainMets).toEqual(["none", "treated_stable"]);
  });

  it("treats inclusion-allowed and exclusion-complement as judgment equivalent", () => {
    expect(
      brainAllowedEquivalent(
        { polarity: "inclusion", allowedBrainMets: ["none", "treated_stable"] },
        { polarity: "exclusion", allowedBrainMets: ["untreated"] },
      ),
    ).toBe(true);
  });
});

describe("safe vs unsafe miss classification", () => {
  it("marks a leftover fuzzy item as a safe miss when omitted from typedChecks", () => {
    const gold = {
      kind: "egfr_min",
      polarity: "inclusion",
      numberValue: 60,
      sourceText: "Creatinine clearance > 60 mL/min",
    };
    const parsed = {
      typedChecks: [],
      fuzzyCriteria: [{ id: "f", polarity: "inclusion", sourceText: "Creatinine clearance > 60 mL/min", reasonFuzzy: "compound" }],
    };
    expect(scoreItem(gold, parsed).verdict).toBe("miss");
    expect(classifyMissSafety(gold, parsed).safety).toBe("safe");
  });

  it("marks a looser EGFR status check as unsafe when the gold item is a variant list", () => {
    const gold = {
      kind: "egfr_variant_in",
      polarity: "inclusion",
      stringValue: "exon 19 deletion",
      sourceText: "sensitizing mutation in EGFR (e.g. but not limited to Exon 19 deletion, L858R).",
    };
    const parsed = {
      typedChecks: [
        {
          id: "s",
          kind: "egfr_status",
          polarity: "inclusion",
          sourceText: "sensitizing mutation in EGFR (e.g. but not limited to Exon 19 deletion, L858R).",
          presence: "present",
        },
      ],
      fuzzyCriteria: [],
    };
    expect(scoreItem(gold, parsed).verdict).toBe("miss");
    expect(classifyMissSafety(gold, parsed).safety).toBe("unsafe");
  });
});

describe("advanced stage expansion", () => {
  it("adds IIIC, IVA, and IVB when a IIIB plus stage IV unresectable list is missing them", () => {
    const text = "Participants must have advanced disease - either stage IV disease, stage IIIB disease not amenable to definitive multi-modality therapy.";
    const out = postprocessParse(
      {
        typedChecks: [
          { id: "st", kind: "stage_in", polarity: "inclusion", sourceText: text, stages: ["IIIB", "IV", "IVA", "IVB"] },
        ],
        fuzzyCriteria: [],
      },
      text,
      "NCT00000012",
    );
    expect(out.typedChecks[0].stages).toEqual(["IIIB", "IIIC", "IV", "IVA", "IVB"]);
  });

  it("does not add IIIC to an early-stage through IIIB list that has no stage IV", () => {
    const text = "All subjects must have one of the following stages: Stage IA, IB, II, IIIA, IIIB.";
    const out = postprocessParse(
      {
        typedChecks: [
          { id: "st", kind: "stage_in", polarity: "inclusion", sourceText: text, stages: ["IA", "IB", "IIA", "IIB", "IIIA", "IIIB"] },
        ],
        fuzzyCriteria: [],
      },
      text,
      "NCT00000013",
    );
    expect(out.typedChecks[0].stages).toEqual(["IA", "IB", "IIA", "IIB", "IIIA", "IIIB"]);
  });
});
