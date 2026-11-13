import type { BrainMetsStatus, Histology, Presence, Stage } from "./fact-sheet";

export const CRITERIA_CACHE_SCHEMA_VERSION = "1" as const;

export type Judgment = "met" | "not_met" | "unknown";
export type Polarity = "inclusion" | "exclusion";

export type TypedKind =
  | "age_min"
  | "age_max"
  | "ecog_max"
  | "stage_in"
  | "histology_in"
  | "egfr_status"
  | "alk_status"
  | "kras_status"
  | "ros1_status"
  | "braf_status"
  | "egfr_variant_in"
  | "kras_variant_in"
  | "pdl1_min"
  | "pdl1_max"
  | "prior_lines_min"
  | "prior_lines_max"
  | "prior_therapy_required"
  | "prior_therapy_excluded"
  | "brain_mets"
  | "creatinine_max"
  | "egfr_min"
  | "anc_min"
  | "platelets_min"
  | "hemoglobin_min"
  | "bilirubin_max"
  | "ast_max"
  | "alt_max";

export interface TypedCheck {
  id: string;
  kind: TypedKind;
  polarity: Polarity;
  sourceText: string;
  /** Verbatim substring of the eligibility text that supports this check. */
  evidence_quote?: string;
  section?: "inclusion" | "exclusion";
  numberValue?: number;
  stringValue?: string;
  stages?: Stage[];
  histologies?: Histology[];
  presence?: Presence;
  allowedBrainMets?: BrainMetsStatus[];
  /** Optional note for an unless/OR/start-window clause. The typed check still stands. */
  exceptions?: string;
}

export interface FuzzyCriterion {
  id: string;
  polarity: Polarity;
  sourceText: string;
  reasonFuzzy: string;
}

export interface ParsedTrial {
  schemaVersion: typeof CRITERIA_CACHE_SCHEMA_VERSION;
  nctId: string;
  parsedAt: string;
  parserModel: string;
  promptVersion: string;
  typedChecks: TypedCheck[];
  fuzzyCriteria: FuzzyCriterion[];
}
