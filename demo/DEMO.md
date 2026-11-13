# Inclusion: private clinical-trial matching

A 3-minute local demo.

This is a local Chrome walkthrough of Inclusion. The hosted demo at https://inclusion-hybridai.web.app talks to the live `inclusion-hybridai` Firebase project for the public trial cache. Your chart is judged on this computer.

Serve a production build from the repo root after `npm run build`, or from this folder:

```bash
python3 demo/serve.py
```

That binds `http://127.0.0.1:4173/` and refuses any other bind address. Open that URL in Chrome. For clinic-note reading, use a Chrome that already has Gemini Nano downloaded. A local build may fall back to the bundled trial snapshot, because the production reCAPTCHA key doesn't include localhost. That's expected. The live App Check and Firestore path is the hosted demo.

Copy `.env.example` to `.env.local` for a local build. Leave `VITE_APPCHECK_DEBUG` off, and don't add a debug token.

Use only the synthetic patients. Never paste a real chart.

## What to show, in about three minutes

### 0:00 : Trust, and the hybrid story

The landing should already feel like a product, not a document. The only privacy claim in the header is the **Proof · 0 chart bytes sent** pill. That wording is deliberate: public queries (Firestore cache reads, and any condition-only ClinicalTrials.gov search) do leave the page. Open Proof to see the Outbox. The byte count is chart text only, and it should start at **0 bytes of chart text sent**. Each public request is labeled **Public query, no chart data**.

Then linger on the hybrid-flow diagram. That is the hackathon's story, in one picture: public trial text is parsed in the **Cloud** (cached; the shipped snapshot is the Firebase AI Logic pipeline) and labeled with its inference source; the chart is read **On-device (Gemini Nano)** when that model is available, otherwise facts stay on this computer with no model; they meet at **Match on this device · no model**. Each step shows where it ran.

Read the disclaimer once: this is a discussion aid. It cannot tell someone they qualify.

### 0:20 : Load a synthetic patient

In the stepper, click **Load Alex Rivera**. A persistent **Synthetic demo data** label appears in the header, on the chart card, and on the print sheet, and stays visible on every path, including clinic-note paste and self-entry. The chart preview card should also show initials, a fact-chip row, and an **On this device** badge. Status should say the patient is synthetic and that no chart text was sent.

If Gemini Nano is available, you can also paste the same synthetic note and let the on-device model read it. If the on-device model is unavailable (including headless Chromium, or a machine that does not meet Chrome's Prompt API requirements), a dedicated screen says: **Your chart stays here. This computer can't run on-device AI, but the full demo still works.** It has **Load a synthetic patient** and a **Watch the 3-minute demo** control. Until a video link exists, that watch control stays a clearly disabled placeholder, not a broken link. Chrome's official on-device requirements sit behind a collapsed disclosure, **Requirements (from Chrome docs, Oct 21, 2026)**, quoted from [the Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api). Inclusion never falls back to a cloud model for chart content. You can still load a synthetic patient, or enter facts yourself. That path is judged entirely on this computer against the public trial cache. If Firestore, Auth, App Check, or a quota check fails, the app falls back to the bundled cache and shows a calm info line, for example **Using the bundled public trial snapshot (277 trials).** It does not leave a blank screen, and it does not say that sign-in failed unless anonymous sign-up itself failed.

### 0:45 : Watch the hybrid match run

Click **Compare with nearby trials**. The hybrid-flow diagram should light up live: cloud path, then the on-device path, then **Match on this device**. The indicator pulses while matching happens on this computer. Then the command view opens.

### 1:05 : Command view

This is the product moment. The results hybrid strip collapses to one line, with an inference-source label on each step. The only privacy claim on this view stays in the header: the **Proof · 0 chart bytes sent** pill. Left: an offline map of Ohio and the 300-mile region, about a third of the width, showing only Strong-match sites. No map tiles are loaded. City labels on pins appear only on hover or select. Pins and cards stay linked on hover and select. Right: Strong matches, ranked by strength of evidence. Each card leads with a plain driver line, then the official title, a filled **N of 6** ring for key criteria met, a **Strong evidence** chip, distance on the card, and a heavier **Ask your oncologist** block that points to the print sheet. The care-team line appears once, under the list. Other trials collapse under **Other trials to ask about (N)**.

Hero numerals lead with **N strong**, then trials reviewed. Distance is only on the cards. The only privacy claim in the header is the **Proof · 0 chart bytes sent** pill.

Never "you qualify" or "eligible."

On Alex's first card, **NCT04486833**:

- The chip is **Strong evidence**. Four of six key criteria are met, each with a quote from the trial's own words: EGFR mutation-positive (chart: EGFR exon 19 deletion), Stage III or IV, ECOG 0 to 1, and labs. Prior osimertinib progression and the complex brain-metastasis language stay as honest Discuss items.
- The title is a later-line EGFR study: Reqorsa plus osimertinib after progression on osimertinib.
- Click the card. The slide-over headline is the plain driver line, with the official title smaller underneath, and a criteria matrix. A KRAS G12C trial must not outrank this, and should fall in Unlikely because the chart shows KRAS is absent.

Hover a map pin; the matching card should highlight, and the other way around.

Name NCT04486833 as the one you'd actually bring to clinic.

### 1:45 : Prove no chart text left

Open **Proof** again. If Firestore was read, you'll see that public-cache request, labeled **Public query, no chart data**. Public queries are expected. What must not appear is chart text, a persona note, or a biomarker line in any URL, query, or blocked payload. If a request had tried to carry chart text, it would show as blocked. The pill still reads **0 chart bytes sent**.

### 2:10 : A second synthetic patient, then print

Click **Edit chart or facts**, then **Load Sam Okonkwo** and **Compare with nearby trials** again. The map home pin should move to Cincinnati, and the shortlist should change. Sam's top cards are ALK-positive studies, not Alex's post-osimertinib EGFR trials. Open a slide-over, then click **Print this sheet**. The map, hybrid flow, and trust strip drop out of the print layout, leaving a clean light briefing and the ClinicalTrials.gov attribution, including the dataTimestamp.

### 2:40 : Empty and error, if you have time

With the note cleared and no fact sheet, Review still shows a calm empty briefing, not a blank hole. If you temporarily break the network, the page should say it could not reach Firestore and fall back to the local `criteria-cache.json` that ships in the build. On a narrow phone, the map collapses behind a Map tab.

Stop there. That is the demo.


## Why the top trials rank where they do

Ranking uses public ClinicalTrials.gov structured fields first (title, official title, conditions, keywords, phase, overall status, sites), then quoted typed checks. A driver-targeted trial that conflicts with the chart is **Unlikely** and cannot outrank a confirmed driver match. Strong means a confirmed positive driver match on an NSCLC (or mixed-NSCLC) recruiting study, not demoted for first-line language. Possible is everything compatible that is not Strong. The default view leads with Strong matches, ranked by strength of evidence. Possible trials sit under **Other trials to ask about**.

### Alex Rivera (EGFR exon 19 deletion, prior osimertinib, KRAS and ALK absent, Columbus)

Counts at the time of this build: 9 Strong, 198 Possible, 70 Unlikely out of 277.

1. **NCT04486833** : Strong. Official title is EGFR-mutant NSCLC; brief title is Reqorsa plus osimertinib in people who progressed on osimertinib. That is a later-line EGFR match to the chart, with a site about 103 miles from Columbus. The briefing quotes the inclusion sentence for EGFR, stage III or IV, ECOG 0 to 1, and labs, and names the chart variant (chart: EGFR exon 19 deletion).
2. **NCT07155187** : Strong. EGFR-mutated nonsquamous NSCLC after progression on a third-generation EGFR TKI, which matches prior osimertinib.
3. **NCT07100080** : Strong. EGFR-mutated NSCLC after failure of EGFR TKI therapy. Nearest site is Columbus (0 miles).

A KRAS G12C study such as NCT06343402 is Unlikely: the title requires KRAS G12C, and the chart shows KRAS is absent. First-line EGFR titles (for example NCT04181060) stay Possible, not Strong, because Alex already has a prior line.

### Sam Okonkwo (ALK rearrangement, prior alectinib, EGFR and KRAS absent, Cincinnati)

Counts at the time of this build: 4 Strong, 200 Possible, 73 Unlikely out of 277.

1. **NCT03093116**: Strong, 4 of 6 key criteria met (ALK driver, stage, ECOG, labs). Title requires a tumor harboring ALK, ROS1, or NTRK rearrangements. Nearest site is about 2 miles from Cincinnati.
2. **NCT06225427**: Strong, 3 of 6 (driver, ECOG, labs; stage was not typed). Title is gilteritinib for ALK NSCLC. Sam has an ALK rearrangement.
3. **NCT07140016**: Strong, 2 of 6. Title is gilteritinib in advanced ALK-positive NSCLC.

A fourth Strong card, **NCT07491497** (TRI-611 in ALK-positive NSCLC), follows those three. The TKI-naive ALK study **NCT06765109** is Unlikely because the chart already lists alectinib. Alex's post-osimertinib EGFR trials do not appear in Sam's Strong list.

## If something is off

- On-device AI not available: the no-Nano screen explains why, cites Chrome's official requirements, and keeps self-entry and synthetic patients available. The chart still never goes to a cloud model.
- Cache looks thin: this build ships a local copy of all 277 regional trials, parsed with the shipped Firebase AI Logic pipeline (prompt v3, quote gate, two-run consistency, normalizer as verifier). Firestore should have the same 277 documents.
- "No strong matches": pick the other synthetic patient, or fill ECOG, stage, and a driver on the form so typed and title checks can resolve. Other trials may still appear under **Other trials to ask about**.

ClinicalTrials.gov last processed the source records at `2026-11-10T10:00:05`. Attribute trial language to ClinicalTrials.gov, NLM, NIH.
