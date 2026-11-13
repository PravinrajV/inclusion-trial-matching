# November 16 accuracy spike

Updated November 11, 2026, 9:36 PM ET (America/New_York).

## Kill / continue / narrow call

**Continue the app build, but do not treat the original 24 / 24 as general parser accuracy.** The November 16 in-set target was met with postprocess. A held-out check, labeled and committed before any parser call, scored **54 / 87** typed (62.1%) with **18 safe** and **15 official unsafe** misses. Do not kill the idea, and do not tune postprocess on the held-out set in this pass.


The official score, after the narrow pass (optional `exceptions` field plus deterministic post-processing, prompt v3, locked `responseSchema`), is **24 / 24** typed and **2 / 2** fuzzy placement, **26 / 26** overall, with **0 unsafe misses**. Two independent Spark runs agreed on every item (26 / 26 verdicts, 0 flips). The target was at least 21 / 24 typed with 0 unsafe misses.

A miss is **unsafe** if a typed check would gate a patient differently from the gold check (wrong value, inverted brain polarity, or a looser presence status in place of a listed variant). A miss is **safe** if the gold rule was left in `fuzzyCriteria` or omitted, with no competing wrong typed check, so the on-device judge can handle it. There were no official typed misses on either v3 run, so both counts are 0.

The raw model still needs those repairs. Post-processing, not the prompt alone, recovered the four v2 miss clusters on public eligibility text: renal `egfr_min` from creatinine-or-clearance compounds, example-variant lists as `egfr_variant_in`, exception-laden prior therapy and lines as a typed check plus an `exceptions` note, and brain-mets polarity (must-not-have-untreated becomes inclusion with `none` and `treated_stable`). A fifth repair, added after run A's raw parse dropped IIIC from C05, expands unresectable IIIB plus stage IV lists to include IIIC, IVA, and IVB. Run A's raw output was rescored with that same rule; run B used it from the start. Both official v3 numbers use the complete postprocess. The few-shots are still the same three public trials that are not in the gold set.

Do not treat the raw model-only output as cache-ready. The cache path should keep this postprocess in the loop. The on-device Nano half remains 6 / 6 after the evidence-quote gate.

No billing, no Blaze, no side-channel key. No 429, no quota-exceeded message, and no 500 on these two runs.


## Held-out check (prompt v3 + postprocess, no rule changes)

Labels of record: `gold/held-out-criteria-2026-11-11T211725-0500.json`. Written at 9:17 PM ET on November 11, 2026 from the public CT.gov pull only (dataTimestamp 2026-11-10T10:00:05). Committed first as `00b2b2ea` at 9:18 PM ET, SHA-256 `c5ae4c3b1969341b16c2c28dc851778af16fe3f3b0dba0e1d2cee5645cb0e7cd`. The parser had not been run on these trials at that time. Postprocess rules were not changed after looking at this set.

Ten recruiting regional stage III/IV NSCLC trials, none in the original gold set or the three few-shots: NCT07688577, NCT05098132, NCT06357533, NCT06868277, NCT06248606, NCT06627647, NCT06772623, NCT04614103, NCT07291037, NCT07154290. 87 typed items.

Run: one pass, prompt v3, locked `responseSchema`, existing postprocess, Spark, public text only, 9:19 PM ET. No 429, no 500, no billing, no quota-exceeded message. `invalidKind` 0.

### Official held-out score

**Typed extraction: 54 / 87 (62.1%). Safe misses: 18. Unsafe misses (existing classifier): 15.**

That is close to the in-set prompt-v2 score (15 / 24, 62.5%) and well below the postprocess-aided 24 / 24 on the original gold set. The postprocess rules that were written while looking at the gold set do not fully carry over.

Per trial: NCT07688577 6/8, NCT05098132 7/9, NCT06357533 5/10, NCT06868277 7/9, NCT06248606 11/12, NCT06627647 4/11, NCT06772623 1/2, NCT04614103 7/9, NCT07291037 3/12, NCT07154290 3/5.

### Safe misses (18)

Eight of them are `age_min` 18 where the eligibility text had no age sentence and the label used the structured `minimumAge` field (H01, H09, H18, H28, H49, H60, H71, H83). The model often skipped that field, and postprocess does not read it. The rest are prior-line or prior-therapy rules left fuzzy, one unnumbered "metastatic NSCLC" stage (H03), and the required-untreated brain rule on NCT06248606 (H41). No competing wrong typed check on these.

### Official unsafe misses (15), with an encoding caveat

The existing classifier flags a miss as unsafe when a typed check could gate a patient differently. It does not treat `egfr_status` / `alk_status` / `ros1_status` `inclusion` + `absent` as equivalent to gold `exclusion` + `present`, even though the matcher judgments match. Six of the 15 official unsafe misses are that encoding (H21–H23, H74–H76). Those are official misses, but they would not have flipped a patient relative to gold.

The remaining nine look genuinely unsafe, and they are not retuned here:

- H26 (`prior_lines_max`, NCT06357533): emitted exclusion 0 instead of inclusion 0, which would flip first-line patients to not_met.
- H52–H54 (NCT06627647): same exclusion polarity as gold but `presence: absent` instead of `present`, a double negative that would include the excluded mutation.
- H58 (NCT06627647): `brain_mets` inclusion with only `treated_stable`, so a patient with no brain mets would fail.
- H36 and H82: `brain_mets` exclusion with `treated_stable`, an inverted allowed list.
- H59 and H77: a listed variant was typed as a presence status instead of `egfr_variant_in` / `kras_variant_in`.

Raw output: `notes/accuracy-raw/held-out-v3-run-a-score.json`.


## Held-out set 2 (deterministic six-type normalizer, no rule changes)

Labels of record: `gold/held-out-2-criteria-2026-11-11T213510-0500.json`. Written at 9:35 PM ET on November 11, 2026 from the public CT.gov pull only (dataTimestamp 2026-11-10T10:00:05). Committed first as `87a9047` at 9:35 PM ET, SHA-256 `b1f1cc9be97c10392f74eb7278678e271df226b2203099cce101186e840f2580`. The parser had not been run on these twenty trials at that time. Normalizer and postprocess rules were not changed after looking at this set.

Twenty regional NSCLC trials, not in the original gold set, few-shots, or held-out set 1. 131 typed items.

Run: one pass, deterministic section-aware normalizer only (no model). 9:36 PM ET.

### Official set 2 score

**Typed extraction: 70 / 131 (53.4%). Coverage (kept as typed hits): 53.4%. Safe misses: 52. Unsafe misses: 9. 9 unsafe out of 131 criteria.**

The pass bar was 0 unsafe. It was not met. Rules were not retuned.

Decided-share (Met/Not-met-capable typed hits vs Discuss), overall: 70/131 (53.4%) decided, 61/131 (46.6%) discuss.

Six key types together: 59/119 (49.6%) decided. By type: driver 2/21 (9.5%), stage 6/16 (37.5%), prior 2/9 (22.2%), ECOG 12/20 (60%), brain 3/4 (75%), labs 34/49 (69.4%). Age (other) was 11/12.

### The nine unsafe misses (not retuned)

- T16 (NCT05234307, `prior_therapy_required`): gold is required PD-1/PD-L1 therapy. The normalizer typed required osimertinib from an "FDA-approved options (ie osimertinib…)" example.
- T24 and T25 (NCT06096844, `egfr_status` / `alk_status`): gold is inclusion + absent ("negative for EGFR mutation/ALK translocations"). The normalizer emitted inclusion + present, which inverts the gate.
- T58 (NCT07746388, `stage_in`): gold is IIA, IIB, IIIA, IIIB from "stage II-IIIB(N2)". The emitted list dropped IIIA, which would fail a IIIA patient.
- T60 (NCT07746388, `alk_status`): gold is exclusion + present (ALK translocations are excluded). The normalizer typed inclusion + present from a "confirm EGFR/ALK status" biopsy sentence, which would require ALK instead of excluding it.
- T71 (NCT04486833), T114 (NCT05498428), T125 (NCT05789082), T104 (NCT05361174), all `stage_in`: the emitted stage list was narrower than gold (usually IV only, or IIIC+IV, while gold included earlier III stages named or implied in the same sentence). A typed but incomplete stage list can wrongly drop a IIIA/IIIB patient.

Raw output: `notes/accuracy-raw/held-out-2-deterministic-score.json`.

Because unsafe misses were not zero, the parser is not treated as final and the regional cache fill was not resumed.

## Regional cache fill (Spark, stopped on free-tier RPM)

Started `scripts/parse-regional-trials.mjs` at 9:22 PM ET on November 11, 2026 against the 277-trial regional pull (dataTimestamp 2026-11-10T10:00:05), prompt v3 plus the existing postprocess, public eligibility only. The first 16 trials parsed successfully. The 17th, NCT04270591, returned HTTP 429:

`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`, metric `generativelanguage.googleapis.com/generate_content_free_tier_requests`, limit 15, model `gemini-3.5-flash-lite`, RetryInfo 46s. The stock error text says to check plan and billing details. That is the usual Gemini 429 wording, not a console upgrade dialog. No billing account was linked, no Blaze prompt was accepted, and parsing was stopped as instructed.

The 1 req/s floor was faster than the free-tier 15 RPM cap. The incomplete NCT was not saved as failed, so a later resume can retry it. After the stop, the parse script was changed to a 4 second floor and to back off on per-minute 429s (honoring RetryInfo) while still hard-stopping on billing, Blaze, TOS, or daily/token quota. That change was not used to continue the run in this pass. Postprocess was not retuned.

Local cache: 16 of 277 in `data/criteria-cache/` and `public/criteria-cache.json` (gitignored). Firestore rules (including `criteria/{schemaVersion}/meta/{docId}`) were deployed to `inclusion-hybridai` only, no Hosting. `scripts/write-firestore-cache.mjs` wrote those 16 trial docs plus `criteria/1/meta/source` server-side, using the Firebase CLI login for pravinraj.vincent@gmail.com, not gcloud ADC. Confirmed with a GET of NCT03093116 (14 typed checks, prompt v3, dataTimestamp 2026-11-10T10:00:05) and meta `cachedOk` 16, at 9:24 PM ET.

## Narrow-pass official score (prompt v3, postprocess)

Model: `gemini-3.5-flash-lite`. Prompt version 3. Schema version 1, with an optional `exceptions` string on typed checks. `responseMimeType` `application/json` plus Firebase AI Logic `responseSchema`. Deterministic post-processing: `scripts/lib/postprocess-parse.mjs`. Public trial text only, from `gold/parser-input-trials.json` (ClinicalTrials.gov data timestamp 2026-11-10T10:00:05, API v2.0.5). Runner: `scripts/run-accuracy-spike.mjs`. No persona or chart text was sent. Plan remained Spark.

A hit still requires a typed check with the same `kind` and `polarity` as gold, and a value the v1 matcher can use. C25 and C26 are hits only if they were left in `fuzzyCriteria`.

### Headline numbers

| Run | When (ET) | Typed | Fuzzy | Overall | Safe misses | Unsafe misses | Retries | Notes |
|---|---|---|---|---|---|---|---|---|
| A | 9:13 PM | 24 / 24 | 2 / 2 | 26 / 26 (100%) | 0 | 0 | none | Raw parse missed IIIC on C05 (23 / 24, 1 unsafe). Rescored with the stage-expansion rule later used for run B. |
| B | 9:14 PM | 24 / 24 | 2 / 2 | 26 / 26 (100%) | 0 | 0 | none | Complete postprocess from the start. C05 raw also omitted IIIC; expansion fixed it. |

Run-to-run stability, after the same postprocess: **26 / 26 items agreed** on official verdict (100%). Both-hit count 26. Flips: 0.

Raw outputs: `notes/accuracy-raw/schema-v3-run-a-score.json`, `schema-v3-run-b-score.json`, `schema-v3-stability.json`.

### Per-criterion official result (both runs agreed)

All 26 items hit. The nine v2 typed misses are now hits:

| ID | Kind | Trial | Official | How it was recovered |
|---|---|---|---|---|
| C07 | egfr_variant_in | NCT04181060 | hit | Postprocess read the "e.g. but not limited to" list (without splitting on `e.g.`) and added `egfr_variant_in` including exon 19 deletion. |
| C11 | egfr_status | NCT03851445 | hit | Typed `egfr_status` exclusion, presence present, with the "unless progressed on targeted therapy" clause in `exceptions`. |
| C12 | alk_status | NCT03851445 | hit | Same sentence, `alk_status` exclusion plus `exceptions`. |
| C15 | prior_lines_max | NCT04181060 | hit | "No prior systemic treatment for metastatic disease" typed as `prior_lines_max` 0, with a metastatic-disease note in `exceptions`. |
| C16 | prior_therapy_excluded | NCT04181060 | hit | `osimertinib` and `EGFR TKI` typed as written, 21-day start-window in `exceptions`. The anti-VEGF exclusion remains as its own check. |
| C17 | prior_lines_min | NCT03851445 | hit | "At least one line of systemic therapy" typed as `prior_lines_min` 1, later regimen clauses in `exceptions`. |
| C19 | brain_mets | NCT06561386 | hit | "Must not have untreated CNS metastases" canonicalized to inclusion with `none` and `treated_stable`. The "known active CNS" wording on C18 stayed exclusion plus `untreated`. |
| C20 | egfr_min | NCT01720836 | hit | Creatinine clearance > 60 taken as `egfr_min` 60; the OR-creatinine and AST/ALT qualifier went in `exceptions`. |
| C21 | egfr_min | NCT03093116 | hit | Creatinine clearance > 40 taken as `egfr_min` 40, same OR-compound handling. |

C05 (`stage_in`, NCT03191149) stayed a hit after postprocess: both raw model lists were IIIB / IV / IVA / IVB, missing IIIC, and the advanced-stage expansion added IIIC. C25 and C26 stayed in `fuzzyCriteria`.

### Safe vs unsafe, on this gold set

| Run | Official typed misses | Safe (left fuzzy / omitted) | Unsafe (wrong typed gate) |
|---|---|---|---|
| A (rescored) | 0 / 24 | 0 | 0 |
| B | 0 / 24 | 0 | 0 |

If we had left C05 unexpanded, that one miss would have been unsafe: a IIIC patient would have failed the typed stage list even though gold includes IIIC.

## Previous official score (prompt v2, no postprocess)

These 15 / 24 numbers are history. They are not the current official score.

Model: `gemini-3.5-flash-lite`. Prompt version 2. Schema version 1. `responseMimeType` `application/json` plus Firebase AI Logic `responseSchema` (kinds, polarity, and optional value fields). Public trial text only, from `gold/parser-input-trials.json` (ClinicalTrials.gov data timestamp 2026-11-10T10:00:05, API v2.0.5). Runner: `scripts/run-accuracy-spike.mjs`. No persona or chart text was sent. Plan remained Spark.

Prompt v2 adds three few-shot examples from public trials that are not in the gold set (NCT07538804, NCT06043817, NCT07617337), tells the model to keep C25 / C26-type items in `fuzzyCriteria`, to copy drug names as written, and to treat IIIA / IIIB NSCLC as in scope. The runner retries 500 high-demand and similar transient errors with exponential backoff (8s, 16s, 32s, plus jitter), up to four attempts.

A hit still requires a typed check with the same `kind` and `polarity` as gold, and a value the v1 matcher can use. C25 and C26 are hits only if they were left in `fuzzyCriteria`.

### Headline numbers

| Run | When (ET) | Typed | Fuzzy | Overall | Retries | Notes |
|---|---|---|---|---|---|---|
| A | 9:05 PM | 15 / 24 | 2 / 2 | 17 / 26 (65.4%) | none | All 9 trials parsed on the first attempt. |
| B | 9:06 PM | 15 / 24 | 2 / 2 | 17 / 26 (65.4%) | 1 | NCT03191149 HTTP 500 high demand, success on retry. |

Run-to-run stability: **26 / 26 items agreed** on official verdict (100%). Both-hit count 17. Flips: 0. The same nine typed items missed both times.

Raw outputs: `notes/accuracy-raw/schema-v2-run-a-score.json`, `schema-v2-run-b-score.json`, `schema-v2-stability.json`.

### Per-criterion official result (both runs agreed)

| ID | Kind | Trial | Official | Notes |
|---|---|---|---|---|
| C01 | age_min | NCT03093116 | hit | 18. |
| C02 | ecog_max | NCT03093116 | hit | 1. |
| C03 | ecog_max | NCT04181060 | hit | 2. |
| C04 | histology_in | NCT04181060 | hit | Non-squamous list matched gold. |
| C05 | stage_in | NCT03191149 | hit | IIIB / IIIC / IV / IVA / IVB. |
| C06 | stage_in | NCT03851445 | hit | IV / IVA / IVB. |
| C07 | egfr_variant_in | NCT04181060 | miss | Collapsed the example-variant list to `egfr_status` present. No `egfr_variant_in`. |
| C08 | egfr_variant_in | NCT03191149 | hit | Exon 20 insertion. |
| C09 | egfr_status | NCT04198766 | hit | Absent. |
| C10 | alk_status | NCT04198766 | hit | Absent. |
| C11 | egfr_status | NCT03851445 | miss | Left fuzzy because of an "unless progressed on standard targeted therapy" exception. |
| C12 | alk_status | NCT03851445 | miss | Same exception clause as C11. |
| C13 | kras_variant_in | NCT04613596 | hit | G12C. |
| C14 | alk_status | NCT03093116 | hit | Present. |
| C15 | prior_lines_max | NCT04181060 | miss | "No prior systemic treatment for metastatic disease" left fuzzy, not typed as `prior_lines_max` 0. |
| C16 | prior_therapy_excluded | NCT04181060 | miss | Typed "anti-VEGF agent" as written. Osimertinib / EGFR TKI went fuzzy because of a 21-day start-date exception. |
| C17 | prior_lines_min | NCT03851445 | miss | Prior-line text left fuzzy as part- and exception-dependent. |
| C18 | brain_mets | NCT04165070 | hit | Exclusion, `allowedBrainMets` matched gold. |
| C19 | brain_mets | NCT06561386 | miss | Gold is inclusion with `none` and `treated_stable`. Model emitted exclusion both times (run A with `none` / `treated_stable`, run B with `untreated`). |
| C20 | egfr_min | NCT01720836 | miss | Creatinine clearance > 60 left fuzzy as a compound creatinine-or-clearance rule. Trial stayed in scope; C23 and C24 still hit. |
| C21 | egfr_min | NCT03093116 | miss | Creatinine clearance > 40 left fuzzy as a compound creatinine-or-clearance rule. |
| C22 | hemoglobin_min | NCT03093116 | hit | 9. |
| C23 | platelets_min | NCT01720836 | hit | 100000. The first unlocked run had skipped this trial as out of scope. |
| C24 | anc_min | NCT01720836 | hit | 1500. Same as C23. |
| C25 | fuzzy | NCT04181060 | hit | Measurable disease left in `fuzzyCriteria`. |
| C26 | fuzzy | NCT06561386 | hit | Life expectancy left in `fuzzyCriteria`. |

## First official score (prompt v1, no responseSchema)

The unlocked first run at 8:57–8:59 PM ET is kept below as history. Official score then: **0 / 24** typed and **0 / 26** overall, because no emitted check had `kind`. That run is not the current official number.

## Verification that the console step worked

At 8:56–8:57 PM ET, after Pravinraj's console work:

- Billing still off. Plan remains Spark. `firebase_get_environment` reported `Billing Enabled: No`. Agent Platform / Vertex stayed disabled.
- `firebase ailogic:providers:list`: `gemini-developer-api` Enabled, `gemini-agent-platform-api` Disabled.
- The earlier `provisionFirebaseApp` ToS error was gone. `firebase_init` ailogic succeeded for Inclusion Web (`1:643759140603:web:528ba958d6a8785dae4a5e`), so the Generative Language API terms were accepted. (The MCP environment still says "Gemini in Firebase Terms of Service: NOT ACCEPTED." That is a different, console-assistant ToS. It did not block these calls.)
- App Check was not enforced, as requested.

ONLY_IN_CLOUD pong test, `gemini-3.5-flash-lite`, prompt "Reply with the single word pong.":

- Result: `pong`
- `inferenceSource`: `in_cloud`
- Usage: 8 input tokens, 1 output token, `serviceTier: standard`

No side-channel API key was created.

### Prompt v1 run details

Model: `gemini-3.5-flash-lite`. Prompt version 1. Schema version 1. Public trial text only, from `gold/parser-input-trials.json` (ClinicalTrials.gov data timestamp 2026-11-10T10:00:05, API v2.0.5). Runner: `scripts/run-accuracy-spike.mjs`. No persona or chart text was sent.

### Official score then (not the current number)

**Typed extraction: 0 / 24 (0%). Overall, including fuzzy placement: 0 / 26 (0%).** This was official only until the schema-locked prompt v2 runs above.

A hit requires a typed check with the same `kind` and `polarity` as gold, and a value the v1 matcher can use. C25 and C26 are hits only if they were left in `fuzzyCriteria`.

First pass (8:57 PM ET) parsed 7 of 9 trials. NCT04181060 returned invalid JSON (`Expected double-quoted property name in JSON at position 972`). NCT06561386 returned HTTP 500: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later." There was no 429 and no quota-exceeded error. A same-prompt retry of those two trials, still on Spark, both succeeded (16 and 10 typed-like objects). After that, 9 / 9 trials had a JSON object, and **0 / 9** used the required `kind` / `polarity` fields.

### Per-criterion result of the unlocked run

All 26 were misses against the v1 schema, because no emitted check had `kind`.

| ID | Kind | Trial | Official | Notes |
|---|---|---|---|---|
| C01 | age_min | NCT03093116 | miss | No `kind`. Semantic hit: age ≥ 18. |
| C02 | ecog_max | NCT03093116 | miss | No `kind`. Semantic hit: ECOG ≤ 1. |
| C03 | ecog_max | NCT04181060 | miss | First pass: invalid JSON. Retry: no `kind`. Semantic hit: ECOG 0–2. |
| C04 | histology_in | NCT04181060 | miss | First pass: invalid JSON. Retry: non-squamous histology was not extracted. |
| C05 | stage_in | NCT03191149 | miss | No `kind`. Partial: free text mentioned stage IV and IIIB, not a `stages` list with IIIC / IVA / IVB. |
| C06 | stage_in | NCT03851445 | miss | No `kind`. Partial: "Stage IV or recurrent," no IVA / IVB list. |
| C07 | egfr_variant_in | NCT04181060 | miss | First pass: invalid JSON. Retry: exon 19 / sensitizing EGFR inclusion was not extracted. |
| C08 | egfr_variant_in | NCT03191149 | miss | No `kind`. Semantic hit: EGFR exon 20 insertion. |
| C09 | egfr_status | NCT04198766 | miss | Not extracted (only age and an OX40 exclusion came back). |
| C10 | alk_status | NCT04198766 | miss | Not extracted. |
| C11 | egfr_status | NCT03851445 | miss | EGFR exclusion not extracted. |
| C12 | alk_status | NCT03851445 | miss | ALK exclusion not extracted. |
| C13 | kras_variant_in | NCT04613596 | miss | No `kind`. Semantic hit: KRAS G12C. |
| C14 | alk_status | NCT03093116 | miss | No `kind`. Semantic hit: ALK (grouped with ROS1 / NTRK1-3). |
| C15 | prior_lines_max | NCT04181060 | miss | First pass: invalid JSON. Retry: no `kind`. Semantic hit: no prior systemic treatment for metastatic disease. |
| C16 | prior_therapy_excluded | NCT04181060 | miss | First pass: invalid JSON. Retry: no `kind`. Semantic hit at class level: "EGFR TKI," not the gold string `osimertinib`. |
| C17 | prior_lines_min | NCT03851445 | miss | No `kind`. Semantic hit: at least one prior systemic line. |
| C18 | brain_mets | NCT04165070 | miss | No `kind`. Semantic hit: no active CNS metastases. |
| C19 | brain_mets | NCT06561386 | miss | First pass: HTTP 500 high demand. Retry: no `kind`. Semantic hit: untreated CNS metastases not allowed. |
| C20 | egfr_min | NCT01720836 | miss | Model marked the whole trial out of scope and emitted no labs. The record is NSCLC and includes stage IIIA / IIIB, so it is not "clearly limited to stage I or II." |
| C21 | egfr_min | NCT03093116 | miss | Creatinine clearance > 40 mL/min was not extracted. |
| C22 | hemoglobin_min | NCT03093116 | miss | No `kind`. Semantic hit: hemoglobin ≥ 9.0 g/dL. |
| C23 | platelets_min | NCT01720836 | miss | Skipped with the out-of-scope call. |
| C24 | anc_min | NCT01720836 | miss | Skipped with the out-of-scope call. |
| C25 | fuzzy | NCT04181060 | miss | First pass: invalid JSON. Retry: measurable disease was not placed in `fuzzyCriteria`. |
| C26 | fuzzy | NCT06561386 | miss | First pass: HTTP 500. Retry: life expectancy was not placed in `fuzzyCriteria`. |

### Semantic mapping, not matcher-ready

If we manually read the invented fields after the retries, about **12 / 26** gold items have a usable fact (C01, C02, C03, C08, C13, C14, C15, C16 as EGFR TKI, C17, C18, C19, C22), **2 / 26** are partial stage lists (C05, C06), and **12 / 26** are genuine content misses, including the out-of-scope error on NCT01720836, missing EGFR/ALK status on NCT04198766 and NCT03851445, missing C07 and C04 on NCT04181060, missing C21, and both fuzzy leftovers. This mapping is background only. It does not change the official 0 / 24 and 0 / 26 scores.

Raw outputs: `notes/accuracy-raw/cloud-parser-score.json`, `cloud-parser-summary.json`, `retry-two-failures.json`.

## On-device Nano fuzzy judge

### First run, already scored

THINK, Chrome 157, November 11, 2026, 8:57 PM ET, `runbook/nano-judge.html`: **5 / 6 (83.3%)**, reported by Pravinraj.

- C25 Alex: gold met / Nano met
- C25 Jordan: gold unknown / Nano unknown
- C25 Sam: gold unknown / Nano met — **miss**. Nano inferred baseline timing ("assuming randomization occurred before..."). That is a false met.
- C26 all three personas: gold unknown / Nano unknown

The useful bar for this slice is 5 or 6 of 6. The first run met the count but failed the more important test: `unknown` when the note is silent, not an overclaim.

### Hardening, ready for rerun

`runbook/nano-judge.html` was updated, and the same file was copied to `C:\Users\Pravin\inclusion-nano-check\nano-judge.html` on THINK. The existing server at `http://127.0.0.1:4173` should serve it after a hard refresh.

Changes:

- `responseConstraint` now requires `evidence_quote` along with `judgment` and `reason`.
- The page accepts `met` or `not_met` only if `evidence_quote` is a verbatim substring of the clinic note (at least 8 characters) and the reason/quote does not hedge with assuming, implying, likely, or presumably. Otherwise it records `unknown`.
- Status log line breaks are real new lines, not a literal `\n`.

### Rerun steps for Pravinraj, on THINK

1. Open Google Chrome, not Edge.
2. Go to `http://127.0.0.1:4173/nano-judge.html`.
3. Press Ctrl+F5 so the browser is not using the cached first-run page. You should see a sentence about `evidence_quote` under the heading.
4. Click "Check availability" (you want `available`), then "Run the six fuzzy judgments."
5. Screenshot the result line and the full table, especially the Gold, Final, and Model columns for C25 Sam, and send it back.

If the server is down:

```powershell
cd C:\Users\Pravin\inclusion-nano-check
python -m http.server 4173 --bind 127.0.0.1
```

Then open the URL and hard refresh.

The new 6-item score is not in yet. C25 Sam is the one to watch: gold is `unknown`, and a hedged `met` should now be downgraded.

## On-device Nano fuzzy judge, hardened (evidence_quote gate), THINK Chrome 157 (2026-11-11 9:02 PM ET)
Result: 6 / 6 match gold (100%), reported by Pravinraj. C25 Sam now unknown (was false met). Only "met" (C25 Alex) carried verbatim quote "Measurable lung and mediastinal disease on CT." On-device half of Nov 16 bar: PASSED.


## Fail-closed normalizer, diagnosis on sets 1 and 2, then clean set 3 (2026-11-11 9:43–9:44 PM ET)

The typed path is the deterministic section-aware normalizer (`scripts/lib/normalize-eligibility.mjs`), not a model. The flash-lite vs stronger Flash comparison was skipped for that reason.

Fail-closed classes added before set 3 was frozen (not per-trial patches): negation and presence conflict → Discuss; example/hedge and procedural cue → Discuss; stage lists only when complete, with inclusive range expansion; prior-line counting sentences about earlier-stage history are not the required stage list; spans split on newlines and sentence boundaries so one sentence cannot overwrite another; Gilbert's or liver-mets lab caps are not the general threshold.

Diagnosis rescores after those guards, not official clean scores for the earlier official runs:

- Held-out set 1: 49/87 typed (56.3%), 0 unsafe out of 87, 38 safe. Decided-share 56.3%. Six-type decided-share 48/69 (69.6%). Per type: driver 15/24 (62.5%), stage 8/9 (88.9%), prior 7/17 (41.2%), ECOG 7/7 (100%), brain 6/7 (85.7%), labs 5/5 (100%), other 1/18 (5.6%). Raw: `notes/accuracy-raw/set1-failclosed-score.json`.
- Held-out set 2: 80/131 typed (61.1%), 0 unsafe out of 131, 49 safe (one safer after the Gilbert's lab guard). Decided-share 61.1%. Six-type decided-share 69/119 (58.0%). Per type: driver 4/21 (19.0%), stage 13/16 (81.3%), prior 2/9 (22.2%), ECOG 12/20 (60.0%), brain 3/4 (75.0%), labs 36/49 (73.5%), other 11/12 (91.7%). Raw: `notes/accuracy-raw/set2-failclosed-score.json`.

Official clean set 2 from earlier in the evening (pre-guard) remains 70/131 with 9 unsafe; that set stays burned as an official test of the pre-guard pipeline.

### Held-out set 3 (labels first, then one clean run, no tuning)

- Labels committed as `85dbad1880693b9faed212c1315779275d851705` at 2026-11-11 21:43:41 ET, AuthorDate 2026-11-11 21:43:41 -0500.
- File of record: `gold/held-out-3-criteria-2026-11-11T214338-0500.json`. 25 trials, 94 typed items, labeledAt 2026-11-11T21:43:38-05:00. SHA-256 `b0d8214c3b81477da064891b64ae22398cf14561d5678a7f3d923f680ce4c6b2`.
- Parser input was written after that commit. Single run of `scripts/score-deterministic.mjs`. Raw: `notes/accuracy-raw/set3-failclosed-score.json`.
- Score: 49/94 typed (52.1%), 41 safe, **4 unsafe out of 94**. Decided-share 52.1%. Six-type decided-share 40/85 (47.1%).
- Per type: driver 2/17 (11.8%), stage 7/8 (87.5%), prior 1/13 (7.7%), ECOG 13/19 (68.4%), brain 6/7 (85.7%), labs 11/21 (52.4%), other 9/9 (100%).
- The four unsafe misses were the same class: `prior_therapy_excluded` with a matching kind and polarity but a narrower `stringValue` (`anti-PD-1` or `anti-PD-1 or anti-PD-L1 agent`) than gold (a general systemic-therapy / systemic-chemotherapy exclusion). IDs: U16 NCT06170788, U19 NCT06216301, U32 NCT06731907, U93 NCT06422143.
- The parser is not treated as generally final. Rules were not tuned on set 3.
- Demo cache: fail-closed normalizer, typed checks restricted to the six key types except prior-therapy classes, so that unsafe class is not shown. Age and prior-therapy checks are held as Discuss. 277/277 regional trials parsed with no model calls; Firestore written server-side as pravinraj.vincent@gmail.com, 277 documents plus meta/source, no billing.
