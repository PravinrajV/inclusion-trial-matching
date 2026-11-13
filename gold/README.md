# Gold set for the November 16 accuracy spike

Three synthetic NSCLC personas and 26 eligibility criteria taken from real, regional, recruiting ClinicalTrials.gov records pulled on November 11, 2026. The patient stories are made up. Do not treat them as real people, and do not put real medical records in this folder.

The criteria `sourceText` values are quoted or lightly trimmed from the public eligibility text of the cited NCT IDs. Attribute those trial records to ClinicalTrials.gov. See `notes/ctgov-terms.md` and `data/ctgov/counts.md`.

How we will score, once Nano is running on THINK:

- Extraction: for each persona, run the on-device structured-output prompt on the clinic note (text only) and compare the fact sheet to `personas.json`. Count age, ECOG, stage, histology, EGFR, ALK, KRAS, PD-L1, prior lines, prior drugs, and brain mets separately.
- Judgment: for each of the 26 criteria, apply the typed matcher when `kind` is typed; for `fuzzy` items, run one on-device prompt per criterion. Compare to `expected` in `criteria.json`. `unknown` is a valid gold answer when the note does not say.

If too many results come back `unknown` or wrong, we will move more rules into typed checks, or stop, per the November 16 kill check.
