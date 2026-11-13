import { emptyFactSheet, type BrainMetsStatus, type FactSheet, type Histology, type Presence, type Stage } from "../schema/fact-sheet";

function parsePresenceAndVariant(raw: string): { status: Presence; variant: string | null } {
  const text = raw.trim();
  if (!text) return { status: "unknown", variant: null };
  const lower = text.toLowerCase();
  if (lower === "absent" || lower === "negative" || lower === "not present" || lower === "wild type" || lower === "wild-type") {
    return { status: "absent", variant: null };
  }
  if (lower === "unknown" || lower === "not tested") return { status: "unknown", variant: null };
  if (lower === "present" || lower === "positive") return { status: "present", variant: null };
  return { status: "present", variant: text };
}

function num(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() === "" || Number.isNaN(n) ? null : n;
}

export function factSheetFromSelfEntry(root: ParentNode, previous?: FactSheet | null): FactSheet {
  const val = (id: string) => (root.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
  const sheet = emptyFactSheet("self_entry");
  const age = num(val("age"));
  sheet.ageYears = age;
  const ecog = num(val("ecog"));
  sheet.ecog = ecog === 0 || ecog === 1 || ecog === 2 || ecog === 3 || ecog === 4 ? ecog : null;
  const stage = val("stage") as Stage | "";
  sheet.stage = stage || "unknown";
  const histology = val("histology") as Histology | "";
  sheet.histology = histology || "unknown";
  sheet.biomarkers.egfr = parsePresenceAndVariant(val("egfr"));
  sheet.biomarkers.alk = parsePresenceAndVariant(val("alk"));
  sheet.biomarkers.kras = parsePresenceAndVariant(val("kras"));
  const pdl1 = num(val("pdl1"));
  sheet.biomarkers.pdL1TpsPercent = pdl1;
  sheet.priorSystemicLines = num(val("lines"));
  const prior = val("prior-therapies");
  sheet.priorTherapies = prior
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const brain = val("brain") as BrainMetsStatus | "";
  sheet.brainMets = { status: brain || "unknown", detail: null };
  const egfrLab = num(val("egfr-lab"));
  if (egfrLab != null) sheet.organFunction.egfrMlMin = egfrLab;
  const hgb = num(val("hemoglobin"));
  if (hgb != null) sheet.organFunction.hemoglobinGdl = hgb;
  return mergePreviousFactSheet(sheet, previous);
}

let applyingFactSheet = 0;

/** Ignore self-entry input events while applyFactSheet is writing the form. */
export function beginFactSheetApply(): void {
  applyingFactSheet += 1;
}

export function endFactSheetApply(): void {
  applyingFactSheet = Math.max(0, applyingFactSheet - 1);
}

export function isApplyingFactSheet(): boolean {
  return applyingFactSheet > 0;
}

/**
 * The form defaults to empty or "unknown". Those defaults must not wipe a
 * just-applied Nano or persona sheet (including after a spurious input event).
 */
export function mergePreviousFactSheet(sheet: FactSheet, previous?: FactSheet | null): FactSheet {
  if (!previous) return sheet;
  if (sheet.ageYears == null && previous.ageYears != null) sheet.ageYears = previous.ageYears;
  if (sheet.ecog == null && previous.ecog != null) sheet.ecog = previous.ecog;
  if ((!sheet.stage || sheet.stage === "unknown") && previous.stage && previous.stage !== "unknown") {
    sheet.stage = previous.stage;
  }
  if ((!sheet.histology || sheet.histology === "unknown") && previous.histology && previous.histology !== "unknown") {
    sheet.histology = previous.histology;
  }
  const genes = ["egfr", "alk", "kras", "ros1", "braf"] as const;
  for (const gene of genes) {
    if (sheet.biomarkers[gene].status === "unknown" && previous.biomarkers[gene].status !== "unknown") {
      sheet.biomarkers[gene] = { ...previous.biomarkers[gene] };
    }
  }
  if (sheet.biomarkers.pdL1TpsPercent == null && previous.biomarkers.pdL1TpsPercent != null) {
    sheet.biomarkers.pdL1TpsPercent = previous.biomarkers.pdL1TpsPercent;
  }
  if (sheet.priorSystemicLines == null && previous.priorSystemicLines != null) {
    sheet.priorSystemicLines = previous.priorSystemicLines;
  }
  if (!sheet.priorTherapies.length && previous.priorTherapies.length) {
    sheet.priorTherapies = [...previous.priorTherapies];
  }
  if ((!sheet.brainMets.status || sheet.brainMets.status === "unknown") && previous.brainMets.status && previous.brainMets.status !== "unknown") {
    sheet.brainMets = { ...previous.brainMets };
  }
  if (sheet.organFunction.egfrMlMin == null) sheet.organFunction.egfrMlMin = previous.organFunction.egfrMlMin;
  if (sheet.organFunction.hemoglobinGdl == null) sheet.organFunction.hemoglobinGdl = previous.organFunction.hemoglobinGdl;
  if (sheet.organFunction.creatinineMgDl == null) sheet.organFunction.creatinineMgDl = previous.organFunction.creatinineMgDl;
  if (sheet.organFunction.astUL == null) sheet.organFunction.astUL = previous.organFunction.astUL;
  if (sheet.organFunction.altUL == null) sheet.organFunction.altUL = previous.organFunction.altUL;
  if (sheet.organFunction.totalBilirubinMgDl == null) sheet.organFunction.totalBilirubinMgDl = previous.organFunction.totalBilirubinMgDl;
  if (sheet.organFunction.ancPerUl == null) sheet.organFunction.ancPerUl = previous.organFunction.ancPerUl;
  if (sheet.organFunction.plateletsPerUl == null) sheet.organFunction.plateletsPerUl = previous.organFunction.plateletsPerUl;
  if (!sheet.home && previous.home) sheet.home = previous.home;
  if (!sheet.excerpts?.length && previous.excerpts?.length) sheet.excerpts = previous.excerpts;
  if ((!sheet.smoking || sheet.smoking === "unknown") && previous.smoking && previous.smoking !== "unknown") {
    sheet.smoking = previous.smoking;
  }
  if ((!sheet.sex || sheet.sex === "unknown") && previous.sex && previous.sex !== "unknown") {
    sheet.sex = previous.sex;
  }
  return sheet;
}
