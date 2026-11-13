export const FACT_SHEET_SCHEMA_VERSION = "1" as const;

export type Presence = "present" | "absent" | "unknown";
export type Stage = "IIIA" | "IIIB" | "IIIC" | "IV" | "IVA" | "IVB" | "unknown";
export type Histology =
  | "adenocarcinoma"
  | "squamous"
  | "large_cell"
  | "nsclc_nos"
  | "other"
  | "unknown";
export type Sex = "female" | "male" | "other" | "unknown";
export type Smoking = "never" | "former" | "current" | "unknown";
export type Ecog = 0 | 1 | 2 | 3 | 4;
export type BrainMetsStatus = "none" | "treated_stable" | "untreated" | "unknown";
export type FactSheetSource = "on_device_model" | "self_entry" | "edited";

export interface Biomarker {
  status: Presence;
  variant: string | null;
}

export interface HomeLocation {
  city: string;
  state: string;
  lat: number;
  lon: number;
}

export interface OrganFunction {
  creatinineMgDl: number | null;
  egfrMlMin: number | null;
  astUL: number | null;
  altUL: number | null;
  totalBilirubinMgDl: number | null;
  ancPerUl: number | null;
  plateletsPerUl: number | null;
  hemoglobinGdl: number | null;
}

export interface FactSheet {
  schemaVersion: typeof FACT_SHEET_SCHEMA_VERSION;
  source: FactSheetSource;
  ageYears: number | null;
  sex: Sex;
  home: HomeLocation | null;
  diagnosis: "nsclc";
  stage: Stage;
  histology: Histology;
  ecog: Ecog | null;
  biomarkers: {
    egfr: Biomarker;
    alk: Biomarker;
    kras: Biomarker;
    ros1: Biomarker;
    braf: Biomarker;
    pdL1TpsPercent: number | null;
  };
  priorSystemicLines: number | null;
  priorTherapies: string[];
  brainMets: {
    status: BrainMetsStatus;
    detail: string | null;
  };
  organFunction: OrganFunction;
  smoking: Smoking;
  notes: string | null;
  excerpts: { fact: string; quote: string }[];
}

export function emptyFactSheet(source: FactSheetSource): FactSheet {
  const unknown: Biomarker = { status: "unknown", variant: null };
  return {
    schemaVersion: FACT_SHEET_SCHEMA_VERSION,
    source,
    ageYears: null,
    sex: "unknown",
    home: null,
    diagnosis: "nsclc",
    stage: "unknown",
    histology: "unknown",
    ecog: null,
    biomarkers: {
      egfr: { ...unknown },
      alk: { ...unknown },
      kras: { ...unknown },
      ros1: { ...unknown },
      braf: { ...unknown },
      pdL1TpsPercent: null,
    },
    priorSystemicLines: null,
    priorTherapies: [],
    brainMets: { status: "unknown", detail: null },
    organFunction: {
      creatinineMgDl: null,
      egfrMlMin: null,
      astUL: null,
      altUL: null,
      totalBilirubinMgDl: null,
      ancPerUl: null,
      plateletsPerUl: null,
      hemoglobinGdl: null,
    },
    smoking: "unknown",
    notes: null,
    excerpts: [],
  };
}

/** Flattened values used to prove no chart text leaves the device. */
export function factSheetSnippets(sheet: FactSheet, rawChart?: string): string[] {
  const snippets: string[] = [];
  if (rawChart && rawChart.trim().length >= 12) {
    snippets.push(rawChart.trim());
  }
  if (sheet.notes && sheet.notes.trim().length >= 12) snippets.push(sheet.notes.trim());
  for (const ex of sheet.excerpts) {
    if (ex.quote.trim().length >= 8) snippets.push(ex.quote.trim());
  }
  const variantValues = [
    sheet.biomarkers.egfr.variant,
    sheet.biomarkers.alk.variant,
    sheet.biomarkers.kras.variant,
    sheet.biomarkers.ros1.variant,
    sheet.biomarkers.braf.variant,
    sheet.brainMets.detail,
  ];
  for (const v of variantValues) {
    if (v && v.trim().length >= 6) snippets.push(v.trim());
  }
  for (const t of sheet.priorTherapies) {
    if (t.trim().length >= 6) snippets.push(t.trim());
  }
  return snippets;
}
