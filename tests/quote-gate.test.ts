import { describe, expect, it } from "vitest";
import { isVerbatimNoteQuote, keepVerbatimExcerpts } from "../src/intake/quote-gate";

const note = `Synthetic oncology progress note. Not a real patient.
Alex Rivera is a 62-year-old never-smoker who lives in Columbus, Ohio. ECOG performance status 1.`;

describe("clinic-note quote gate", () => {
  it("keeps excerpts whose quote is a verbatim substring of the note", () => {
    const kept = keepVerbatimExcerpts(
      [
        { fact: "ECOG 1", quote: "ECOG performance status 1" },
        { fact: "invented", quote: "the patient is fully active" },
      ],
      note,
    );
    expect(kept).toEqual([{ fact: "ECOG 1", quote: "ECOG performance status 1" }]);
    expect(isVerbatimNoteQuote("Columbus, Ohio", note)).toBe(true);
  });

  it("keeps evidence_quote aliases and typographic punctuation", () => {
    const kept = keepVerbatimExcerpts(
      [
        { fact: "home", evidence_quote: "Columbus, Ohio" },
        { fact: "ecog", quote: "“ECOG performance status 1”" },
      ],
      note,
    );
    expect(kept.map((k) => k.fact).sort()).toEqual(["ecog", "home"]);
  });

  it("still drops a paraphrase", () => {
    const kept = keepVerbatimExcerpts([{ fact: "invented", evidence_quote: "the patient is fully active" }], note);
    expect(kept).toEqual([]);
  });
});
