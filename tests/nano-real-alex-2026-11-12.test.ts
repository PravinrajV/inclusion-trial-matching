import { describe, expect, it } from "vitest";
import rawAlex from "./fixtures/nano-real-alex-2026-11-12.json";
import { factSheetFromNanoRaw, num, stripPatientNames } from "../src/intake/nano-extract";
import { isNanoDebugEnabled, nanoDebugPanelMarkup, renderNanoDebug } from "../src/intake/nano-debug";
import { isVerbatimNoteQuote } from "../src/intake/quote-gate";
import { factSheetChipLabels } from "../src/app";
import personasDoc from "../gold/personas.json";

const alex = personasDoc.personas.find((p) => p.id === "alex-rivera")!;
const note = alex.clinicNote;

const expectedQuotes: Array<{ fact: string; quote: string }> = [
  { fact: "histology", quote: "adenocarcinoma" },
  { fact: "EGFR", quote: "EGFR exon 19 deletion" },
  { fact: "ALK", quote: "ALK rearrangement not detected" },
  { fact: "KRAS", quote: "KRAS mutation not detected" },
  { fact: "PD-L1", quote: "PD-L1 TPS 30%" },
  { fact: "prior lines", quote: "No other systemic lines" },
  { fact: "smoking", quote: "never-smoker" },
  { fact: "brain metastases", quote: "MRI brain without evidence of metastases" },
  { fact: "age", quote: "62-year-old" },
  { fact: "ECOG", quote: "ECOG performance status 1" },
  { fact: "stage", quote: "stage IV" },
  { fact: "home", quote: "Columbus, Ohio" },
];

describe("recorded real Nano fixture (Alex, 12 Nov 2026)", () => {
  it("parses the raw THINK output into a full sheet with labs, 12 verbatim quotes, and no patient name", () => {
    const raw = rawAlex as Record<string, unknown>;
    expect(raw.patient_name).toBe("Alex Rivera");

    const { factSheet, excerpts, rawModel } = factSheetFromNanoRaw(raw, note);

    expect(factSheet.ageYears).toBe(62);
    expect(factSheet.stage).toBe("IV");
    expect(factSheet.histology).toBe("adenocarcinoma");
    expect(factSheet.ecog).toBe(1);
    expect(factSheet.smoking).toBe("never");
    expect(factSheet.biomarkers.egfr).toEqual({ status: "present", variant: "exon 19 deletion" });
    expect(factSheet.biomarkers.alk.status).toBe("absent");
    expect(factSheet.biomarkers.kras.status).toBe("absent");
    expect(factSheet.biomarkers.pdL1TpsPercent).toBe(30);
    expect(factSheet.priorTherapies).toEqual(["osimertinib"]);
    expect(factSheet.priorSystemicLines).toBe(1);
    expect(factSheet.brainMets.status).toBe("none");
    expect(factSheet.home).toMatchObject({ city: "Columbus", state: "OH" });

    expect(factSheet.organFunction).toEqual({
      creatinineMgDl: 0.9,
      egfrMlMin: 85,
      astUL: 28,
      altUL: 22,
      totalBilirubinMgDl: 0.6,
      ancPerUl: 3200,
      plateletsPerUl: 210000,
      hemoglobinGdl: 12.4,
    });

    // labs.egfr is kidney function and must not collide with the EGFR mutation.
    expect(factSheet.biomarkers.egfr.status).toBe("present");
    expect(factSheet.organFunction.egfrMlMin).toBe(85);

    expect(excerpts).toHaveLength(12);
    for (const expected of expectedQuotes) {
      expect(excerpts).toContainEqual(expected);
      expect(isVerbatimNoteQuote(expected.quote, note), expected.quote).toBe(true);
    }

    const serialized = JSON.stringify({ factSheet, excerpts, rawModel });
    expect(serialized).not.toContain("Alex Rivera");
    expect(serialized).not.toContain("patient_name");
    expect(rawModel).not.toHaveProperty("patient_name");
    expect(JSON.stringify(factSheet)).not.toMatch(/Alex|Rivera|patient_name/i);

    const chips = factSheetChipLabels(factSheet);
    expect(chips.join(" ")).not.toMatch(/Alex|Rivera/i);
    expect(chips).toContain("eGFR 85 mL/min");
    expect(chips).toContain("Creatinine 0.9 mg/dL");
    expect(chips).toContain("Hemoglobin 12.4 g/dL");
  });

  it("attributes prior lines and smoking normalization honestly", () => {
    const raw = rawAlex as Record<string, unknown>;
    expect(raw).not.toHaveProperty("priorSystemicLines");
    expect(raw).not.toHaveProperty("prior_systemic_lines");
    expect(raw.smoking_history).toBe("never-smoker");

    const { factSheet } = factSheetFromNanoRaw(raw, note);
    // Nano did not emit a line count; the on-device fallback filled 1 from the note.
    expect(factSheet.priorSystemicLines).toBe(1);
    // Nano supplied smoking_history; the parser normalizes "never-smoker" to never.
    expect(factSheet.smoking).toBe("never");
  });

  it("redacts the patient name in the local debug panel", () => {
    const root = document.createElement("div");
    root.innerHTML = nanoDebugPanelMarkup();
    const { factSheet, rawModel } = factSheetFromNanoRaw(rawAlex as Record<string, unknown>, note);
    renderNanoDebug(root, { rawModel, factSheet }, "?debug=nano");
    expect(isNanoDebugEnabled("?debug=nano")).toBe(true);
    const shown = `${root.querySelector("#nano-debug-raw")?.textContent}${root.querySelector("#nano-debug-parsed")?.textContent}`;
    expect(shown).not.toContain("Alex Rivera");
    expect(shown).not.toContain("patient_name");
    expect(shown).toContain("osimertinib");
  });
});

describe("unit-aware lab parsing", () => {
  it("reads leading numbers and ignores units", () => {
    expect(num("0.9 mg/dL")).toBe(0.9);
    expect(num("85 mL/min")).toBe(85);
    expect(num("3200/uL")).toBe(3200);
    expect(num("210000/uL")).toBe(210000);
    expect(num("12.4 g/dL")).toBe(12.4);
    expect(num("28")).toBe(28);
    expect(num("30%")).toBe(30);
  });

  it("strips patient name keys from a raw object", () => {
    const cleaned = stripPatientNames({ patient_name: "Alex Rivera", stage: "IV", nested: { fullName: "Alex Rivera", ecog: 1 } });
    expect(cleaned).toEqual({ stage: "IV", nested: { ecog: 1 } });
  });
});
