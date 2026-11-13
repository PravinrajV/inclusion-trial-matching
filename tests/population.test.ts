import { describe, expect, it } from "vitest";
import { emptyFactSheet } from "../src/schema/fact-sheet";
import type { TrialMeta } from "../src/cache/trial-meta";
import { classifyTrial, structuredResults } from "../src/match/population";
import { evaluateTrial, rankTrials, visibleShortlist } from "../src/match/evaluate";
import type { ParsedTrial } from "../src/schema/criterion";
import { POSSIBLE_MATCH_LABEL, STRONG_MATCH_LABEL, UNLIKELY_LABEL } from "../src/ui/copy";

function meta(over: Partial<TrialMeta> & { nctId: string }): TrialMeta {
  return { phases: [], sites: [], ...over };
}

function sheetAlex() {
  const sheet = emptyFactSheet("self_entry");
  sheet.stage = "IV";
  sheet.histology = "adenocarcinoma";
  sheet.ecog = 1;
  sheet.ageYears = 62;
  sheet.biomarkers.egfr = { status: "present", variant: "exon 19 deletion" };
  sheet.biomarkers.alk = { status: "absent", variant: null };
  sheet.biomarkers.kras = { status: "absent", variant: null };
  sheet.priorSystemicLines = 1;
  sheet.priorTherapies = ["osimertinib"];
  sheet.brainMets.status = "none";
  return sheet;
}

function sheetSam() {
  const sheet = emptyFactSheet("self_entry");
  sheet.stage = "IV";
  sheet.histology = "adenocarcinoma";
  sheet.ecog = 0;
  sheet.ageYears = 54;
  sheet.biomarkers.egfr = { status: "absent", variant: null };
  sheet.biomarkers.alk = { status: "present", variant: "rearrangement" };
  sheet.biomarkers.kras = { status: "absent", variant: null };
  sheet.priorSystemicLines = 1;
  sheet.priorTherapies = ["alectinib"];
  sheet.brainMets.status = "treated_stable";
  return sheet;
}

function trial(nctId: string, checks: ParsedTrial["typedChecks"] = []): ParsedTrial {
  return {
    schemaVersion: "1",
    nctId,
    parsedAt: "",
    parserModel: "test",
    promptVersion: "test",
    typedChecks: checks,
    fuzzyCriteria: [],
  };
}

describe("classifyTrial", () => {
  it("requires KRAS G12C from a title and quotes that title", () => {
    const pop = classifyTrial(
      meta({
        nctId: "NCT06343402",
        briefTitle: "Open-label Study of BBO-8520 in Adult Subjects With KRASG12C Non-small Cell Lung Cancer",
        conditions: ["Non-small Cell Lung Cancer"],
        overallStatus: "RECRUITING",
      }),
    );
    expect(pop.population).toBe("nsclc");
    expect(pop.nsclcSpecific).toBe(true);
    expect(pop.driverGroups[0]?.drivers.map((d) => d.label)).toEqual(["KRAS G12C"]);
    expect(pop.driverGroups[0]?.drivers[0]?.quote).toMatch(/KRASG12C/i);
    expect(pop.driverGroups[0]?.drivers[0]?.source).toBe("title");
  });

  it("requires EGFR from an EGFR-mutant title, not from testing keywords", () => {
    const pop = classifyTrial(
      meta({
        nctId: "NCT04181060",
        briefTitle: "Osimertinib With or Without Bevacizumab as Initial Treatment for Patients With EGFR-Mutant Lung Cancer",
        officialTitle: "First-Line Treatment for Patients With Metastatic EGFR-Mutant Non-Small Cell Lung Cancer",
        conditions: ["Stage IV Lung Cancer AJCC v8"],
        keywords: ["EGFR, ALK and ROS1 testing"],
        overallStatus: "RECRUITING",
      }),
    );
    const labels = pop.driverGroups.flatMap((g) => g.drivers.map((d) => `${d.gene}:${d.presence}`));
    expect(labels).toContain("EGFR:present");
    expect(labels).not.toContain("ALK:present");
    expect(pop.priorLineHint).toBe("first_line");
  });

  it("does not treat a generic solid-tumor or multi-cohort keyword list as a required driver", () => {
    const pop = classifyTrial(
      meta({
        nctId: "NCT04198766",
        briefTitle: "Study of INBRX-106 in Subjects With Locally Advanced or Metastatic Solid Tumors",
        conditions: ["Solid Tumor", "Non-Small Cell Lung Cancer", "Melanoma"],
        keywords: [
          "Anaplastic lymphoma kinase (ALK) rearranged Non-Small Cell Lung Cancer",
          "Epidermal growth factor receptor (EGFR)-mutant Non-Small Cell Lung Cancer",
        ],
      }),
    );
    expect(pop.population).toBe("mixed");
    expect(pop.driverGroups).toHaveLength(0);
  });

  it("treats EGFR wild-type language as a required absence, not an EGFR-positive trial", () => {
    const pop = classifyTrial(
      meta({
        nctId: "NCT04928846",
        officialTitle: "Telisotuzumab Vedotin Versus Docetaxel in EGFR Wildtype, Locally Advanced/Metastatic Non-Squamous Non-Small Cell Lung Cancer",
        briefTitle: "Previously Treated Non-Squamous NSCLC",
        conditions: ["Non Small Cell Lung Cancer"],
      }),
    );
    const drivers = pop.driverGroups.flatMap((g) => g.drivers);
    expect(drivers.some((d) => d.gene === "EGFR" && d.presence === "absent")).toBe(true);
    expect(drivers.some((d) => d.gene === "EGFR" && d.presence === "present")).toBe(false);
  });

  it("does not require EGFR from an including-EGFR solid-tumor title", () => {
    const pop = classifyTrial(
      meta({
        nctId: "NCT05498428",
        briefTitle: "Amivantamab in Participants With Advanced or Metastatic Solid Tumors Including Epidermal Growth Factor Receptor (EGFR)-Mutated Non-Small Cell Lung Cancer",
        officialTitle: "Amivantamab in Patients With Advanced or Metastatic Solid Tumors Including EGFR-mutated Non-Small Cell Lung Cancer",
        conditions: ["Carcinoma, Non-small-Cell Lung"],
      }),
    );
    expect(pop.driverGroups).toHaveLength(0);
  });
});

describe("structured driver judgments", () => {
  it("marks a KRAS G12C title as not met when the chart shows KRAS is absent", () => {
    const pop = classifyTrial(
      meta({
        nctId: "NCT06343402",
        briefTitle: "BBO-8520 in Adult Subjects With KRASG12C Non-small Cell Lung Cancer",
        conditions: ["NSCLC"],
      }),
    );
    const { driverMatch, results } = structuredResults(sheetAlex(), pop);
    expect(driverMatch).toBe("conflict");
    expect(results.some((r) => r.judgment === "not_met" && /KRAS G12C/i.test(r.headline))).toBe(true);
    expect(results[0]?.quoteLabel).toBe("Trial's own words");
  });

  it("confirms an EGFR-mutant title for a chart with EGFR exon 19 deletion", () => {
    const pop = classifyTrial(
      meta({
        nctId: "NCT04486833",
        briefTitle: "Reqorsa and Osimertinib in Patients With Advanced Lung Cancer Who Progressed on Osimertinib",
        officialTitle: "Patients With Advanced, Metastatic EGFR-Mutant, Metastatic Non-Small Cell Lung Cancer",
        conditions: ["Carcinoma, Non-Small Cell Lung"],
      }),
    );
    const { driverMatch } = structuredResults(sheetAlex(), pop);
    expect(driverMatch).toBe("confirmed");
  });

  it("does not not-met an EGFR-and-MET title when MET is not on the fact sheet", () => {
    const pop = classifyTrial(
      meta({
        nctId: "NCT05642572",
        briefTitle: "Targeted Drugs for Advanced Non-Small Cell Lung Cancer That Has EGFR and MET Gene Changes",
        officialTitle: "Capmatinib Plus Osimertinib in Participants With EGFR-Mutant, MET-Amplified Stage IV NSCLC",
        conditions: ["Stage IV Lung Cancer AJCC v8"],
      }),
    );
    const { driverMatch, results } = structuredResults(sheetAlex(), pop);
    expect(results.some((r) => r.judgment === "not_met")).toBe(false);
    expect(driverMatch).toBe("unknown");
  });

  it("treats ALK, ROS1, or NTRK as an OR group: ALK-positive is enough", () => {
    const pop = classifyTrial(
      meta({
        nctId: "NCT03093116",
        briefTitle: "Repotrectinib in Patients With Advanced Solid Tumors Harboring ALK, ROS1, or NTRK1-3 Rearrangements",
        conditions: ["Solid Tumor"],
      }),
    );
    expect(pop.driverGroups[0]?.op).toBe("any");
    expect(structuredResults(sheetSam(), pop).driverMatch).toBe("confirmed");
    const alex = structuredResults(sheetAlex(), pop);
    expect(alex.driverMatch).not.toBe("conflict");
    expect(alex.driverMatch).toBe("unknown");
  });
});

describe("ranking and tiers", () => {
  it("never ranks a conflicting driver trial above a confirmed driver match", () => {
    const alex = sheetAlex();
    const ranked = rankTrials(alex, [
      {
        trial: trial("NCT06343402"),
        briefTitle: "BBO-8520 in Adult Subjects With KRASG12C Non-small Cell Lung Cancer",
        meta: meta({
          nctId: "NCT06343402",
          briefTitle: "BBO-8520 in Adult Subjects With KRASG12C Non-small Cell Lung Cancer",
          conditions: ["NSCLC"],
          overallStatus: "RECRUITING",
        }),
      },
      {
        trial: trial("NCT04486833"),
        briefTitle: "Reqorsa and Osimertinib in Patients Who Progressed on Osimertinib",
        meta: meta({
          nctId: "NCT04486833",
          briefTitle: "Reqorsa and Osimertinib in Patients Who Progressed on Osimertinib",
          officialTitle: "EGFR-Mutant Metastatic Non-Small Cell Lung Cancer",
          conditions: ["Carcinoma, Non-Small Cell Lung"],
          overallStatus: "RECRUITING",
        }),
      },
      {
        trial: trial("NCT99999999"),
        briefTitle: "A Microbiome Study in Advanced Solid Tumors",
        meta: meta({
          nctId: "NCT99999999",
          briefTitle: "A Microbiome Study in Advanced Solid Tumors",
          conditions: ["Solid Tumor"],
          overallStatus: "RECRUITING",
        }),
      },
    ]);
    expect(ranked[0]?.nctId).toBe("NCT04486833");
    expect(ranked[0]?.tier).toBe("strong");
    expect(ranked[0]?.label).toBe(STRONG_MATCH_LABEL);
    expect(ranked.find((m) => m.nctId === "NCT06343402")?.tier).toBe("unlikely");
    expect(ranked.find((m) => m.nctId === "NCT06343402")?.label).toBe(UNLIKELY_LABEL);
    expect(ranked.find((m) => m.nctId === "NCT99999999")?.tier).toBe("possible");
    const visible = visibleShortlist(ranked, 8);
    expect(visible.shown.map((m) => m.nctId)).toEqual(["NCT04486833", "NCT99999999"]);
    expect(visible.strong).toBe(1);
    expect(visible.possible).toBe(1);
    expect(visible.unlikely).toBe(1);
    expect(visible.shown.every((m) => m.label !== UNLIKELY_LABEL)).toBe(true);
    expect([STRONG_MATCH_LABEL, POSSIBLE_MATCH_LABEL, UNLIKELY_LABEL].join(" ").toLowerCase()).not.toMatch(/eligible|you qualify/);
  });

  it("demotes a first-line EGFR title when the chart already has a prior line", () => {
    const match = evaluateTrial(
      sheetAlex(),
      trial("NCT04181060"),
      "Initial Treatment for Patients With EGFR-Mutant Lung Cancer",
      meta({
        nctId: "NCT04181060",
        briefTitle: "Initial Treatment for Patients With EGFR-Mutant Lung Cancer",
        officialTitle: "First-Line Treatment for Patients With Metastatic EGFR-Mutant Non-Small Cell Lung Cancer",
        conditions: ["Stage IV Lung Cancer"],
        overallStatus: "RECRUITING",
      }),
    );
    expect(match.driverMatch).toBe("confirmed");
    expect(match.firstLineDemoted).toBe(true);
    expect(match.tier).toBe("possible");
  });

  it("does not call an EGFR wild-type title Strong just because the chart is EGFR-negative", () => {
    const match = evaluateTrial(
      sheetSam(),
      trial("NCT06568939"),
      "Previously Treated Non-Squamous NSCLC",
      meta({
        nctId: "NCT06568939",
        briefTitle: "Previously Treated Non-Squamous NSCLC",
        officialTitle: "Telisotuzumab Vedotin in c-Met Overexpressing, EGFR Wildtype, Non-Squamous Non-Small Cell Lung Cancer",
        conditions: ["Non-Small Cell Lung Cancer"],
        overallStatus: "RECRUITING",
      }),
    );
    expect(match.driverMatch).toBe("confirmed");
    expect(match.tier).toBe("possible");
  });

  it("does not let a cached ALK-absent check hide an ALK-positive title requirement", () => {
    const match = evaluateTrial(
      sheetSam(),
      trial("NCT07491497", [
        { id: "alk", kind: "alk_status", polarity: "inclusion", sourceText: "No ALK", evidence_quote: "No ALK", presence: "absent" },
      ]),
      "A Phase 1/2 Study of TRI-611 in ALK-Positive NSCLC",
      meta({
        nctId: "NCT07491497",
        briefTitle: "A Phase 1/2 Study of TRI-611 in ALK-Positive NSCLC",
        officialTitle: "TRI-611 in Participants With Advanced ALK-Positive NSCLC",
        conditions: ["ALK-positive NSCLC"],
        overallStatus: "RECRUITING",
      }),
    );
    expect(match.results.some((r) => r.judgment === "met" && /Requires an ALK/i.test(r.headline))).toBe(true);
    expect(match.tier).toBe("strong");
  });

  it("assigns Strong for Sam on an ALK-positive NSCLC title", () => {
    const match = evaluateTrial(
      sheetSam(),
      trial("NCT07140016"),
      "Gilteritinib in Adults With Advanced ALK-positive Non-small Cell Lung Cancer",
      meta({
        nctId: "NCT07140016",
        briefTitle: "Gilteritinib in Adults With Advanced ALK-positive Non-small Cell Lung Cancer",
        conditions: ["Non-small Cell Lung Cancer"],
        overallStatus: "RECRUITING",
      }),
    );
    expect(match.driverMatch).toBe("confirmed");
    expect(match.tier).toBe("strong");
  });
});

describe("eligibility driver quotes", () => {
  it("prefers an inclusion-criterion sentence over the official title and names the chart variant", () => {
    const trial: ParsedTrial = {
      schemaVersion: "1",
      nctId: "NCT04486833",
      parsedAt: "",
      parserModel: "test",
      promptVersion: "test",
      typedChecks: [],
      fuzzyCriteria: [
        {
          id: "fuzzy-egfr",
          sourceText: "The NSCLC must be epidermal growth factor receptor (EGFR) mutation positive.",
          reasonFuzzy: "Could not be turned into a typed check with a verbatim, section-matched quote. Discuss with your care team.",
          polarity: "inclusion",
        },
      ],
    };
    const match = evaluateTrial(
      sheetAlex(),
      trial,
      "Reqorsa and Osimertinib in Patients With Advanced Lung Cancer Who Progressed on Osimertinib",
      meta({
        nctId: "NCT04486833",
        briefTitle: "Reqorsa and Osimertinib in Patients With Advanced Lung Cancer Who Progressed on Osimertinib",
        officialTitle: "Patients With Advanced, Metastatic EGFR-Mutant, Metastatic Non-Small Cell Lung Cancer",
        conditions: ["Carcinoma, Non-Small Cell Lung"],
      }),
    );
    const driver = match.results.find((r) => /EGFR/i.test(r.headline));
    expect(driver?.quote).toMatch(/epidermal growth factor receptor \(EGFR\) mutation positive/i);
    expect(driver?.quote).not.toMatch(/EGFR-Mutant, Metastatic/i);
    expect(driver?.headline).toMatch(/chart: EGFR exon 19 deletion/i);
    expect(driver?.quoteLabel).toBe("Trial's own words");
  });
});
