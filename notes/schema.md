# Typed-check schema, version 1

The cloud parser's job is to turn public eligibility text into small, typed checks plus leftover fuzzy criteria. The on-device matcher applies the typed checks deterministically. Fuzzy leftover items go to Gemini Nano, one at a time, only on the device, and only after a November 16 accuracy spike.

Writes to the cache are once per `schemaVersion`. Only a server-side Cloud Function or an admin script may write. Clients may read.

## Fact sheet (private, on-device only)

See `src/schema/fact-sheet.ts`. Fields we treat as typed:

- Age in years
- ECOG 0 to 4
- Stage: IIIA, IIIB, IIIC, IV, IVA, IVB, or unknown. Scope is stage III/IV NSCLC only.
- Histology: adenocarcinoma, squamous, large cell, NSCLC NOS, other, unknown
- EGFR, ALK, KRAS, ROS1, BRAF: present / absent / unknown, plus a free-text variant (for example "exon 19 deletion" or "G12C")
- PD-L1 TPS, 0 to 100
- Prior lines of systemic therapy, and a list of prior therapy names
- Brain metastases: none, treated_stable, untreated, unknown
- Organ function: creatinine (mg/dL), eGFR (mL/min), AST, ALT, total bilirubin, ANC, platelets, hemoglobin
- Smoking status (used later if a criterion is clearly typed; otherwise fuzzy)

Home city and coordinates stay on the device. They are used only for the local distance filter.

## Typed checks

See `src/schema/criterion.ts`. Each check has a polarity of `inclusion` or `exclusion`, the source sentence from the trial record, and one of these kinds:

`age_min`, `age_max`, `ecog_max`, `stage_in`, `histology_in`, `egfr_status`, `alk_status`, `kras_status`, `ros1_status`, `braf_status`, `egfr_variant_in`, `kras_variant_in`, `pdl1_min`, `pdl1_max`, `prior_lines_min`, `prior_lines_max`, `prior_therapy_required`, `prior_therapy_excluded`, `brain_mets`, `creatinine_max`, `egfr_min`, `anc_min`, `platelets_min`, `hemoglobin_min`, `bilirubin_max`, `ast_max`, `alt_max`.

If a criterion does not fit one of those kinds cleanly (washout windows, "measurable disease by RECIST," "willing to undergo a fresh biopsy," "life expectancy of at least 12 weeks," "no active autoimmune disease," and so on), it stays in `fuzzyCriteria` with a short reason. The November 16 spike will measure Nano on those and, if it is weak, we will promote more of them into typed checks or leave them as "unknown, ask your oncologist."

Typed checks may include an optional `exceptions` string. Use it when the source has an "unless" clause, a short start-window, or an OR alternative (for example serum creatinine within normal limits OR creatinine clearance above a cutoff). The typed check is still emitted so the on-device matcher can apply the main rule; the exception is a note, not a reason to drop the check into `fuzzyCriteria`.

`egfr_min` is kidney function (creatinine clearance or eGFR in mL/min), not the EGFR gene.

Brain metastases have two wording forms that the matcher treats as complements, and that post-processing canonicalizes: "must not have untreated CNS metastases" is `inclusion` with `allowedBrainMets` of `none` and `treated_stable`; "known active CNS metastases" as an exclusion is `exclusion` with `allowedBrainMets` of `untreated`. An example-variant list (for example "e.g. but not limited to exon 19 deletion, L858R") is `egfr_variant_in` or `kras_variant_in`, not only a presence status check.

Deterministic post-processing in `scripts/lib/postprocess-parse.mjs` applies those repairs to model output using the public eligibility text only.

## Judgments

Every check resolves to `met`, `not_met`, or `unknown`. Missing data is `unknown`, never a silent fail. Copy in the UI is always "possible match, discuss with your care team," never "you qualify."
