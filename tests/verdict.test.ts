import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import personasDoc from "../gold/personas.json";
import type { CachedTrial } from "../src/cache/load";
import { emptyFactSheet } from "../src/schema/fact-sheet";
import type { FactSheet } from "../src/schema/fact-sheet";
import { evaluateTrial } from "../src/match/evaluate";
import { describeVerdict, renderQuoteHtml, askYourOncologistItems } from "../src/ui/verdict";
import { formatPhase, nearestSite } from "../src/cache/trial-meta";
import { GROUP_MET } from "../src/ui/copy";
import type { ParsedTrial, TypedCheck } from "../src/schema/criterion";

function escape(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

describe("describeVerdict", () => {
  it("explains an exclusion that was avoided, instead of repeating the exclusion sentence as a Met fact", () => {
    const sheet = emptyFactSheet("self_entry");
    sheet.brainMets.status = "none";
    const check: TypedCheck = {
      id: "b",
      kind: "brain_mets",
      polarity: "exclusion",
      sourceText: "Patients with untreated or unstable brain metastases",
      evidence_quote: "untreated or unstable brain metastases",
      allowedBrainMets: ["untreated"],
      section: "exclusion",
    };
    const copy = describeVerdict(sheet, check, "met");
    expect(copy.headline.toLowerCase()).toContain("exclusion avoided");
    expect(copy.headline.toLowerCase()).toContain("untreated");
    expect(copy.headline.toLowerCase()).not.toMatch(/^patients with untreated/);
    expect(copy.quoteLabel).toBe("Trial's own words");
  });

  it("says the chart has the required KRAS variant", () => {
    const sheet = emptyFactSheet("self_entry");
    sheet.biomarkers.kras = { status: "present", variant: "G12C" };
    const check: TypedCheck = {
      id: "k",
      kind: "kras_variant_in",
      polarity: "inclusion",
      sourceText: "Must have disease with evidence of KRAS G12C mutation.",
      evidence_quote: "KRAS G12C",
      stringValue: "G12C",
      section: "inclusion",
    };
    const copy = describeVerdict(sheet, check, "met");
    expect(copy.headline).toMatch(/Requires KRAS G12C/i);
    expect(copy.headline).toMatch(/chart: KRAS G12C/i);
    expect(copy.quoteLabel).toBe("Trial's own words");
  });

  it("never uses qualify or eligible in the headline", () => {
    const sheet = emptyFactSheet("self_entry");
    sheet.ecog = 1;
    const check: TypedCheck = {
      id: "e",
      kind: "ecog_max",
      polarity: "inclusion",
      sourceText: "ECOG 0 or 1",
      numberValue: 1,
    };
    const copy = describeVerdict(sheet, check, "met");
    expect(copy.headline.toLowerCase()).not.toContain("qualify");
    expect(copy.headline.toLowerCase()).not.toContain("eligible");
  });

  it("wires the headline onto a Met exclusion result from evaluateTrial", () => {
    const sheet = emptyFactSheet("self_entry");
    sheet.brainMets.status = "none";
    const trial: ParsedTrial = {
      schemaVersion: "1",
      nctId: "NCT00000001",
      parsedAt: "",
      parserModel: "test",
      promptVersion: "test",
      typedChecks: [
        {
          id: "b",
          kind: "brain_mets",
          polarity: "exclusion",
          sourceText: "Patients with untreated or unstable brain metastases",
          allowedBrainMets: ["untreated"],
          section: "exclusion",
        },
      ],
      fuzzyCriteria: [],
    };
    const result = evaluateTrial(sheet, trial);
    expect(result.possibleMatch).toBe(true);
    expect(result.results[0]?.group).toBe(GROUP_MET);
    expect(result.results[0]?.headline.toLowerCase()).toContain("exclusion avoided");
  });
});

describe("renderQuoteHtml", () => {
  it("highlights only the evidence span, not the whole line", () => {
    const html = renderQuoteHtml(
      "Patients with untreated or unstable brain metastases are excluded.",
      "untreated or unstable brain metastases",
      escape,
    );
    expect(html).toContain("<mark>untreated or unstable brain metastases</mark>");
    expect(html.startsWith("<mark>")).toBe(false);
    expect(html).toContain("Patients with ");
    expect(html).toContain(" are excluded.");
  });

  it("does not wrap the whole line in a mark when the quote is the entire text", () => {
    const line = "Patients with untreated or unstable brain metastases";
    const html = renderQuoteHtml(line, line, escape);
    expect(html).toBe(line);
    expect(html).not.toContain("<mark>");
  });
});

describe("askYourOncologistItems", () => {
  it("names an unknown typed criterion and caps at two", () => {
    const asks = askYourOncologistItems(
      [
        { judgment: "met", headline: "Requires ECOG 0 or 1: chart shows ECOG 1." },
        { judgment: "unknown", headline: "EGFR status still needs a closer look with your care team.", check: { kind: "egfr_status", presence: "present" } },
        { judgment: "unknown", headline: "KRAS G12C still needs a closer look with your care team.", check: { kind: "kras_variant_in", stringValue: "G12C" } },
      ],
      [],
      2,
    );
    expect(asks).toHaveLength(2);
    expect(asks[0]).toContain("EGFR");
    expect(asks[1]).toMatch(/KRAS G12C/);
    expect(asks.join(" ").toLowerCase()).not.toContain("closer look");
  });

  it("omits generic age-field and boilerplate discuss items", () => {
    const asks = askYourOncologistItems([], [
      { sourceText: "minimumAge: 18 Years", reason: "Age came from the structured minimumAge field, not a verbatim eligibility sentence." },
      { sourceText: "Some leftover eligibility language", reason: "not in the six-type allowlist, held for discussion" },
    ], 2);
    expect(asks).toEqual([]);
  });

  it("names a prior-therapy exclusion from the trial text", () => {
    const asks = askYourOncologistItems([], [
      { sourceText: "Patients must not have received prior treatment with a KRAS G12C inhibitor.", reason: "prior therapy" },
    ], 2);
    expect(asks[0]).toMatch(/KRAS G12C/i);
    expect(asks[0]).toMatch(/excludes it|prior/i);
    expect(asks[0].toLowerCase()).not.toContain("some eligibility language");
  });

  it("does not ask Sam about ROS1 on NCT03093116 when ALK is met on the same OR list", () => {
    const root = resolve(__dirname, "..");
    const cache = JSON.parse(readFileSync(resolve(root, "public/criteria-cache.json"), "utf8")) as {
      trials: CachedTrial[];
    };
    const trial = cache.trials.find((row) => row.nctId === "NCT03093116");
    expect(trial).toBeTruthy();
    const persona = personasDoc.personas.find((row) => row.id === "sam-okonkwo");
    expect(persona).toBeTruthy();
    const match = evaluateTrial(persona!.factSheet as FactSheet, trial!, trial!.briefTitle);
    expect(match.results.some((r) => r.check.kind === "alk_status" && r.judgment === "met")).toBe(true);
    expect(match.results.some((r) => r.check.kind === "ros1_status" && r.judgment === "unknown")).toBe(true);
    const asks = askYourOncologistItems(match.results, match.discussItems, 3);
    expect(asks.join(" ")).not.toMatch(/ROS1/);
  });
});

describe("trial meta helpers", () => {
  it("formats phases and omits NA", () => {
    expect(formatPhase(["PHASE3"])).toBe("Phase 3");
    expect(formatPhase(["PHASE1", "PHASE2"])).toBe("Phase 1/2");
    expect(formatPhase(["NA"])).toBeNull();
    expect(formatPhase([])).toBeNull();
  });

  it("computes the nearest site from a home coordinate", () => {
    const near = nearestSite(
      { city: "Columbus", state: "OH", lat: 39.9612, lon: -82.9988 },
      [
        { city: "Louisville", state: "Kentucky", lat: 38.25424, lon: -85.75941 },
        { city: "Columbus", state: "OH", lat: 39.9612, lon: -82.9988 },
      ],
    );
    expect(near?.city).toBe("Columbus");
    expect(near?.miles).toBe(0);
    expect(near?.label).toContain("Columbus, OH");
  });
});

describe("lab headlines", () => {
  it("names the lab test and the trial threshold in the headline", () => {
    const sheet = emptyFactSheet("self_entry");
    sheet.organFunction.ancPerUl = 3200;
    const check: TypedCheck = {
      id: "8",
      kind: "anc_min",
      polarity: "inclusion",
      sourceText: "ANC >= 1500/uL",
      numberValue: 1500,
    };
    const copy = describeVerdict(sheet, check, "met");
    expect(copy.headline).toBe("ANC ≥ 1500/µL: chart shows 3200/µL.");
  });
});

describe("verbatim quotes", () => {
  it("marks a known source typo with [sic] and otherwise leaves the text untouched", () => {
    const html = renderQuoteHtml(
      "Must be HER2 positive-positive by local testing.",
      "positive-positive",
      escape,
    );
    expect(html).toContain("positive-positive");
    expect(html).toContain("[sic]");
    expect(html).toContain("<mark>positive-positive</mark> [sic]");
    const clean = renderQuoteHtml("Documented EGFR exon 19 deletion.", "EGFR exon 19 deletion", escape);
    expect(clean).not.toContain("[sic]");
    expect(clean).toContain("<mark>EGFR exon 19 deletion</mark>");
  });
});
