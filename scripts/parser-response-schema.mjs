/**
 * Firebase AI Logic response Schema for eligibility-parser output
 * (criterion schema version 1, prompt version 3).
 */
import { Schema } from "firebase/ai";

export const KINDS = [
  "age_min",
  "age_max",
  "ecog_max",
  "stage_in",
  "histology_in",
  "egfr_status",
  "alk_status",
  "kras_status",
  "ros1_status",
  "braf_status",
  "egfr_variant_in",
  "kras_variant_in",
  "pdl1_min",
  "pdl1_max",
  "prior_lines_min",
  "prior_lines_max",
  "prior_therapy_required",
  "prior_therapy_excluded",
  "brain_mets",
  "creatinine_max",
  "egfr_min",
  "anc_min",
  "platelets_min",
  "hemoglobin_min",
  "bilirubin_max",
  "ast_max",
  "alt_max",
];

const STAGES = ["IA", "IB", "IIA", "IIB", "IIIA", "IIIB", "IIIC", "IV", "IVA", "IVB"];
const HISTOLOGIES = ["adenocarcinoma", "squamous", "large_cell", "nsclc_nos"];
const BRAIN = ["none", "treated_stable", "untreated"];
const PRESENCE = ["present", "absent", "unknown"];
const POLARITY = ["inclusion", "exclusion"];

const typedCheckSchema = Schema.object({
  properties: {
    id: Schema.string(),
    kind: Schema.enumString({ enum: KINDS }),
    polarity: Schema.enumString({ enum: POLARITY }),
    sourceText: Schema.string(),
    numberValue: Schema.number(),
    stringValue: Schema.string(),
    presence: Schema.enumString({ enum: PRESENCE }),
    stages: Schema.array({ items: Schema.enumString({ enum: STAGES }) }),
    histologies: Schema.array({ items: Schema.enumString({ enum: HISTOLOGIES }) }),
    allowedBrainMets: Schema.array({ items: Schema.enumString({ enum: BRAIN }) }),
    exceptions: Schema.string(),
  },
  optionalProperties: [
    "numberValue",
    "stringValue",
    "presence",
    "stages",
    "histologies",
    "allowedBrainMets",
    "exceptions",
  ],
});

const fuzzyCriterionSchema = Schema.object({
  properties: {
    id: Schema.string(),
    polarity: Schema.enumString({ enum: POLARITY }),
    sourceText: Schema.string(),
    reasonFuzzy: Schema.string(),
  },
});

export function parserResponseSchema() {
  return Schema.object({
    properties: {
      schemaVersion: Schema.string(),
      nctId: Schema.string(),
      parserModel: Schema.string(),
      promptVersion: Schema.string(),
      typedChecks: Schema.array({ items: typedCheckSchema }),
      fuzzyCriteria: Schema.array({ items: fuzzyCriterionSchema }),
    },
  });
}
