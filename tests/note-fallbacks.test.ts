import { describe, expect, it } from "vitest";
import { factSheetFromNanoRaw } from "../src/intake/nano-extract";
import { fillOmittedFieldsFromNote } from "../src/intake/note-fallbacks";
import { emptyFactSheet } from "../src/schema/fact-sheet";
import { isVerbatimNoteQuote } from "../src/intake/quote-gate";
import personasDoc from "../gold/personas.json";

const alex = personasDoc.personas.find((p) => p.id === "alex-rivera")!;
const sam = personasDoc.personas.find((p) => p.id === "sam-okonkwo")!;

/**
 * Shape observed on THINK with index-BBHdYuuJ.js (12 Nov 2026): Stage IV,
 * prior therapy osimertinib, and Columbus, OH were filled; age, ECOG,
 * histology, EGFR/ALK/KRAS, PD-L1, and prior lines were omitted.
 * This is not a recorded raw-model dump — Playwright was not run on THINK
 * while the owner was at the machine. It encodes the observed omissions.
 */
const thinkShapedAlexRaw = {
  stage: "IV",
  priorTherapies: ["osimertinib"],
  home: { city: "Columbus", state: "OH" },
};

const thinkShapedSamRaw = {
  stage: "IV",
  priorTherapies: ["alectinib"],
  home: { city: "Cincinnati", state: "OH" },
};

describe("note fallbacks when Nano omits fields", () => {
  it("fills Alex's omitted fields from the note and keeps quotes verbatim", () => {
    const { factSheet, excerpts } = factSheetFromNanoRaw(thinkShapedAlexRaw, alex.clinicNote);
    expect(factSheet.stage).toBe("IV");
    expect(factSheet.priorTherapies).toEqual(["osimertinib"]);
    expect(factSheet.home?.city).toBe("Columbus");
    expect(factSheet.ageYears).toBe(62);
    expect(factSheet.ecog).toBe(1);
    expect(factSheet.histology).toBe("adenocarcinoma");
    expect(factSheet.biomarkers.egfr).toEqual({ status: "present", variant: "exon 19 deletion" });
    expect(factSheet.biomarkers.alk.status).toBe("absent");
    expect(factSheet.biomarkers.kras.status).toBe("absent");
    expect(factSheet.biomarkers.pdL1TpsPercent).toBe(30);
    expect(factSheet.priorSystemicLines).toBe(1);
    expect(factSheet.smoking).toBe("never");
    expect(factSheet.brainMets.status).toBe("none");
    expect(excerpts.length).toBeGreaterThan(0);
    for (const ex of excerpts) {
      expect(isVerbatimNoteQuote(ex.quote, alex.clinicNote), ex.quote).toBe(true);
    }
  });

  it("fills Sam's omitted fields, including ALK present and EGFR absent", () => {
    const { factSheet } = factSheetFromNanoRaw(thinkShapedSamRaw, sam.clinicNote);
    expect(factSheet.ageYears).toBe(54);
    expect(factSheet.ecog).toBe(0);
    expect(factSheet.histology).toBe("adenocarcinoma");
    expect(factSheet.biomarkers.alk.status).toBe("present");
    expect(factSheet.biomarkers.egfr.status).toBe("absent");
    expect(factSheet.biomarkers.kras.status).toBe("absent");
    expect(factSheet.biomarkers.pdL1TpsPercent).toBe(5);
    expect(factSheet.priorTherapies).toEqual(["alectinib"]);
    expect(factSheet.priorSystemicLines).toBe(1);
    expect(factSheet.brainMets.status).toBe("treated_stable");
  });

  it("does not overwrite a field Nano already filled", () => {
    const raw = {
      ...thinkShapedAlexRaw,
      ageYears: 99,
      ecog: 3,
      histology: "squamous",
      biomarkers: { egfr: { status: "absent" }, pdL1TpsPercent: 1 },
      priorSystemicLines: 2,
    };
    const { factSheet } = factSheetFromNanoRaw(raw, alex.clinicNote);
    expect(factSheet.ageYears).toBe(99);
    expect(factSheet.ecog).toBe(3);
    expect(factSheet.histology).toBe("squamous");
    expect(factSheet.biomarkers.egfr.status).toBe("absent");
    expect(factSheet.biomarkers.pdL1TpsPercent).toBe(1);
    expect(factSheet.priorSystemicLines).toBe(2);
  });

  it("does not invent quotes that are not substrings of the note", () => {
    const sheet = emptyFactSheet("on_device_model");
    fillOmittedFieldsFromNote(sheet, alex.clinicNote);
    sheet.excerpts.push({ fact: "invented", quote: "this phrase is not in the note at all" });
    const honest = sheet.excerpts.filter((ex) => isVerbatimNoteQuote(ex.quote, alex.clinicNote));
    expect(honest.some((ex) => ex.fact === "invented")).toBe(false);
    expect(honest.length).toBeGreaterThan(0);
  });
});

describe("tolerant Nano key mapping", () => {
  it("accepts ecog_ps, egfr_status, age as 62-year-old, and adenocarcinoma of the lung", () => {
    const raw = {
      age: "62-year-old",
      stage: "Stage IV",
      histology: "adenocarcinoma of the lung",
      ecog_ps: "1",
      egfr_status: { status: "present", variant: "exon 19 deletion" },
      alk_status: "not detected",
      kras_status: "absent",
      pd_l1_tps: "30%",
      prior_therapy: "osimertinib",
      prior_lines: 1,
      home: { city: "Columbus", state: "Ohio" },
    };
    const { factSheet } = factSheetFromNanoRaw(raw, alex.clinicNote);
    expect(factSheet.ageYears).toBe(62);
    expect(factSheet.stage).toBe("IV");
    expect(factSheet.histology).toBe("adenocarcinoma");
    expect(factSheet.ecog).toBe(1);
    expect(factSheet.biomarkers.egfr).toEqual({ status: "present", variant: "exon 19 deletion" });
    expect(factSheet.biomarkers.alk.status).toBe("absent");
    expect(factSheet.biomarkers.kras.status).toBe("absent");
    expect(factSheet.biomarkers.pdL1TpsPercent).toBe(30);
    expect(factSheet.priorTherapies).toEqual(["osimertinib"]);
    expect(factSheet.priorSystemicLines).toBe(1);
  });
});
