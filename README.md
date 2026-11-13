# Inclusion: private clinical-trial matching

Inclusion is a discussion aid for people living with non-small cell lung cancer and their oncologists. It compares a structured fact sheet, kept on this computer, against a public cache of nearby ClinicalTrials.gov eligibility language. It can't tell someone they qualify or that they are eligible. Those words don't appear in the product.

This repository is a Firebase #BuildHybridAI entry by Pravinraj Vincent, an independent developer. The license is Apache-2.0 (see `LICENSE`). The demo uses synthetic patients only. Never paste a real chart.

Live demo: https://inclusion-hybridai.web.app

## How the hybrid split works

The match is hybrid, and the split is strict.

- **Public trial text** is parsed once, off the judge path, and cached. The architecture allows a one-time cloud parse of public ClinicalTrials.gov eligibility (Firebase AI Logic, `ONLY_IN_CLOUD`), but client live cloud parsing is disabled. A judge or demo visit never calls Gemini to parse the full set. The client only reads the cached records from Firestore, and if Auth, App Check, Firestore, or a quota check fails, it shows a clear message and falls back to the bundled `public/trial-records.json`. It doesn't leave a blank screen. No patient chart is included in that cache. The UI labels this step **Cloud · cached public parse**.
- **The chart** is read only with Firebase AI Logic in `ONLY_ON_DEVICE` mode (Chrome's on-device Gemini Nano, via the Prompt API). `PREFER_ON_DEVICE` is rejected because it can silently fall back to the cloud if Nano is missing. If the on-device model is unavailable, Inclusion shows a dedicated screen and will not send the chart to a cloud model. You can still load a synthetic patient or enter facts yourself. That path is judged on this computer, with no model, against the public cache. The UI labels the chart step with its `inferenceSource`: on-device Nano, or on this device with no model.
- **Matching** is deterministic and runs on this device. Distance, ranking, and quoted checks never leave the page.

Network traffic is visible. The Proof pill reports **chart** bytes only, for example `Proof · 0 chart bytes sent`. The Outbox lists requests that left the page. Firestore cache reads and any condition-only ClinicalTrials.gov search are labeled **Public query, no chart data**. Chart text in a request is blocked.

If a clinic note is read on-device, any patient name the model returns is discarded. It isn't stored, shown, or sent. Synthetic persona labels such as "Alex Rivera" are demo names only.

Firestore rules allow authenticated reads of `criteria/{schemaVersion}/trials/{nctId}` and `criteria/{schemaVersion}/meta/{docId}` only. Client creates, updates, and deletes are denied. Cache writes are server-side (Admin / the write script, which bypasses rules). No patient chart text is stored in Firestore. See `firestore.rules`.

Production App Check uses a score-based reCAPTCHA Enterprise / Google Cloud Fraud Defense web key with `ReCaptchaEnterpriseProvider`. The project stays on the no-cost Spark plan, with no billing account and no Blaze upgrade. Official Firebase docs limit Spark to four of eleven Enterprise score levels (0.1, 0.3, 0.7, 0.9) and still allow a 0.5 app-risk threshold, which is what this app uses. Official Fraud Defense billing docs place unbilled projects on the Essentials tier: up to 10,000 assessments per organization per month at no cost; overage returns HTTP 429 rather than a charge. Classic reCAPTCHA v3 isn't used: App Check rejected new v3 onboardings as deprecated. The Enterprise site key is registered on the web app, the Firebase App Check API is enabled, and App Check is enforced on Cloud Firestore and Firebase AI Logic (`firebaseml.googleapis.com`), without replay protection. If attestation or a live Firestore read fails, the client shows a calm snapshot note and falls back to the bundled trial cache.

The public Firebase web config and the public reCAPTCHA site key are in `.env.example`. They are client values, not privileged secrets. App Check debug tokens are for a private localhost machine only and must never be committed or shipped in a production build. Leave `VITE_APPCHECK_DEBUG` off.

## Chrome Prompt API (Gemini Nano)

Clinic-note reading needs Chrome's on-device model. Requirements are quoted from Chrome's Prompt API documentation, last updated October 21, 2026: <https://developer.chrome.com/docs/ai/prompt-api>. Don't treat any other number as official.

- **Web availability:** the Prompt API on the web is available in Chrome 148.
- **Operating system:** Windows 10 or 11; macOS 13 or later (Ventura and onwards); Linux; or ChromeOS (from Platform 16389.0.0 onwards) on Chromebook Plus devices. Chrome for Android, iOS, and ChromeOS on non-Chromebook Plus devices aren't yet supported by the APIs which use the built-in language models.
- **Storage:** at least 22 GB of free space on the volume that contains your Chrome profile. If available storage falls lower than 10 GB, the model is deleted.
- **GPU or CPU:** built-in models can run with a GPU or a CPU. GPU: strictly more than 4 GB of VRAM. CPU: 16 GB of RAM or more and 4 CPU cores or more.
- **Network:** unlimited data or an unmetered connection, and only for the initial model download. Subsequent use doesn't require a network connection. No data is sent to Google or any third party when using the model.

A machine that can't run the on-device model, including headless Chromium and computers below those Chrome requirements, still loads the hosted demo: a dedicated no-Nano screen, synthetic patients, and self-entry. It can't fall back to a cloud model for chart content.

## Synthetic data only

The shipped demo loads two synthetic personas, Alex Rivera and Sam Okonkwo. A **Synthetic demo data** label stays visible on every path, including clinic-note paste. Their clinic notes and fact sheets are invented for the demo. Don't use real patient data.

## Run it locally

You'll need Node.js 20 or later.

```bash
git clone https://github.com/PravinrajV/inclusion-trial-matching.git
cd inclusion-trial-matching
cp .env.example .env.local
npm install
npm test
npx tsc --noEmit
npm run build
python3 demo/serve.py
```

Then open http://127.0.0.1:4173/ in Chrome. A short walkthrough is in `demo/DEMO.md`. `npm run dev` starts the Vite dev server if you want hot reload.

`.env.example` already has the public Firebase web config and the public reCAPTCHA Enterprise site key used by the hosted app. Copy it to `.env.local` and leave `VITE_APPCHECK_DEBUG` set to `false`. Don't add an App Check debug token. The production reCAPTCHA key doesn't include localhost, so a local build may fall back to the bundled 277-trial snapshot, which is expected. The live hybrid path, including App Check and Firestore, is at https://inclusion-hybridai.web.app.

## Tests

```bash
npm test
```

That runs the Vitest suite. A fresh clone should report 154 tests across 27 files.

## Evaluation method

Eligibility parsing is scored against gold labels that were committed before each scoring run. A typed check is a hit when kind, polarity, and value agree with gold (with documented judgment-equivalent encodings, such as inclusion + absent versus exclusion + present for a driver). Coverage is typed hits over labeled gold items.

A miss is **unsafe** if a typed check could gate a patient differently from the gold check. That includes a wrong value with the same kind and polarity, opposite polarity that isn't judgment-equivalent, typing a looser presence status in place of a listed variant, or typing a subjective item that should have stayed fuzzy. A miss is **safe** if the gold rule was left fuzzy or omitted, with no competing wrong typed check, so the on-device judge can leave it as discuss.

The pass bar for filling the regional demo cache was **0 unsafe** on the then-current held-out set. Official scores below are the fail-closed deterministic normalizer, prompt version `4-deterministic`, with no retune on a set after its labels were committed. A later wording-guard verify for stage and ECOG phrasing is reported separately; prior-therapy rules were not retuned.

Coverage is typed hits over labeled items. It is reported next to the unsafe count on every set so a "0 unsafe" line can't be read alone.

### Official fail-closed scores

| Set | Coverage | Unsafe | Six-type decided-share | Raw |
| --- | --- | --- | --- | --- |
| Held-out set 1 (87 items) | 49/87 (56.3%) | 0/87 | 48/69 (69.6%) | `notes/accuracy-raw/set1-failclosed-score.json` |
| Held-out set 2 (131 items) | 80/131 (61.1%) | 0/131 | 69/119 (58.0%) | `notes/accuracy-raw/set2-failclosed-score.json` |
| Held-out set 3 (94 items) | 49/94 (52.1%) | **4/94** | 40/85 (47.1%) | `notes/accuracy-raw/set3-failclosed-score.json` |

Set 3 didn't meet the 0-unsafe bar. All four official unsafe misses were `prior_therapy_excluded`:

- NCT06170788 (U16), NCT06216301 (U19), NCT06731907 (U32): gold was a general systemic-therapy exclusion; the normalizer emitted a narrower `anti-pd-1` value from nearby language.
- NCT06422143 (U93): the same class, with `anti-pd-1 or anti-pd-l1 agent`.

**Decision:** the fail-closed normalizer wasn't retuned on set 3. The demo typed set omits `prior_therapy_*` classes so that unsafe class isn't shown as a decided check. Age and other non-key types also stay fuzzy when the normalizer isn't confident. The regional cache (277 recruiting NSCLC trials within 300 miles of Columbus, Ohio) was first filled with that restricted typed set, with no model calls. That baseline cache has since been replaced by the shipped Firebase AI Logic pipeline below.

### Stage and ECOG wording-guard verify

A later guard consumes "recurrent" only when an explicit stage list already exists, and parses ECOG phrases such as "score from 0 to 1" and "score of 0, 1, or 2" (taking the max). This was verified on the same frozen gold, without retuning prior therapy:

| Set | Coverage | Unsafe | Raw |
| --- | --- | --- | --- |
| Set 1 | 49/87 (56.3%) | 0/87 | `notes/accuracy-raw/set1-stage-ecog-verify.json` |
| Set 2 | 85/131 (64.9%) | 0/131 | `notes/accuracy-raw/set2-stage-ecog-verify.json` |
| Set 3 | 53/94 (56.4%) | 4/94, same four prior-therapy cases | `notes/accuracy-raw/set3-stage-ecog-verify.json` |

Stage and ECOG unsafe counts are 0 on all three sets after that verify. The official historical record of the 4/94 prior-therapy unsafes remains `set3-failclosed-score.json`.

### Firebase AI Logic pipeline scores (shipped)

Same frozen gold, scored with the shipped option-(a) pipeline (Firebase AI Logic `gemini-3.5-flash-lite`, prompt v3, verbatim quote gate, two-run consistency, deterministic normalizer as a verifier only). Coverage is lower than the official normalizer table because the normalizer can't add decided checks the model didn't emit. Unsafe isn't worse than the official baseline (0, 0, and 4 prior-therapy cases). The public cache on Hosting and in Firestore is this pipeline: 277 recruiting NSCLC trials within 300 miles of Columbus, parsed and shipped on 2026-11-12. This build shows 0 unsafe typed checks on all three sets. The set-3 `prior_therapy_excluded` miss remains a disclosed model-level result; it isn't shown as a typed check in the demo.

| Set | Coverage | Unsafe | Raw |
| --- | --- | --- | --- |
| Held-out set 1 (87 items) | 41/87 (47.1%) | 0/87 | `notes/accuracy-raw/set1-ai-logic-score.json` |
| Held-out set 2 (131 items) | 70/131 (53.4%) | 0/131 | `notes/accuracy-raw/set2-ai-logic-score.json` |
| Held-out set 3 (94 items) | 46/94 (48.9%) | **1/94**, one `prior_therapy_excluded` (NCT06170788, U16) | `notes/accuracy-raw/set3-ai-logic-score.json` |

On this shipped cache, Alex has 9 Strong, 198 Possible, and 70 Unlikely. Alex's first Strong card is NCT04486833, with 4 of 6 key criteria met (EGFR, stage, ECOG, labs), each with a trial quote. Sam has 4 Strong, 200 Possible, and 73 Unlikely. Sam's first Strong card is NCT03093116, with 4 of 6 key criteria met (ALK driver, stage, ECOG, labs), each with a trial quote.

A user-visible versus model-level comparison is in `notes/eval-user-visible-vs-model-level.json`.

## Re-parse public trials through Firebase AI Logic

This is an optional local, Spark-only job. It sends public ClinicalTrials.gov eligibility text only, never a chart. It stays under 15 requests per minute. Don't enable billing.

The official fail-closed scores remain in the table above as the baseline. The shipped Hosting and Firestore cache is the Firebase AI Logic pipeline in the following table. If you re-run the batch, score it, and only replace the public cache if unsafe is no worse than 0, 0, and 4 prior-therapy cases.

```bash
# Uses a registered local App Check debug token in gitignored .env.local.
# That token is not in this repository and must never be committed.
node scripts/batch-parse-ai-logic.mjs --gold-first
# Resume an interrupted job:
node scripts/batch-parse-ai-logic.mjs --resume
# Score already-parsed gold trials without new model calls:
node scripts/batch-parse-ai-logic.mjs --score-only
```

Per-trial merges land in `data/ai-logic-parses/`.
