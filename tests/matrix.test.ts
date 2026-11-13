import { describe, expect, it } from "vitest";
import type { DiscussItem, TrialMatch } from "../src/match/evaluate";
import type { CheckResult } from "../src/match/evaluate";
import type { TypedCheck } from "../src/schema/criterion";
import { GROUP_DISCUSS, GROUP_MET } from "../src/ui/copy";
import { findTrialSentence, keyCriteriaTally, pickMatrixItem, renderCriteriaMatrix } from "../src/ui/matrix";

function match(over: Partial<TrialMatch> = {}): TrialMatch {
  return {
    nctId: "NCT04486833",
    briefTitle: "Reqorsa and Osimertinib",
    results: [],
    discussItems: [],
    met: 0,
    notMet: 0,
    unknown: 0,
    discuss: 0,
    possibleMatch: true,
    label: "Possible match. Discuss with your care team.",
    tier: "possible",
    driverMatch: "none_required",
    population: "nsclc",
    nsclcSpecific: true,
    recruiting: true,
    firstLineDemoted: false,
    laterLineBonus: false,
    ...over,
  };
}

describe("criteria matrix empty rows", () => {
  it("uses a plain ask, never internal words, and quotes the trial sentence when one exists", () => {
    const items: DiscussItem[] = [
      {
        group: GROUP_DISCUSS,
        sourceText: "Stage III or IV NSCLC or recurrent NSCLC that is not potentially curable by radiotherapy or surgery.",
        polarity: "inclusion",
      },
      {
        group: GROUP_DISCUSS,
        sourceText: "Eastern Cooperative Oncology Group performance status (ECOG PS) score from 0 to 1.",
        polarity: "inclusion",
      },
    ];
    const html = renderCriteriaMatrix(match({ discussItems: items, discuss: items.length }));
    expect(html.toLowerCase()).not.toMatch(/typed|cache|schema/);
    expect(html).toContain("Not checked automatically. Ask: does my stage fit this trial?");
    expect(html).toContain("Stage III or IV NSCLC");
    expect(html).toContain("Trial's own words");
    expect(html).toContain("ECOG PS");
    expect(findTrialSentence("ecog", items)?.sourceText).toMatch(/ECOG/);
  });

  it("omits a quote when the trial has no sentence for that row", () => {
    const html = renderCriteriaMatrix(match());
    expect(html).toContain("Not checked automatically. Ask: does my stage fit this trial?");
    expect(html).not.toContain("matrix-quote");
    expect(html.toLowerCase()).not.toMatch(/typed|cache|schema/);
  });
});

describe("keyCriteriaTally", () => {
  it("counts met key rows out of six", () => {
    const tally = keyCriteriaTally(match());
    expect(tally.total).toBe(6);
    expect(tally.met).toBe(0);
  });
});


const NCT03093116_QUOTE =
  "Histologically or cytologically confirmed diagnosis of locally advanced, or metastatic solid tumor (including primary CNS tumors) (Stage IV, American Joint Committee on Cancer v.7) that harbors an ALK, ROS1, NTRK1, NTRK2, or NTRK3 gene rearrangement by protocol specified tests.";

function driverResult(kind: TypedCheck["kind"], judgment: CheckResult["judgment"], quote: string): CheckResult {
  const check: TypedCheck = {
    id: `test-${kind}`,
    kind,
    polarity: "inclusion",
    sourceText: quote,
    evidence_quote: quote,
    presence: "present",
  };
  return {
    check,
    judgment,
    group: judgment === "met" ? GROUP_MET : GROUP_DISCUSS,
    quote,
    headline: kind,
    quoteLabel: "Trial's own words",
  };
}

describe("disjunctive driver row", () => {
  it("shows a met ALK check when NCT03093116 quotes ALK or ROS1 or NTRK and ROS1 is unknown", () => {
    const items = [
      driverResult("alk_status", "met", NCT03093116_QUOTE),
      driverResult("ros1_status", "unknown", NCT03093116_QUOTE),
    ];
    const picked = pickMatrixItem(items, "driver");
    expect(picked?.judgment).toBe("met");
    expect(picked?.check.kind).toBe("alk_status");
    const tally = keyCriteriaTally(
      match({
        nctId: "NCT03093116",
        results: items,
        met: 1,
        unknown: 1,
      }),
    );
    expect(tally.met).toBe(1);
  });

  it("keeps Discuss when the trial requires both drivers and one is unknown", () => {
    const quote = "Patients must have both an EGFR mutation and an ALK rearrangement.";
    const items = [
      driverResult("alk_status", "met", quote),
      driverResult("egfr_status", "unknown", quote),
    ];
    const picked = pickMatrixItem(items, "driver");
    expect(picked?.judgment).toBe("unknown");
  });

  it("does not change lab rows: an unknown lab still outranks a met lab", () => {
    const quote = "ANC >= 1500 and platelets >= 100000.";
    const items = [
      driverResult("anc_min", "met", quote),
      driverResult("platelets_min", "unknown", quote),
    ];
    const picked = pickMatrixItem(items, "labs");
    expect(picked?.judgment).toBe("unknown");
  });

  it("does not treat a not_met sibling as met, even in an OR list", () => {
    const items = [
      driverResult("alk_status", "met", NCT03093116_QUOTE),
      driverResult("ros1_status", "not_met", NCT03093116_QUOTE),
    ];
    const picked = pickMatrixItem(items, "driver");
    expect(picked?.judgment).toBe("not_met");
    expect(picked?.check.kind).toBe("ros1_status");
    const tally = keyCriteriaTally(
      match({
        nctId: "NCT03093116",
        results: items,
        met: 1,
        notMet: 1,
      }),
    );
    expect(tally.met).toBe(0);
  });

  it("puts egfr_min on the labs row, not the driver row", () => {
    const creat =
      "Serum creatinine or creatinine clearance Within normal limits or > 40 mL/min;";
    const driver = "The NSCLC must be EGFR mutation positive.";
    const items = [
      driverResult("egfr_min", "met", creat),
      driverResult("egfr_status", "unknown", driver),
    ];
    expect(pickMatrixItem(items.filter((i) => i.check.kind === "egfr_status"), "driver")?.judgment).toBe("unknown");
    const tally = keyCriteriaTally(
      match({
        results: items,
        met: 1,
        unknown: 1,
      }),
    );
    // labs met, driver unknown / empty of a met driver
    expect(tally.met).toBe(1);
    const html = renderCriteriaMatrix(match({ results: items, met: 1, unknown: 1 }));
    expect(html).toMatch(/matrix-row is-met" data-row="labs"/);
    expect(html).toMatch(/matrix-row is-unknown" data-row="driver"/);
    expect(html).not.toMatch(/matrix-row is-met" data-row="driver"/);
  });

  it("does not treat a bare or elsewhere in the sentence as a disjunctive driver list", () => {
    const quote =
      "Histologically or cytologically confirmed diagnosis of stage III or IV NSCLC that harbors an EGFR mutation. ALK rearrangement is documented separately.";
    const items = [
      driverResult("egfr_status", "met", quote),
      driverResult("alk_status", "unknown", quote),
    ];
    const picked = pickMatrixItem(items, "driver");
    expect(picked?.judgment).toBe("unknown");
    expect(picked?.check.kind).toBe("alk_status");
  });
});
