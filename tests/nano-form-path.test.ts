import { describe, expect, it } from "vitest";
import { factSheetFromNanoRaw } from "../src/intake/nano-extract";
import { beginFactSheetApply, endFactSheetApply, factSheetFromSelfEntry, isApplyingFactSheet } from "../src/intake/self-entry";
import { factSheetChipLabels } from "../src/app";
import type { FactSheet } from "../src/schema/fact-sheet";
import personasDoc from "../gold/personas.json";

const alex = personasDoc.personas.find((p) => p.id === "alex-rivera")!;
const note = alex.clinicNote;

/** Realistic on-device Nano JSON: string numbers, evidence_quote, typographic quotes. */
const realisticNanoJson = {
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
    { fact: "ECOG", quote: "“ECOG performance status 1”" },
  ],
};

function mountUi(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <details class="facts-editor" id="facts-editor">
      <summary>Enter or edit facts</summary>
      <div id="self-entry">
        <input id="age" type="number" />
        <select id="ecog"><option value="">Unknown</option><option>0</option><option>1</option><option>2</option><option>3</option><option>4</option></select>
        <select id="stage"><option value="unknown">Unknown</option><option>IV</option><option>IIIA</option></select>
        <select id="histology"><option value="unknown">Unknown</option><option value="adenocarcinoma">Adenocarcinoma</option></select>
        <input id="egfr" />
        <input id="alk" />
        <input id="kras" />
        <input id="pdl1" type="number" />
        <input id="lines" type="number" />
        <select id="brain"><option value="unknown">Unknown</option><option value="none">None</option></select>
        <input id="prior-therapies" />
        <input id="egfr-lab" type="number" />
        <input id="hemoglobin" type="number" step="0.1" />
      </div>
    </details>
    <aside id="chart-card"><div class="facts" id="facts-preview"></div></aside>
  `;
  return root;
}

function setInput(root: HTMLElement, id: string, value: string): void {
  const el = root.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement | null;
  if (el) el.value = value;
}

function applyFactSheet(root: HTMLElement, state: { factSheet: FactSheet }, sheet: FactSheet): void {
  beginFactSheetApply();
  try {
    state.factSheet = structuredClone(sheet);
    setInput(root, "age", sheet.ageYears == null ? "" : String(sheet.ageYears));
    setInput(root, "ecog", sheet.ecog == null ? "" : String(sheet.ecog));
    setInput(root, "stage", sheet.stage || "unknown");
    setInput(root, "histology", sheet.histology || "unknown");
    setInput(root, "egfr", sheet.biomarkers.egfr.variant || (sheet.biomarkers.egfr.status !== "unknown" ? sheet.biomarkers.egfr.status : ""));
    setInput(root, "alk", sheet.biomarkers.alk.status === "unknown" ? "" : sheet.biomarkers.alk.status || "");
    setInput(root, "kras", sheet.biomarkers.kras.status === "unknown" ? "" : sheet.biomarkers.kras.status || "");
    setInput(root, "pdl1", sheet.biomarkers.pdL1TpsPercent == null ? "" : String(sheet.biomarkers.pdL1TpsPercent));
    setInput(root, "lines", sheet.priorSystemicLines == null ? "" : String(sheet.priorSystemicLines));
    setInput(root, "brain", sheet.brainMets?.status || "unknown");
    setInput(root, "prior-therapies", (sheet.priorTherapies || []).join(", "));
    setInput(root, "egfr-lab", sheet.organFunction.egfrMlMin == null ? "" : String(sheet.organFunction.egfrMlMin));
    setInput(root, "hemoglobin", sheet.organFunction.hemoglobinGdl == null ? "" : String(sheet.organFunction.hemoglobinGdl));
    const preview = root.querySelector("#facts-preview") as HTMLElement;
    const bits = factSheetChipLabels(state.factSheet);
    preview.innerHTML = `<ul class="fact-chips">${bits.map((b) => `<li>${b}</li>`).join("")}</ul>`;
  } finally {
    endFactSheetApply();
  }
}

describe("Nano to form and card path", () => {
  it("keeps extracted facts when an empty form is merged (the live THINK regression)", () => {
    const extracted = factSheetFromNanoRaw(realisticNanoJson, note).factSheet;
    const root = mountUi();
    // This is the form as it looks before applyFactSheet writes values,
    // or after a spurious input event reads the unfilled defaults.
    const merged = factSheetFromSelfEntry(root, extracted);
    const chips = factSheetChipLabels(merged);
    expect(merged.ageYears).toBe(62);
    expect(merged.stage).toBe("IV");
    expect(merged.ecog).toBe(1);
    expect(merged.histology).toBe("adenocarcinoma");
    expect(merged.biomarkers.egfr.variant).toBe("exon 19 deletion");
    expect(merged.priorTherapies).toEqual(["osimertinib"]);
    expect(merged.home?.city).toBe("Columbus");
    expect(chips).toContain("Age 62");
    expect(chips).toContain("Stage IV");
    expect(chips).toContain("EGFR exon 19 deletion");
    expect(chips).toContain("Prior therapy: osimertinib");
    expect(chips).toContain("Columbus, OH");
    expect(chips.length).toBeGreaterThan(2);
  });

  it("writes the form and card, and a bubbled input event does not wipe them", () => {
    const extracted = factSheetFromNanoRaw(realisticNanoJson, note);
    expect(extracted.excerpts.some((ex) => ex.fact === "EGFR")).toBe(true);
    expect(extracted.excerpts.length).toBeGreaterThanOrEqual(2);
    const root = mountUi();
    const state = { factSheet: extracted.factSheet };
    const selfEntry = root.querySelector("#self-entry") as HTMLElement;
    selfEntry.addEventListener("input", () => {
      if (isApplyingFactSheet()) return;
      state.factSheet = factSheetFromSelfEntry(root, state.factSheet);
    });
    applyFactSheet(root, state, extracted.factSheet);
    // Simulate Chrome firing input on programmatic writes, and a later edit-pass.
    selfEntry.dispatchEvent(new Event("input", { bubbles: true }));
    expect((root.querySelector("#age") as HTMLInputElement).value).toBe("62");
    expect((root.querySelector("#stage") as HTMLSelectElement).value).toBe("IV");
    expect((root.querySelector("#prior-therapies") as HTMLInputElement).value).toBe("osimertinib");
    expect((root.querySelector("#egfr") as HTMLInputElement).value).toBe("exon 19 deletion");
    const chips = factSheetChipLabels(state.factSheet);
    const card = root.querySelector("#facts-preview")!.textContent || "";
    expect(card).toContain("Age 62");
    expect(card).toContain("Stage IV");
    expect(card).toContain("Columbus, OH");
    expect(chips).toContain("Prior therapy: osimertinib");
    expect(chips.filter((c) => c !== "Columbus, OH").length).toBeGreaterThan(0);
  });
});
