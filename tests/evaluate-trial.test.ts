import { describe, expect, it } from "vitest";
import { evaluateTrial, rankPossibleMatches } from "../src/match/evaluate";
import { emptyFactSheet } from "../src/schema/fact-sheet";
import { GROUP_DISCUSS, GROUP_MET, GROUP_NOT_MET, POSSIBLE_MATCH_LABEL } from "../src/ui/copy";
import type { ParsedTrial } from "../src/schema/criterion";

function trial(over: Partial<ParsedTrial> = {}): ParsedTrial {
  return {
    schemaVersion: "1",
    nctId: "NCT00000001",
    parsedAt: "2026-11-11T00:00:00Z",
    parserModel: "test",
    promptVersion: "4-deterministic",
    typedChecks: [
      { id: "age", kind: "age_min", polarity: "inclusion", sourceText: "Age >= 18", evidence_quote: "Age >= 18", numberValue: 18 },
      { id: "ecog", kind: "ecog_max", polarity: "inclusion", sourceText: "ECOG 0-1", evidence_quote: "ECOG 0-1", numberValue: 1 },
    ],
    fuzzyCriteria: [],
    ...over,
  };
}

describe("evaluateTrial", () => {
  it("marks a possible match only when no typed check is not_met, and never says the person qualifies", () => {
    const sheet = emptyFactSheet("self_entry");
    sheet.ageYears = 62;
    sheet.ecog = 1;
    const result = evaluateTrial(sheet, trial());
    expect(result.possibleMatch).toBe(true);
    expect(result.met).toBe(2);
    expect(result.notMet).toBe(0);
    expect(result.label).toBe(POSSIBLE_MATCH_LABEL);
    expect(result.results.every((r) => r.group === GROUP_MET)).toBe(true);
    expect(result.label.toLowerCase()).toContain("possible match");
    expect(result.label.toLowerCase()).not.toContain("you qualify");
    expect(result.label.toLowerCase()).not.toContain("eligible");
    expect(GROUP_MET).toBe("Met (quoted)");
    expect(GROUP_NOT_MET).toBe("Not met (quoted)");
    expect(GROUP_DISCUSS).toBe("Discuss with your care team");
  });

  it("drops a trial when a typed check is not met, even if others are met", () => {
    const sheet = emptyFactSheet("self_entry");
    sheet.ageYears = 62;
    sheet.ecog = 3;
    const result = evaluateTrial(sheet, trial());
    expect(result.possibleMatch).toBe(false);
    expect(result.notMet).toBe(1);
    expect(result.results.some((r) => r.group === GROUP_NOT_MET)).toBe(true);
  });

  it("allows unknown when a fact is missing, counts it as Discuss, and still calls it a possible match", () => {
    const sheet = emptyFactSheet("self_entry");
    sheet.ageYears = 62;
    const result = evaluateTrial(sheet, trial());
    expect(result.unknown).toBe(1);
    expect(result.discuss).toBe(1);
    expect(result.possibleMatch).toBe(true);
    expect(result.results.some((r) => r.group === GROUP_DISCUSS)).toBe(true);
  });

  it("ranks possible matches by more Met (quoted), then fewer Discuss", () => {
    const sheet = emptyFactSheet("self_entry");
    sheet.ageYears = 62;
    sheet.ecog = 1;
    const ranked = rankPossibleMatches(sheet, [
      {
        trial: trial({
          nctId: "NCT00000003",
          typedChecks: [
            { id: "age", kind: "age_min", polarity: "inclusion", sourceText: ">=18", numberValue: 18 },
            { id: "ecog", kind: "ecog_max", polarity: "inclusion", sourceText: "ECOG 0-1", numberValue: 1 },
          ],
          fuzzyCriteria: [{ id: "f", polarity: "inclusion", sourceText: "measurable disease", reasonFuzzy: "subjective" }],
        }),
      },
      { trial: trial({ nctId: "NCT00000002", typedChecks: [{ id: "age", kind: "age_min", polarity: "inclusion", sourceText: ">=18", numberValue: 18 }] }) },
      { trial: trial({ nctId: "NCT00000001" }) },
    ]);
    // NCT00000001: 2 met, 0 discuss; NCT00000003: 2 met, 1 discuss; NCT00000002: 1 met, 0 discuss
    expect(ranked.map((r) => r.nctId)).toEqual(["NCT00000001", "NCT00000003", "NCT00000002"]);
  });
});
