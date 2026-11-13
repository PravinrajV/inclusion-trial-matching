import { describe, expect, it } from "vitest";
import {
  applyQuoteGate,
  isVerbatimQuote,
  mergeTwoRuns,
  PIPELINE_ID,
} from "../scripts/lib/ai-logic-parse-pipeline.mjs";

const elig = "ECOG performance status of 0 or 1. Age 18 years or older.";

describe("option (a) public-trial parse gates", () => {
  it("keeps only verbatim evidence quotes", () => {
    expect(isVerbatimQuote("ECOG performance status of 0 or 1", elig)).toBe(true);
    expect(isVerbatimQuote("paraphrased ECOG score", elig)).toBe(false);
    const gated = applyQuoteGate(
      {
        typedChecks: [
          { id: "1", kind: "ecog_max", polarity: "inclusion", numberValue: 1, sourceText: "ECOG performance status of 0 or 1" },
          { id: "2", kind: "age_min", polarity: "inclusion", numberValue: 18, sourceText: "must be an adult" },
        ],
        fuzzyCriteria: [],
      },
      elig,
    );
    expect(gated.typedChecks.map((c: { kind: string }) => c.kind)).toEqual(["ecog_max"]);
    expect(gated.unquoted).toHaveLength(1);
  });

  it("uses the model as producer and the normalizer only as a verifier", () => {
    const quoted = {
      typedChecks: [
        { id: "1", kind: "ecog_max", polarity: "inclusion", numberValue: 1, sourceText: "ECOG performance status of 0 or 1" },
      ],
      fuzzyCriteria: [],
    };
    const merged = mergeTwoRuns(quoted, quoted, elig, "NCT00000000", { minimumAge: "18 Years" });
    expect(merged.pipeline).toBe(PIPELINE_ID);
    expect(merged.typedChecks.map((c: { kind: string }) => c.kind)).toEqual(["ecog_max"]);
    // The normalizer would also emit age_min from "18 years or older", but it must not add checks the model did not produce.
    expect(merged.typedChecks.some((c: { kind: string }) => c.kind === "age_min")).toBe(false);
    expect(merged.gates.verifier.normalizerTypedCount).toBeGreaterThan(merged.typedChecks.length);
  });

  it("demotes two-run disagreements to Discuss", () => {
    const a = {
      typedChecks: [
        { id: "1", kind: "ecog_max", polarity: "inclusion", numberValue: 1, sourceText: "ECOG performance status of 0 or 1" },
        { id: "2", kind: "ecog_max", polarity: "inclusion", numberValue: 2, sourceText: "ECOG performance status of 0 or 1" },
      ],
      fuzzyCriteria: [],
    };
    const b = {
      typedChecks: [
        { id: "1", kind: "ecog_max", polarity: "inclusion", numberValue: 1, sourceText: "ECOG performance status of 0 or 1" },
      ],
      fuzzyCriteria: [],
    };
    const merged = mergeTwoRuns(a, b, elig, "NCT00000000", { minimumAge: "18 Years" });
    expect(merged.typedChecks).toHaveLength(1);
    expect(merged.typedChecks[0].numberValue).toBe(1);
    expect(merged.gates.consistency.disagreements).toBeGreaterThan(0);
  });
});
