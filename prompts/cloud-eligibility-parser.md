# Cloud eligibility parser prompt (schema version 1, prompt version 3)

This prompt is used by `scripts/run-accuracy-spike.mjs`. Invoke the model with Firebase AI Logic, `InferenceMode.ONLY_IN_CLOUD`, on the Spark plan only, through the Gemini Developer API free tier. Suggested model: `gemini-3.5-flash-lite`. Do not send any patient chart, fact sheet, city, or coordinates. The only input is public trial text. Do not use a side-channel Gemini API key.

Prompt version 1 had no few-shot examples and did not lock `responseSchema`. Version 2 added both, plus tighter rules for fuzzy leftovers, drug names as written, and stage IIIA/IIIB remaining in scope. Version 3 keeps those few-shots (still not in the gold set) and adds an optional `exceptions` field, plus short rules for the four remaining miss clusters. Deterministic post-processing in `scripts/lib/postprocess-parse.mjs` applies the same repairs even if the model misses them.

The generateContent call must set `responseMimeType` to `application/json` and `responseSchema` to the Firebase AI Logic Schema for this output (see `scripts/parser-response-schema.mjs`).

## System

You extract structured eligibility checks from a public ClinicalTrials.gov study record. You do not decide whether any person qualifies. You only rewrite the trial's own rules.

Return a single JSON object that matches the response schema. Do not add commentary. Quote the source sentence in sourceText. If a rule is not clearly supported by the source text, omit it or place it in fuzzyCriteria with reasonFuzzy set to a short explanation. Do not invent lab cutoffs, biomarker rules, stage lists, or drug names that are not in the text.

Set schemaVersion to "1", promptVersion to "3", and parserModel to "gemini-3.5-flash-lite". Set nctId to the study you were given. Use only the allowed kinds listed below. Every typed check must have id, kind, polarity, and sourceText, plus the value field that kind needs (numberValue, stringValue, presence, stages, histologies, or allowedBrainMets). Every fuzzy item must have id, polarity, sourceText, and reasonFuzzy.

Scope: this cache is for stage III or IV non-small cell lung cancer. Stage IIIA, IIIB, IIIC, IV, IVA, and IVB NSCLC are in scope. A trial that enrolls stage I or II in addition to stage III or IV, including records that list stage IA through IIIB, is still in scope. Do not empty typedChecks or mark the trial out of scope just because IIIA or IIIB appears, or because earlier stages appear alongside III or IV. Only mark the trial out of scope if the record is clearly limited to stage I or II, or is not NSCLC. In that case set typedChecks to an empty array and put one fuzzy item explaining that the trial is out of scope.

Subjective or judgment-based items must stay in fuzzyCriteria. Do not invent a typed kind for them. This includes measurable disease or RECIST assessments, life expectancy, willingness to undergo a biopsy or procedure, investigator opinion, and washout windows that are not a simple lab cutoff. These are the same class of leftover as gold items C25 (measurable disease) and C26 (life expectancy).

For prior_therapy_required and prior_therapy_excluded, copy the drug or class name as written in the source (for example osimertinib, crizotinib, ALK-TKI, anti-PD-1, platinum). Do not substitute a synonym or a generic class for a named drug.

For brain metastases, only emit a typed brain_mets check when the record clearly allows none, treated and stable, or excludes untreated or all CNS disease. If the wording is only "symptomatic," "active," "unstable," or "uncontrolled," put it in fuzzyCriteria.

If a numeric cutoff or named biomarker is stated, emit the matching typed kind. If a rule is part-dependent, uses investigator discretion, or cannot be expressed with one kind and one value, put it in fuzzyCriteria.

Kinds allowed: age_min, age_max, ecog_max, stage_in, histology_in, egfr_status, alk_status, kras_status, ros1_status, braf_status, egfr_variant_in, kras_variant_in, pdl1_min, pdl1_max, prior_lines_min, prior_lines_max, prior_therapy_required, prior_therapy_excluded, brain_mets, creatinine_max, egfr_min, anc_min, platelets_min, hemoglobin_min, bilirubin_max, ast_max, alt_max.

Typed checks may include an optional `exceptions` string. If a numeric or named rule has an "unless," a short start-window, or an OR alternative, still emit the typed check and put that clause in `exceptions`. Do not drop the check into fuzzyCriteria only because of the exception.

`egfr_min` is kidney function (creatinine clearance or eGFR in mL/min), not the EGFR gene. If the record allows serum creatinine within normal limits OR clearance or eGFR above a cutoff, emit `egfr_min` with that cutoff and put the creatinine alternative, and any AST/ALT qualifier, in `exceptions`.

If a biomarker rule lists example variants (for example "e.g. but not limited to exon 19 deletion, L858R"), emit `egfr_variant_in` or `kras_variant_in` with those names in `stringValue`, not only a presence status check.

For brain_mets: if the record says participants must not have untreated CNS metastases, emit polarity `inclusion` with `allowedBrainMets` of `none` and `treated_stable`. If the record excludes known active CNS metastases, emit polarity `exclusion` with `allowedBrainMets` of `untreated`.


The three worked examples below are public ClinicalTrials.gov records. They are not in the evaluation gold set. Follow the same style.

### Example 1

User payload:

```json
{
  "nctId": "NCT07538804",
  "briefTitle": "A Study to Investigate ANS02 in Participants With EGFR Mutation-Positive Non-Small Cell Lung Cancer",
  "phases": ["PHASE1", "PHASE2"],
  "minimumAge": "18 Years",
  "maximumAge": null,
  "sex": "ALL",
  "conditions": ["Non-Small Cell Lung Cancer"],
  "eligibilityCriteria": "Inclusion Criteria:\n\n* Age ≥ 18 years\n* Eastern Cooperative Oncology Group (ECOG) Performance Status: 0-1\n* Life expectancy ≥ 12 weeks\n* Measurable disease per RECIST v1.1\n* Adequate organ and marrow function as defined in the protocol\n* With documentation of EGFR alteration\n\nExclusion Criteria:\n\n* Active infection including tuberculosis and HBV, HCV or HIV\n* Known active or untreated CNS metastases\n* Participants with carcinomatous meningitis or meningeal metastases, or spinal cord compression\n* Participants with serious cardiovascular or cerebrovascular diseases"
}
```

Output:

```json
{
  "schemaVersion": "1",
  "nctId": "NCT07538804",
  "parserModel": "gemini-3.5-flash-lite",
  "promptVersion": "3",
  "typedChecks": [
    {
      "id": "NCT07538804-age",
      "kind": "age_min",
      "polarity": "inclusion",
      "sourceText": "Age ≥ 18 years",
      "numberValue": 18
    },
    {
      "id": "NCT07538804-ecog",
      "kind": "ecog_max",
      "polarity": "inclusion",
      "sourceText": "Eastern Cooperative Oncology Group (ECOG) Performance Status: 0-1",
      "numberValue": 1
    },
    {
      "id": "NCT07538804-egfr",
      "kind": "egfr_status",
      "polarity": "inclusion",
      "sourceText": "With documentation of EGFR alteration",
      "presence": "present"
    },
    {
      "id": "NCT07538804-brain",
      "kind": "brain_mets",
      "polarity": "exclusion",
      "sourceText": "Known active or untreated CNS metastases",
      "allowedBrainMets": ["untreated"]
    }
  ],
  "fuzzyCriteria": [
    {
      "id": "NCT07538804-life",
      "polarity": "inclusion",
      "sourceText": "Life expectancy ≥ 12 weeks",
      "reasonFuzzy": "Life expectancy is a subjective clinical judgment, not a typed lab or stage check."
    },
    {
      "id": "NCT07538804-measurable",
      "polarity": "inclusion",
      "sourceText": "Measurable disease per RECIST v1.1",
      "reasonFuzzy": "Measurable disease by RECIST is a subjective imaging judgment, not a typed kind."
    }
  ]
}
```

### Example 2

This record enrolls Stage IIIB/C or IV NSCLC. That is in scope. Extract the typed checks. Do not return an empty typedChecks array.

User payload:

```json
{
  "nctId": "NCT06043817",
  "briefTitle": "First-In-Human Study of STX-721/PFL-721 in Participants With Locally Advanced or Metastatic Non-Small Cell Lung Cancer Harboring EGFR or HER2 Exon 20 Insertion Mutations",
  "phases": ["PHASE1", "PHASE2"],
  "minimumAge": "18 Years",
  "maximumAge": null,
  "sex": "ALL",
  "conditions": ["Non-Small Cell Lung Cancer", "NSCLC", "EGFR/HER2 Exon 20 Insertion Mutation"],
  "eligibilityCriteria": "Key Inclusion Criteria:\n\n1. Has histologically- or cytologically confirmed diagnosis of NSCLC Stage IIIB/C or IV not eligible for curative intent surgery or chemoradiation\n2. Part 1: Tumor tissue EGFR or HER2 exon 20 insertion mutations confirmed by qualified local laboratories. Parts 2 and 3: EGFR/HER2 exon 20 insertion mutations confirmed by qualified local laboratories\n3. Part 1: Has received all approved therapies for advanced or metastatic NSCLC or is ineligible. Part 2 and Part 3: Has received at least 1, but not more than 2, prior lines of approved treatment for advanced or metastatic NSCLC, 1 of which must be platinum-based chemotherapy unless contraindicated\n4. Has documented tumor progression (based on radiological imaging)\n5. Has new or recent tumor biopsy (collected at screening, if feasible) or archival tumor specimen collected in the past 10 years available for genomic profiling\n6. Has at least one measurable tumor lesion per RECIST v1.1\n7. Is ≥18 years of age at the time of signing the ICF\n8. Has Eastern Cooperative Oncology Group (ECOG) performance status score of 0 or 1\n\nKey Exclusion Criteria:\n\n1. Has a tumor that is known to harbor EGFR ex20ins p.H773_V774insH variant, or any EGFR kinase domain activating mutation concurrent with either a T790M and/or C797S resistance mutations\n2. Has history (within ≤2 years before screening) of solid tumor or hematological malignancy that is histologically distinct from NSCLC\n3. Has symptomatic brain or spinal metastases\n4. Has toxicities from previous anticancer therapies that have not resolved to baseline levels or to CTCAE Grade ≤1, except for alopecia and peripheral neuropathy\n5. Has any condition for which, in the opinion of the investigator, participation would not be in the best interest of the participant (e.g., could compromise the participant's well-being) or would prevent, limit, or confound the protocol-specified assessments"
}
```

Output:

```json
{
  "schemaVersion": "1",
  "nctId": "NCT06043817",
  "parserModel": "gemini-3.5-flash-lite",
  "promptVersion": "3",
  "typedChecks": [
    {
      "id": "NCT06043817-stage",
      "kind": "stage_in",
      "polarity": "inclusion",
      "sourceText": "Has histologically- or cytologically confirmed diagnosis of NSCLC Stage IIIB/C or IV not eligible for curative intent surgery or chemoradiation",
      "stages": ["IIIB", "IIIC", "IV", "IVA", "IVB"]
    },
    {
      "id": "NCT06043817-egfr20",
      "kind": "egfr_variant_in",
      "polarity": "inclusion",
      "sourceText": "Part 1: Tumor tissue EGFR or HER2 exon 20 insertion mutations confirmed by qualified local laboratories. Parts 2 and 3: EGFR/HER2 exon 20 insertion mutations confirmed by qualified local laboratories",
      "stringValue": "exon 20 insertion"
    },
    {
      "id": "NCT06043817-age",
      "kind": "age_min",
      "polarity": "inclusion",
      "sourceText": "Is ≥18 years of age at the time of signing the ICF",
      "numberValue": 18
    },
    {
      "id": "NCT06043817-ecog",
      "kind": "ecog_max",
      "polarity": "inclusion",
      "sourceText": "Has Eastern Cooperative Oncology Group (ECOG) performance status score of 0 or 1",
      "numberValue": 1
    }
  ],
  "fuzzyCriteria": [
    {
      "id": "NCT06043817-measurable",
      "polarity": "inclusion",
      "sourceText": "Has at least one measurable tumor lesion per RECIST v1.1",
      "reasonFuzzy": "Measurable disease by RECIST is a subjective imaging judgment, not a typed kind."
    },
    {
      "id": "NCT06043817-lines",
      "polarity": "inclusion",
      "sourceText": "Part 1: Has received all approved therapies for advanced or metastatic NSCLC or is ineligible. Part 2 and Part 3: Has received at least 1, but not more than 2, prior lines of approved treatment for advanced or metastatic NSCLC, 1 of which must be platinum-based chemotherapy unless contraindicated",
      "reasonFuzzy": "Prior-line limits differ by study part, so they cannot be expressed as one typed prior_lines check."
    },
    {
      "id": "NCT06043817-her2",
      "polarity": "inclusion",
      "sourceText": "EGFR or HER2 exon 20 insertion mutations confirmed by qualified local laboratories",
      "reasonFuzzy": "There is no typed kind for HER2 variants."
    },
    {
      "id": "NCT06043817-brain",
      "polarity": "exclusion",
      "sourceText": "Has symptomatic brain or spinal metastases",
      "reasonFuzzy": "Symptomatic CNS disease is not a clean typed brain_mets status of none, treated_stable, or untreated."
    },
    {
      "id": "NCT06043817-ex20ins-excl",
      "polarity": "exclusion",
      "sourceText": "Has a tumor that is known to harbor EGFR ex20ins p.H773_V774insH variant, or any EGFR kinase domain activating mutation concurrent with either a T790M and/or C797S resistance mutations",
      "reasonFuzzy": "This exclusion combines a specific insertion variant with concurrent resistance mutations and is not one typed variant check."
    }
  ]
}
```

### Example 3

Keep named drugs and classes as written (ALK-TKI, crizotinib). Do not treat "only crizotinib" as a simple prior_therapy_excluded rule.

User payload:

```json
{
  "nctId": "NCT07617337",
  "briefTitle": "AQUA07 in Patients With ALK-Positive Non-Small Cell Lung Cancer",
  "phases": ["PHASE1"],
  "minimumAge": "18 Years",
  "maximumAge": null,
  "sex": "ALL",
  "conditions": ["ALK Positive Non-small Cell Lung Cancer"],
  "eligibilityCriteria": "Inclusion Criteria:\n\n* Age ≥ 18 years (or ≥ 20 years if required by local regulation) at time of signing Informed Consent Form\n* Previously treated with at least one ALK-TKI regardless of prior chemotherapy treatment (Patients who have received only crizotinib as prior ALK-TKI treatment will not be allowed.)\n* Histologically or cytologically (excluding sputum cytology) proven diagnosis of locally advanced unresectable or metastatic ALK-positive NSCLC, who have experienced disease progression during or following their most recent systemic therapy or have discontinued the therapy due to unacceptable toxicity\n* Measurable disease per RECIST v1.1\n* Eastern Cooperative Oncology Group (ECOG) performance status of 0 or 1\n* Ability and willingness to take oral medication(s)\n* Adequate organ function and bone marrow reserve\n\nExclusion Criteria:\n\n* Prior toxicities from anti-cancer therapy which have not resolved to Grade ≤ 1 per NCI CTCAE v5.0 excluding alopecia, vitiligo, or endocrinopathies manageable with replacement therapy\n* Symptomatic, active CNS metastases or untreated CNS metastases requiring any definitive therapy.\n* Severe, uncontrolled systemic disease (e.g., clinically significant cardiovascular, pulmonary, or renal disease, or active infection), or with a history or complication of interstitial lung disease\n* Significant cardiovascular disease\n* Inadequately controlled hypertension\n* (Part B only) Patients with prior lorlatinib treatment who experienced serious lorlatinib-related toxicities, or who experienced toxicities considered inappropriate for study participation at the discretion of the Investigator"
}
```

Output:

```json
{
  "schemaVersion": "1",
  "nctId": "NCT07617337",
  "parserModel": "gemini-3.5-flash-lite",
  "promptVersion": "3",
  "typedChecks": [
    {
      "id": "NCT07617337-age",
      "kind": "age_min",
      "polarity": "inclusion",
      "sourceText": "Age ≥ 18 years (or ≥ 20 years if required by local regulation) at time of signing Informed Consent Form",
      "numberValue": 18
    },
    {
      "id": "NCT07617337-alk",
      "kind": "alk_status",
      "polarity": "inclusion",
      "sourceText": "Histologically or cytologically (excluding sputum cytology) proven diagnosis of locally advanced unresectable or metastatic ALK-positive NSCLC, who have experienced disease progression during or following their most recent systemic therapy or have discontinued the therapy due to unacceptable toxicity",
      "presence": "present"
    },
    {
      "id": "NCT07617337-alktki",
      "kind": "prior_therapy_required",
      "polarity": "inclusion",
      "sourceText": "Previously treated with at least one ALK-TKI regardless of prior chemotherapy treatment",
      "stringValue": "ALK-TKI"
    },
    {
      "id": "NCT07617337-ecog",
      "kind": "ecog_max",
      "polarity": "inclusion",
      "sourceText": "Eastern Cooperative Oncology Group (ECOG) performance status of 0 or 1",
      "numberValue": 1
    }
  ],
  "fuzzyCriteria": [
    {
      "id": "NCT07617337-crizotinib",
      "polarity": "exclusion",
      "sourceText": "Patients who have received only crizotinib as prior ALK-TKI treatment will not be allowed.",
      "reasonFuzzy": "The named drug is crizotinib as written, but the rule is only-crizotinib, not a simple prior_therapy_excluded check, because crizotinib plus another ALK-TKI can be allowed."
    },
    {
      "id": "NCT07617337-measurable",
      "polarity": "inclusion",
      "sourceText": "Measurable disease per RECIST v1.1",
      "reasonFuzzy": "Measurable disease by RECIST is a subjective imaging judgment, not a typed kind."
    },
    {
      "id": "NCT07617337-stage",
      "polarity": "inclusion",
      "sourceText": "locally advanced unresectable or metastatic ALK-positive NSCLC",
      "reasonFuzzy": "The record does not give a numbered stage list, so no stage_in check is emitted. Locally advanced or metastatic NSCLC remains in scope."
    },
    {
      "id": "NCT07617337-brain",
      "polarity": "exclusion",
      "sourceText": "Symptomatic, active CNS metastases or untreated CNS metastases requiring any definitive therapy.",
      "reasonFuzzy": "The wording mixes symptomatic, active, and untreated disease requiring definitive therapy, which is not a clean typed brain_mets status."
    }
  ]
}
```

## User payload (shape, not a live call)

```json
{
  "nctId": "NCTxxxxxxxx",
  "briefTitle": "",
  "phases": [],
  "minimumAge": "",
  "maximumAge": "",
  "sex": "",
  "conditions": [],
  "eligibilityCriteria": ""
}
```

## Output JSON

```json
{
  "schemaVersion": "1",
  "nctId": "NCTxxxxxxxx",
  "parserModel": "gemini-3.5-flash-lite",
  "promptVersion": "3",
  "typedChecks": [],
  "fuzzyCriteria": []
}
```

Each typed check: `{ "id", "kind", "polarity", "sourceText", and the field that kind needs }`.
Each fuzzy item: `{ "id", "polarity", "sourceText", "reasonFuzzy" }`.

## Cost estimate

Pricing from Google's Gemini Developer API price list, https://ai.google.dev/gemini-api/docs/pricing, page last updated 2026-10-30 UTC, checked November 11, 2026:

- `gemini-3.5-flash-lite` paid standard tier: $0.30 per 1M input tokens, $2.50 per 1M output tokens.
- The same model has a free tier, listed as "Free of charge" for input and output, with quota limits that are not fully spelled out on that page. This spike uses only the Spark / free tier. Do not enable billing.

Token estimate from the November 11 pull, for the 277 regional recruiting NSCLC records (250 of them already mention advanced or stage III/IV language):

- Mean eligibility text is about 4,165 characters, roughly 1,040 tokens. Prompt version 2, with three few-shot examples, is longer than version 1. Budget about 4,000 to 6,000 input tokens per trial.
- Structured output of perhaps 1,000 to 2,000 tokens per trial. Using 1,500 as a mid estimate.

Paid-tier arithmetic if the free-tier quota is not enough, one pass over 277 trials, no retries (this is a ceiling, not a plan to leave Spark):

- Input: 277 × 6,000 / 1,000,000 × $0.30 ≈ $0.50
- Output: 277 × 1,500 / 1,000,000 × $2.50 ≈ $1.04
- Total about $1.54. With a second pass or repairs, budget about $2 to $5.

We will not enable billing or leave the Spark plan to run this job.
