/**
 * On-device clinic-note extraction through Firebase AI Logic in ONLY_ON_DEVICE
 * mode (Chrome Gemini Nano). Chart text never uses a cloud inference mode.
 */
import type { FirebaseApp } from "firebase/app";
import { Schema } from "firebase/ai";
import { createChartExtractModel } from "../hybrid/client";
import {
  emptyFactSheet,
  type Biomarker,
  type BrainMetsStatus,
  type FactSheet,
  type Histology,
  type HomeLocation,
  type Presence,
  type Stage,
} from "../schema/fact-sheet";
import { fillOmittedFieldsFromNote, recoverVerbatimQuotes } from "./note-fallbacks";
import { excerptQuoteOf, keepVerbatimExcerpts } from "./quote-gate";

const SYSTEM = `You extract a structured oncology fact sheet from a SYNTHETIC clinic note. This note stays on this device. Return JSON only.

Rules:
- Fill every structured field the note states, even if you cannot quote it.
- When you can, add excerpts with fact and a verbatim quote substring from the note. The quote field may also be named evidence_quote.
- Never invent labs, biomarkers, treatments, or a stage that the note does not write.
- pdL1TpsPercent is the TPS number only, without a percent sign. Prefer JSON numbers.
- priorTherapies is a list of drug or regimen names written in the note.
- home.city and home.state only if the note names a city and state.`;

function factSheetSchema() {
  const presence = Schema.enumString({ enum: ["present", "absent", "unknown"] });
  const biomarker = Schema.object({
    properties: {
      status: presence,
      variant: Schema.string(),
    },
    optionalProperties: ["variant"],
  });
  return Schema.object({
    properties: {
      ageYears: Schema.number(),
      sex: Schema.enumString({ enum: ["female", "male", "other", "unknown"] }),
      stage: Schema.enumString({ enum: ["IIIA", "IIIB", "IIIC", "IV", "IVA", "IVB", "unknown"] }),
      histology: Schema.enumString({
        enum: ["adenocarcinoma", "squamous", "large_cell", "nsclc_nos", "other", "unknown"],
      }),
      ecog: Schema.number(),
      smoking: Schema.enumString({ enum: ["never", "former", "current", "unknown"] }),
      biomarkers: Schema.object({
        properties: {
          egfr: biomarker,
          alk: biomarker,
          kras: biomarker,
          ros1: biomarker,
          braf: biomarker,
          pdL1TpsPercent: Schema.number(),
        },
        optionalProperties: ["egfr", "alk", "kras", "ros1", "braf", "pdL1TpsPercent"],
      }),
      priorSystemicLines: Schema.number(),
      priorTherapies: Schema.array({ items: Schema.string() }),
      brainMets: Schema.object({
        properties: {
          status: Schema.enumString({ enum: ["none", "treated_stable", "untreated", "unknown"] }),
          detail: Schema.string(),
        },
        optionalProperties: ["detail"],
      }),
      organFunction: Schema.object({
        properties: {
          creatinineMgDl: Schema.number(),
          egfrMlMin: Schema.number(),
          astUL: Schema.number(),
          altUL: Schema.number(),
          totalBilirubinMgDl: Schema.number(),
          ancPerUl: Schema.number(),
          plateletsPerUl: Schema.number(),
          hemoglobinGdl: Schema.number(),
        },
        optionalProperties: [
          "creatinineMgDl",
          "egfrMlMin",
          "astUL",
          "altUL",
          "totalBilirubinMgDl",
          "ancPerUl",
          "plateletsPerUl",
          "hemoglobinGdl",
        ],
      }),
      home: Schema.object({
        properties: {
          city: Schema.string(),
          state: Schema.string(),
        },
      }),
      excerpts: Schema.array({
        items: Schema.object({
          properties: {
            fact: Schema.string(),
            quote: Schema.string(),
          },
        }),
      }),
    },
    optionalProperties: [
      "ageYears",
      "sex",
      "stage",
      "histology",
      "ecog",
      "smoking",
      "biomarkers",
      "priorSystemicLines",
      "priorTherapies",
      "brainMets",
      "organFunction",
      "home",
      "excerpts",
    ],
  });
}

/** City-level homes for places named in the synthetic demo notes. Never invent coordinates. */
const KNOWN_HOMES: Record<string, HomeLocation> = {
  "columbus, ohio": { city: "Columbus", state: "OH", lat: 39.9612, lon: -82.9988 },
  "columbus, oh": { city: "Columbus", state: "OH", lat: 39.9612, lon: -82.9988 },
};

function resolveHome(raw: { city?: string; state?: string } | undefined, note: string): HomeLocation | null {
  if (!raw?.city) return null;
  const state = String(raw.state || "").trim();
  const key = `${raw.city}, ${state}`.toLowerCase().replace(/\s+/g, " ");
  const known = KNOWN_HOMES[key];
  if (!known) return null;
  const needle = `${known.city}, ${state || known.state}`;
  if (!note.toLowerCase().includes(known.city.toLowerCase())) return null;
  if (state && !note.toLowerCase().includes(state.toLowerCase()) && !note.includes(known.state)) return null;
  void needle;
  return { ...known };
}

function asPresence(v: unknown): Presence {
  const s = String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (/not_detected|not_present|negative|absent|undetected|wild_type|^wt$/.test(s)) return "absent";
  if (/present|positive|detected|rearranged/.test(s)) return "present";
  return "unknown";
}

function asBiomarker(raw: unknown): Biomarker {
  if (raw == null || raw === "") return { status: "unknown", variant: null };
  if (typeof raw === "string") {
    const s = raw.trim();
    const status = asPresence(s);
    if (status !== "unknown") return { status, variant: null };
    if (/exon|rearrangement|mutation|L858R|T790M|G12|G13|Q61|deletion|insertion/i.test(s) && !/not\s+detected/i.test(s)) {
      return { status: "present", variant: s };
    }
    return { status: "unknown", variant: null };
  }
  const obj = raw as { status?: string; variant?: string | null };
  const status = asPresence(obj.status);
  const variant = obj.variant && status === "present" ? String(obj.variant).trim() : null;
  return { status, variant: variant || null };
}

/** Nano may return 62, "62", or "62-year-old". */
export function asAge(v: unknown): number | null {
  const n = num(v);
  if (n != null && n >= 18 && n <= 120) return n;
  if (typeof v === "string") {
    const hit = v.match(/(\d{1,3})\s*-?\s*year/);
    if (hit) {
      const age = Number(hit[1]);
      if (age >= 18 && age <= 120) return age;
    }
  }
  return null;
}

function asStage(v: unknown): Stage {
  const ok: Stage[] = ["IIIA", "IIIB", "IIIC", "IVA", "IVB", "IV"];
  if (typeof v === "number" && v === 4) return "IV";
  const text = String(v || "").trim().toUpperCase();
  if (ok.includes(text as Stage)) return text as Stage;
  const hit = text.match(/\b(III[ABC]|IVA|IVB|IV)\b/);
  return hit ? (hit[1] as Stage) : "unknown";
}

function asHistology(v: unknown): Histology {
  const ok: Histology[] = ["adenocarcinoma", "squamous", "large_cell", "nsclc_nos", "other", "unknown"];
  const s = String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_") as Histology;
  if (ok.includes(s)) return s;
  if (s.includes("adenocarcinoma")) return "adenocarcinoma";
  if (s.includes("squamous")) return "squamous";
  return "unknown";
}

function asEcog(v: unknown): FactSheet["ecog"] {
  const n = num(v);
  return n === 0 || n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

function asBrain(v: unknown): BrainMetsStatus {
  const s = String(v || "").trim().toLowerCase();
  const compact = s.replace(/[\s-]+/g, "_");
  if (compact === "none" || compact === "treated_stable" || compact === "untreated") return compact;
  if (/without evidence of metastases|no\s+(?:untreated\s+)?brain metastases|none detected/.test(s)) return "none";
  if (/treated.{0,40}stable|stable.{0,40}treated/.test(s)) return "treated_stable";
  if (/\buntreated\b/.test(s)) return "untreated";
  return "unknown";
}

function asSmoking(v: unknown): FactSheet["smoking"] {
  const s = String(v || "").trim().toLowerCase();
  if (/never[\s_-]*smoker|^never$/.test(s)) return "never";
  if (/former[\s_-]*smoker|^former$/.test(s)) return "former";
  if (/current[\s_-]*smoker|^current$/.test(s)) return "current";
  return "unknown";
}

/**
 * Unit-aware numeric parse for Nano labs: "0.9 mg/dL", "3200/uL", "85 mL/min", "30%".
 * Takes the leading number and ignores a trailing unit.
 */
export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim().replace(/,/g, "");
    const hit = s.match(/^([+-]?\d+(?:\.\d+)?)(?:\s*(?:%|mg\/dL|g\/dL|mL\/min|\/uL|\/µL|U\/L|IU\/L))?\s*$/i)
      || s.match(/^([+-]?\d+(?:\.\d+)?)/);
    if (!hit) return null;
    const n = Number(hit[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Keys Nano may use for a patient name. Never stored, shown, or sent. */
export const PATIENT_NAME_KEYS = ["patient_name", "patientName", "full_name", "fullName", "patient_full_name"];

export function stripPatientNames<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripPatientNames(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (PATIENT_NAME_KEYS.includes(key)) continue;
      out[key] = stripPatientNames(child);
    }
    return out as T;
  }
  return value;
}

export interface NanoExtractResult {
  factSheet: FactSheet;
  excerpts: { fact: string; quote: string }[];
  droppedUnquoted: number;
  inferenceSource: "on-device";
  /** Model JSON as received, before alias unwrap and note fallbacks. Local debug only. */
  rawModel: Record<string, unknown>;
}

export async function extractClinicNoteOnDevice(app: FirebaseApp, note: string): Promise<NanoExtractResult> {
  const trimmed = note.trim();
  if (trimmed.length < 20) {
    throw new Error("Paste a clinic note first. Use a synthetic note in this demo.");
  }
  const model = createChartExtractModel(app, SYSTEM);
  const user = `${SYSTEM}\n\nClinic note (synthetic):\n${trimmed}`;
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: factSheetSchema(),
    },
  } as never);
  const raw = parseModelJson(result.response.text());
  return factSheetFromNanoRaw(raw, trimmed);
}

function firstDefined(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== "") return obj[key];
  }
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const actual = lower.get(key.toLowerCase());
    if (actual && obj[actual] != null && obj[actual] !== "") return obj[actual];
  }
  return undefined;
}

/**
 * Map tumor_genetics.EGFR_exon_19_deletion style keys.
 * labs.egfr is kidney function and must not be passed in here.
 */
export function biomarkersFromTumorGenetics(genetics: unknown, into: Record<string, unknown> = {}): Record<string, unknown> {
  if (!genetics || typeof genetics !== "object" || Array.isArray(genetics)) return into;
  const geneKey = /^(EGFR|ALK|KRAS|ROS1|BRAF)(?:_(.+))?$/i;
  for (const [key, value] of Object.entries(genetics as Record<string, unknown>)) {
    const hit = key.match(geneKey);
    if (!hit) continue;
    const gene = hit[1].toLowerCase();
    const existing = asBiomarker(into[gene]);
    if (existing.status !== "unknown") continue;
    const status = asPresence(value);
    if (status === "unknown") continue;
    const variant = status === "present" && hit[2] ? hit[2].replace(/_/g, " ").trim() : null;
    into[gene] = { status, variant };
  }
  return into;
}

const ORGAN_KEYS: Record<string, string[]> = {
  creatinineMgDl: ["creatinineMgDl", "creatinine_mg_dl", "creatinine", "creat"],
  // egfr inside labs/organFunction is kidney eGFR (mL/min), not the EGFR mutation.
  egfrMlMin: ["egfrMlMin", "egfr_ml_min", "egfr", "eGFR"],
  astUL: ["astUL", "ast_u_l", "ast", "AST"],
  altUL: ["altUL", "alt_u_l", "alt", "ALT"],
  totalBilirubinMgDl: ["totalBilirubinMgDl", "total_bilirubin", "totalBilirubin", "bilirubin"],
  ancPerUl: ["ancPerUl", "anc_per_ul", "anc", "ANC"],
  plateletsPerUl: ["plateletsPerUl", "platelets", "plt"],
  hemoglobinGdl: ["hemoglobinGdl", "hemoglobin", "hgb", "hb"],
};

export function organFunctionFromNano(raw: Record<string, unknown>): FactSheet["organFunction"] {
  const organObj = raw.organFunction && typeof raw.organFunction === "object" && !Array.isArray(raw.organFunction)
    ? (raw.organFunction as Record<string, unknown>)
    : {};
  const labsObj = raw.labs && typeof raw.labs === "object" && !Array.isArray(raw.labs)
    ? (raw.labs as Record<string, unknown>)
    : {};
  // Merge labs under organFunction aliases. organFunction wins on a key conflict.
  const merged: Record<string, unknown> = { ...labsObj, ...organObj };
  return {
    creatinineMgDl: num(firstDefined(merged, ORGAN_KEYS.creatinineMgDl)),
    egfrMlMin: num(firstDefined(merged, ORGAN_KEYS.egfrMlMin)),
    astUL: num(firstDefined(merged, ORGAN_KEYS.astUL)),
    altUL: num(firstDefined(merged, ORGAN_KEYS.altUL)),
    totalBilirubinMgDl: num(firstDefined(merged, ORGAN_KEYS.totalBilirubinMgDl)),
    ancPerUl: num(firstDefined(merged, ORGAN_KEYS.ancPerUl)),
    plateletsPerUl: num(firstDefined(merged, ORGAN_KEYS.plateletsPerUl)),
    hemoglobinGdl: num(firstDefined(merged, ORGAN_KEYS.hemoglobinGdl)),
  };
}

export function unwrapNanoRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const inner = raw.factSheet ?? raw.fact_sheet ?? raw.data ?? raw.result;
  const base: Record<string, unknown> =
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? { ...(inner as Record<string, unknown>), excerpts: raw.excerpts ?? (inner as Record<string, unknown>).excerpts, home: (inner as Record<string, unknown>).home ?? raw.home }
      : { ...raw };
  const aliases: Record<string, string[]> = {
    ageYears: ["ageYears", "age_years", "age", "patient_age", "patientAge"],
    ecog: ["ecog", "ecog_ps", "ecogPS", "ECOG", "performanceStatus", "performance_status", "ecogPerformanceStatus", "ecogStatus"],
    histology: ["histology", "histology_type", "tumor_histology", "histologic_type", "tumorHistology"],
    stage: ["stage", "disease_stage", "tumor_stage", "diseaseStage"],
    smoking: ["smoking", "smoking_status", "smokingStatus", "smoking_history", "smokingHistory"],
    priorSystemicLines: ["priorSystemicLines", "prior_systemic_lines", "priorLines", "prior_lines", "lines_of_therapy", "linesOfTherapy"],
    priorTherapies: ["priorTherapies", "prior_therapies", "priorTherapy", "prior_therapy", "therapies"],
    organFunction: ["organFunction", "organ_function", "labs"],
    brainMets: ["brainMets", "brain_mets", "brain_metastases"],
  };
  for (const [to, keys] of Object.entries(aliases)) {
    if (base[to] == null) {
      const v = firstDefined(base, keys);
      if (v != null) base[to] = v;
    }
  }
  if (base.histology == null && base.diagnosis != null) base.histology = base.diagnosis;
  if (base.stage == null && base.diagnosis != null) base.stage = base.diagnosis;
  const metastases = base.metastases;
  if (base.brainMets == null && metastases && typeof metastases === "object" && !Array.isArray(metastases)) {
    const meta = metastases as Record<string, unknown>;
    const brain = firstDefined(meta, ["brain_metastases", "brainMets", "brain", "cns"]);
    if (typeof brain === "string") base.brainMets = { status: brain, detail: brain };
    else if (brain && typeof brain === "object") base.brainMets = brain;
  }
  const biomarkers: Record<string, unknown> =
    base.biomarkers && typeof base.biomarkers === "object" && !Array.isArray(base.biomarkers)
      ? { ...(base.biomarkers as Record<string, unknown>) }
      : {};
  const biomarkerAliases: Record<string, string[]> = {
    egfr: ["egfr", "egfr_status", "egfrStatus", "EGFR"],
    alk: ["alk", "alk_status", "alkStatus", "ALK"],
    kras: ["kras", "kras_status", "krasStatus", "KRAS"],
    ros1: ["ros1", "ros1_status", "ROS1"],
    braf: ["braf", "braf_status", "BRAF"],
    pdL1TpsPercent: ["pdL1TpsPercent", "pdL1_tps_percent", "pdl1_tps_percent", "pd_l1_tps", "pdL1", "pdl1", "pd_l1", "pdL1Tps"],
  };
  for (const [to, keys] of Object.entries(biomarkerAliases)) {
    if (biomarkers[to] == null) {
      // Never read a bare "egfr" on the root object: that name is ambiguous
      // with kidney eGFR. tumor_genetics and egfr_status are mapped separately.
      const fromRoot = firstDefined(base, keys.filter((k) => k.toLowerCase() !== "egfr"));
      const v = firstDefined(biomarkers, keys) ?? fromRoot;
      if (v != null) biomarkers[to] = v;
    }
  }
  const genetics = firstDefined(base, ["tumor_genetics", "tumorGenetics", "genetics"]);
  biomarkersFromTumorGenetics(genetics, biomarkers);
  if (Object.keys(biomarkers).length) base.biomarkers = biomarkers;
  return base;
}

export function parseModelJson(text: unknown): Record<string, unknown> {
  if (text && typeof text === "object" && !Array.isArray(text)) return unwrapNanoRaw(text as Record<string, unknown>);
  const trimmed = String(text ?? "").trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : trimmed;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return unwrapNanoRaw(parsed as Record<string, unknown>);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return unwrapNanoRaw(parsed as Record<string, unknown>);
    }
  }
  throw new Error("On-device model did not return a JSON fact sheet.");
}

export function factSheetFromNanoRaw(raw: Record<string, unknown>, note: string): NanoExtractResult {
  const rawModel = stripPatientNames(raw && typeof raw === "object" ? (structuredClone(raw) as Record<string, unknown>) : {});
  raw = unwrapNanoRaw(stripPatientNames(raw));
  const rawExcerpts = Array.isArray(raw.excerpts)
    ? (raw.excerpts as Array<{ fact?: string; quote?: string; evidence_quote?: string; evidenceQuote?: string }>)
    : [];
  const excerpts = keepVerbatimExcerpts(rawExcerpts, note);
  const rawExcerptCount = rawExcerpts.filter((ex) => Boolean(excerptQuoteOf(ex) || ex.fact)).length;
  const droppedUnquoted = Math.max(0, rawExcerptCount - excerpts.length);
  const biomarkers = (raw.biomarkers || {}) as Record<string, { status?: string; variant?: string | null }>;
  const brain = (raw.brainMets || {}) as { status?: string; detail?: string };
  const sheet = emptyFactSheet("on_device_model");
  sheet.ageYears = asAge(raw.ageYears);
  const sex = String(raw.sex || "").trim().toLowerCase();
  sheet.sex = sex === "female" || sex === "male" || sex === "other" ? sex : "unknown";
  sheet.stage = asStage(raw.stage);
  sheet.histology = asHistology(raw.histology);
  sheet.ecog = asEcog(raw.ecog);
  sheet.smoking = asSmoking(raw.smoking);
  sheet.biomarkers = {
    egfr: asBiomarker(biomarkers.egfr),
    alk: asBiomarker(biomarkers.alk),
    kras: asBiomarker(biomarkers.kras),
    ros1: asBiomarker(biomarkers.ros1),
    braf: asBiomarker(biomarkers.braf),
    pdL1TpsPercent: num(biomarkers.pdL1TpsPercent),
  };
  sheet.priorSystemicLines = num(raw.priorSystemicLines);
  const priorRaw = raw.priorTherapies ?? raw.prior_therapies;
  sheet.priorTherapies = Array.isArray(priorRaw)
    ? priorRaw.map((t) => String(t).trim()).filter(Boolean)
    : typeof priorRaw === "string"
      ? priorRaw.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
  sheet.brainMets = { status: asBrain(brain.status), detail: brain.detail ? String(brain.detail) : null };
  sheet.organFunction = organFunctionFromNano(raw);
  sheet.home = resolveHome(raw.home as { city?: string; state?: string } | undefined, note);
  sheet.excerpts = excerpts;
  sheet.notes = null;
  fillOmittedFieldsFromNote(sheet, note);
  recoverVerbatimQuotes(sheet, note);
  return { factSheet: sheet, excerpts: sheet.excerpts, droppedUnquoted, inferenceSource: "on-device", rawModel };
}
