# Inclusion: private clinical-trial matching

Entrant: Pravinraj Vincent, independent developer.

## Tagline

A briefing for you and your oncologist. Your chart never leaves this computer.

## Value proposition

Inclusion turns 277 recruiting lung-cancer trials near Columbus into a quote-backed briefing for your next oncology visit, without your chart leaving this computer.

## The problem

Finding a cancer trial still starts with a long eligibility document, written for researchers, not for clinic. Sending that note to a cloud model means giving up the most sensitive page in the chart.

## What it does

The demo uses two synthetic patients, Alex Rivera and Sam Okonkwo. A "Synthetic demo data" label stays on screen on every path, including paste.

You can load Alex, or paste his synthetic clinic note, and match on this computer against those 277 trials (ClinicalTrials.gov NSCLC search within 300 miles of Columbus, snapshot 2026-11-10T10:00:05).

For Alex, the result is 9 Strong, 198 Possible, and 70 Unlikely. The first Strong card is NCT04486833, with quoted language for EGFR, stage, ECOG, and labs (4 of 6 criteria met). Sam has 4 Strong, 200 Possible, and 73 Unlikely. His top card, NCT03093116, meets 4 of 6, including the ALK driver, because the trial lists ALK or ROS1 or NTRK. The briefing never says enroll; it gives you a print sheet for clinic.

An unfiltered Nano-read capture showed two Firestore channel requests, both with empty bodies. The Proof pill reads "Proof · 0 chart bytes sent." Public cache reads and condition-only ClinicalTrials.gov searches are labeled "Public query, no chart data."

If this computer cannot run Chrome's on-device model, you can still load a synthetic patient or enter facts yourself. Clinic notes are never sent to a cloud model. The Nano path was verified on a THINK machine in Chrome. Nano read Alex's note and returned age, stage, histology, ECOG, drivers, PD-L1, prior therapy, labs, brain findings, and home, each as a verbatim substring of the note. A deterministic fallback filled the prior-line count and normalized "never-smoker".

## What's different

- The chart can't reach a server by design. Chart reading runs only in ONLY_ON_DEVICE mode; there is no cloud path to fall back to.
- It abstains instead of guessing. Every automated check carries the trial's own words, verbatim, and must agree across two runs; everything else is a question for clinic. We publish the unsafe-miss rate.
- It ends in a conversation, not a score. The output is a print sheet for the oncologist, never an "eligible" or "enroll" verdict.

## How I used Firebase AI Logic

The hybrid split is one rule: the cloud reads only public trial text, the device reads the chart, and nothing falls back from device to cloud.

Public eligibility is parsed in the cloud through Firebase AI Logic (`gemini-3.5-flash-lite` on Spark, `ONLY_IN_CLOUD`). The pipeline is:

1. Send only the public eligibility text, with the v3 prompt.
2. Run the model twice.
3. Keep a typed check only when its evidence quote is a verbatim substring of the trial.
4. Keep a typed check only when both runs agree.
5. Ask the deterministic normalizer to verify the remaining checks. It does not add decided checks the model did not produce. Disagreements and unquoted items go to Discuss.
6. Cache the verified parse in Firestore and in the bundled snapshot.

A judge visit reads the cache and does not parse every trial on load. A rate-capped "Refresh this trial's parse" action, behind App Check, can rerun that pipeline for one public trial, still sending public text only.

Chart reading uses Firebase AI Logic in `ONLY_ON_DEVICE` mode. `PREFER_ON_DEVICE` is rejected, because it can silently send the chart to the cloud if that model is missing. Matching, distance, and ranking stay on this computer.

Live production uses reCAPTCHA Enterprise App Check, enforced on Cloud Firestore and Firebase AI Logic. The client signs in anonymously before cache reads. Client writes are denied. If Auth, App Check, or Firestore fails, the app falls back to the bundled cache with a clear message.

## How I built it

Vite, TypeScript, and the Firebase JS SDK. Trial language is quoted from ClinicalTrials.gov, with known source typos marked [sic]. Each AI step shows where it ran: cached public parse, on-device, or on this computer with no model.

The parser was scored against gold labels committed before each run. A miss is unsafe if a typed check could gate a patient differently from gold. What users see: 0 unsafe typed checks on all three held-out sets. Model level: 1 prior-therapy miss on set 3, so prior-therapy rules aren't automated from the parser. A separate title-based rule can still mark a trial Unlikely if the title requires no prior treatment and the chart lists a TKI. The eval is in `notes/eval-user-visible-vs-model-level.json`. On the frozen gold it scored:

- Set 1 coverage 41/87 (47.1%), 0/87 unsafe; set 2 coverage 70/131 (53.4%), 0/131 unsafe; set 3 coverage 46/94 (48.9%), 1/94 unsafe.

That set-3 miss is a model-level `prior_therapy_excluded` result (NCT06170788, U16): gold was a general systemic-therapy exclusion, and it emitted a narrower `anti-PD-1` value. Official scores are in `notes/accuracy-raw/set{1,2,3}-ai-logic-score.json`. A fail-closed normalizer-only baseline scored 49/87, 80/131, and 49/94, with four prior-therapy unsafe misses on set 3.

Evidence note: hosted smoke of bundle `index-1_X9ePpR.js` at 11:51 PM ET on 12 November 2026 (America/New_York) showed 9 Strong for Alex on NCT04486833, 4 of 6, and an 11-page print sheet. Tests: 154 passed in 27 files.

## What's next

Keep parser prior-therapy classes out of automated checks until they can be scored without adding unsafe misses. Grow the cache to other regions only with the same eval. Next: normalizer fill for 0-unsafe classes, pending held-out set 4.

## Links

- Hosted demo: https://inclusion-hybridai.web.app
- Repository: https://github.com/PravinrajV/inclusion-trial-matching
- Video: TODO, pending approval to post.

## Medical and privacy notes

This is a discussion aid, not medical advice, and it cannot tell someone they belong on a trial. Use synthetic patients only in judged builds. Never paste a real chart.
