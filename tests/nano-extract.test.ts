import { describe, expect, it } from "vitest";
import { factSheetFromNanoRaw } from "../src/intake/nano-extract";
import { isVerbatimNoteQuote } from "../src/intake/quote-gate";
import { factSheetFromSelfEntry } from "../src/intake/self-entry";
import personasDoc from "../gold/personas.json";

const alex = personasDoc.personas.find((p) => p.id === "alex-rivera")!;
const note = alex.clinicNote;

describe("Nano fact sheet parse", () => {
  it("accepts string-encoded numbers, evidence_quote keys, and fills the same chips as a complete sheet", () => {
    const raw = {
      ageYears: "62",
      stage: "IV",
      histology: "Adenocarcinoma",
      ecog: "1",
      smoking: "never",
      biomarkers: {
        egfr: { status: "Present", variant: "exon 19 deletion" },
        alk: { status: "absent" },
        kras: { status: "absent" },
        pdL1TpsPercent: "30%",
      },
      priorSystemicLines: "1",
      priorTherapies: ["osimertinib"],
      brainMets: { status: "none" },
      organFunction: { egfrMlMin: "85", hemoglobinGdl: "12.4" },
      home: { city: "Columbus", state: "Ohio" },
      excerpts: [
        { fact: "EGFR", evidence_quote: "EGFR exon 19 deletion" },
        { fact: "ECOG", quote: "ECOG performance status 1" },
      ],
    };
    const result = factSheetFromNanoRaw(raw, note);
    const sheet = result.factSheet;
    expect(sheet.ageYears).toBe(62);
    expect(sheet.ecog).toBe(1);
    expect(sheet.stage).toBe("IV");
    expect(sheet.histology).toBe("adenocarcinoma");
    expect(sheet.biomarkers.egfr).toEqual({ status: "present", variant: "exon 19 deletion" });
    expect(sheet.biomarkers.pdL1TpsPercent).toBe(30);
    expect(sheet.organFunction.egfrMlMin).toBe(85);
    expect(sheet.organFunction.hemoglobinGdl).toBe(12.4);
    expect(sheet.home?.city).toBe("Columbus");
    expect(sheet.priorTherapies).toEqual(["osimertinib"]);
    expect(result.excerpts.some((ex) => ex.fact === "EGFR" && ex.quote.includes("EGFR exon 19 deletion"))).toBe(true);
    expect(result.excerpts.some((ex) => ex.fact === "ECOG")).toBe(true);
    expect(result.excerpts.length).toBeGreaterThanOrEqual(2);
    expect(result.droppedUnquoted).toBe(0);
  });

  it("still drops a non-verbatim evidence_quote", () => {
    const result = factSheetFromNanoRaw(
      {
        stage: "IV",
        excerpts: [{ fact: "stage", evidence_quote: "widely metastatic lung cancer" }],
      },
      note,
    );
    expect(result.droppedUnquoted).toBe(1);
    expect(result.excerpts.some((ex) => /widely metastatic/i.test(ex.quote))).toBe(false);
    expect(result.excerpts.length).toBeGreaterThan(0);
    for (const ex of result.excerpts) {
      expect(isVerbatimNoteQuote(ex.quote, note), ex.quote).toBe(true);
    }
    expect(result.factSheet.stage).toBe("IV");
  });
});

describe("self-entry merge", () => {
  it("keeps home and excerpts from the current sheet when the form is edited", () => {
    const previous = factSheetFromNanoRaw(
      {
        ageYears: 62,
        stage: "IV",
        priorTherapies: ["osimertinib"],
        home: { city: "Columbus", state: "Ohio" },
        excerpts: [{ fact: "EGFR", evidence_quote: "EGFR exon 19 deletion" }],
      },
      note,
    ).factSheet;
    const root = document.createElement("div");
    root.innerHTML = `
      <input id="age" value="62" />
      <select id="ecog"><option value="" selected></option></select>
      <select id="stage"><option value="IV" selected>IV</option></select>
      <select id="histology"><option value="unknown" selected></option></select>
      <input id="egfr" value="" />
      <input id="alk" value="" />
      <input id="kras" value="" />
      <input id="pdl1" value="" />
      <input id="lines" value="" />
      <input id="prior-therapies" value="osimertinib" />
      <select id="brain"><option value="unknown" selected></option></select>
      <input id="egfr-lab" value="" />
      <input id="hemoglobin" value="" />
    `;
    const merged = factSheetFromSelfEntry(root, previous);
    expect(merged.stage).toBe("IV");
    expect(merged.priorTherapies).toEqual(["osimertinib"]);
    expect(merged.home?.city).toBe("Columbus");
    expect(merged.excerpts.some((ex) => ex.fact === "EGFR" && ex.quote.includes("EGFR exon 19 deletion"))).toBe(true);
    expect(merged.excerpts.length).toBeGreaterThanOrEqual(1);
  });
});
