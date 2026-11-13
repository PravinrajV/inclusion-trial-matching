# Inclusion: private clinical-trial matching

Entrant: Pravinraj Vincent, independent developer.

This script matches the 2026-11-12 picture-lock at `demo/video/inclusion-demo-2026-11-12.mp4` (2:42, not uploaded). Voice and music are still pending ElevenLabs credentials.

## YouTube visibility

Official contest rules, `rules.md` line 69, require a public video:

> It must conform to the technical requirements set forth on the Contest site, including that the Submission must be uploaded to and made publicly visible on YouTube and a link to the video must be provided on the Submission form on the Contest Site.

"Publicly visible on YouTube" is the rule text. Unlisted is not enough under that line, even if it would be convenient for a quiet review. The video itself must also follow lines 66 through 79: no longer than 3 minutes, in English or with English subtitles, and it must not contain third-party advertising, slogans, logos, trademarks, or anything that suggests a sponsorship or endorsement. There is no carve-out in those lines for product lockups. Use factual product names only where the architecture needs them. Do not put logos or slogans on screen. Name ClinicalTrials.gov in plain text only. Do not show the ClinicalTrials.gov logo or any other third-party mark.

## Writing rules for the film

- Human tone, contractions, no em dashes.
- Never say "qualify," "eligible," or that someone should enroll.
- Not medical advice.
- Claim only what this demo shows.
- Synthetic patients only. Keep the "Synthetic demo data" label in frame when Alex is loaded.
- Do not cite an enrollment percentage. The access problem can be stated in plain language without a figure.
- The official use-case name is **Inclusion: private clinical-trial matching**. Use that exact string on the title card, the thumbnail, and the ending slide. The app shows "Inclusion" as the hero word and "Private clinical-trial matching" as the descriptor under it.

Suggested title and description once posting is approved: "Inclusion: private clinical-trial matching." In the description, name Pravinraj Vincent, independent developer, and say the patients in the video are synthetic.

Total target: about 2 minutes 42 seconds, leaving room before the 3-minute cut. Picture-lock is 162.0 seconds exactly. Only one render at a time. Do not upload or publish until approval.

Local-run steps live in the README, not on the ending slide.

## Title slide (0:00 to 0:03)

Open on a still title card for 3 seconds. No logos, no slogans, no trademark lockups.

On screen, all as plain text, with the real, unaltered profile photo:

- Name: Pravinraj Vincent
- Photo: `/workspace/competitions/deck-the-pixels/source/profile-real.jpg` (the real photo, unaltered: no retouch, filter, or color grade; scaled and placed only)
- Hackathon, plain text only: Firebase #BuildHybridAI
- Use case: Inclusion: private clinical-trial matching

Design: the same dark ground as the app. "Inclusion" is the hero word, IBM Plex Sans Bold, near-white, very large. The secondary line is "Private clinical-trial matching" in SemiBold, high contrast. "Pravinraj Vincent" and "Firebase #BuildHybridAI" are IBM Plex Sans Medium, still high contrast, no hairline weights and no low-contrast orange body text. The photo has tighter framing, a copper rim, and a soft glow so it separates from the background. Our Proof pill, "Proof · 0 chart bytes sent," sits under the type as a product cue. No third-party marks. Mockup: `demo/video/title-slide-1920x1080.png`.

No voiceover on this card. Soft music only, already faded in. Cut to the landing at 0:03.

## YouTube thumbnail

Matching still, 1280x720, same hierarchy, the same unaltered photo, and the same copy, including "Inclusion: private clinical-trial matching." Mockup: `demo/video/youtube-thumbnail-1280x720.png`. A downscaled legibility check is at `demo/video/youtube-thumbnail-320x180-preview.png`. Use the 1280x720 file as the YouTube custom thumbnail when the public upload is approved. Do not add arrows, badges, or brand logos.

## Voice and music (ElevenLabs, paid plan, no Beta features)

Picture is approved for this cut. Voice and music still need an ElevenLabs API key or a connected paid-plan MCP. Stay on the paid plan and do not use Beta-labeled models or features. Continuous VO is in `demo/video/render/narration.txt`.

- Voiceover: ElevenLabs Text to Speech, model `eleven_multilingual_v2` (stable, not `eleven_v3`). Voice: George, `JBFqnCBsd6RMkjVDRZzb`, a calm narrative read. Stability around 0.5, similarity around 0.75, speed 1.0. English, text normalization on. One continuous read of the narration below, then cut to picture. Do not use voice cloning, voice changer, or other Beta or preview features.
- Music: ElevenLabs Music, `music.compose` on `music_v2`, instrumental only, no lyrics. Prompt direction: a quiet, dark, modern underscore, soft pulses and low piano, no melody that fights the voice, no named artists. About 3 minutes, with a gentle close. Fade in under the title card.
- Ducking: keep the bed low under speech, about 8 to 12 dB under the voice. Lift it slightly on the title card and the ending slide, when no one is talking. Fade out in the last second. Do not use music inpainting, finetunes, or other optional Beta workflows.

## Shot list and narration

Takes used: `demo/video/think-takes/clip2.mp4`, `clip3.mp4`, and `clip5-sam.mp4` (1824x1080, Chrome at 100% zoom on THINK). Never use `clip1.mp4` or `clip4-sam.mp4` (they recorded the Grok Bot chat window and contain personal info). Every app shot crops the Chrome tab strip and address bar (top 104 px at 1080 height) and scales to 1920x1080 with no letterbox. Gentle Ken Burns zooms are used so chips, quotes, the refresh status, 4 of 6, and the ALK quote stay readable.

`inferenceSource: on-device` never appears in the takes (that flag lives on the Chart step, and the app jumps to Facts). Do not fake it. The film uses the "On this device" badge and the real status line, "Reading this note on this device with Chrome's on-device model. Nothing is sent to a cloud model."

### 0:00 to 0:03. Title card

Shot: the title slide described above. Hold 3 seconds. Music only.

### 0:03 to 0:15. The patient problem (about 12 seconds)

Shot: a quiet close on the landing. Inclusion, the descriptor "Private clinical-trial matching," the disclaimer, the hybrid diagram. No logos. No tumor-board typography.

Narration: "Trial eligibility is written for researchers, not for the visit you are about to walk into. Inclusion keeps your chart on this computer and turns nearby public trial language into a short briefing for you and your oncologist."

### 0:15 to 0:23. Walk into the chart step

Shot: the landing, then click "Or enter a chart yourself." The Clinic note box is empty, then Alex's note is pasted. Keep the official name in the top bar. The first line of the note, "Synthetic oncology progress note," is scrolled out of the textarea after paste; the "Synthetic demo data" badge stays visible.

Narration: "On a computer that can run Chrome's on-device model, you can paste a synthetic clinic note and read it here."

### 0:23 to 0:46. Nano reads Alex's note (23 seconds)

Shot: recorded on THINK in desktop Chrome at 100% zoom. Click "Read this note on this device." The wait from about 0:16 to 0:37 of clip2 is sped about 5.18x to 4 seconds, with a visible "Sped up" label (no em dash). The status line, "Reading this note on this device with Chrome's on-device model. Nothing is sent to a cloud model," and the "Reading on this device..." button stay in frame. Then cut to the Facts tab: about 20 chips, verbatim quotes, the "On this device" badge, and "Synthetic demo data." Do not show or invent an `inferenceSource: on-device` line.

Narration: "This is Alex Rivera, a synthetic demo patient, not a real person. Gemini Nano reads the note on this device. The fact chips fill in, and an On this device badge stays on the fact sheet. The status line says nothing is sent to a cloud model."

### 0:46 to 0:58. Proof pill (12 seconds)

Shot: zoom the facts header to the "Proof · 0 chart bytes sent" pill. The Outbox drawer was not opened in the usable takes, so do not claim a scroll through Outbox lines.

Narration: "The Proof pill counted 0 chart bytes. Public trial lookups do leave this computer, and they are kept separate from the chart."

### 0:58 to 1:16. Nine strong (18 seconds)

Shot: from clip3, click Compare with nearby trials. Let the counts settle on 9 Strong and 277 trials reviewed. Hold the map and the first card (NCT04486833, Canton, OH, 103 miles). Do not use clip3 from about 15.75s to 18.63s, which records a ClinicalTrials.gov tab.

Narration: "Matching runs on this computer, against a cache of 277 nearby trials. For Alex, this build finds nine strong matches, ranked by strength of evidence. Strong means there is quoted evidence to take to clinic, not a decision that Alex belongs on the study."

### 1:16 to 1:50. Briefing, refresh, and quotes (34 seconds)

Shot: open the NCT04486833 slide-over. Click "Refresh this trial's parse." Hold the running status, "Refreshing the public parse through Firebase AI Logic (two runs, then quote and verifier gates)..." then the completed line, "Refreshed with gemini-3.5-flash-lite. Quote kept 13 and 12; 12 agreed across runs; 7 verified. Unquoted or disagreed items went to Discuss." Pan to the driver row: met, "Requires an EGFR alteration: chart: EGFR exon 19 deletion," plus the trial's own words. This path sends public trial text only.

Narration: "The first card is NCT04486833, an EGFR-mutant study for patients who progressed on osimertinib, with a site in Canton, Ohio, 103 miles from Columbus. The briefing quotes the trial's own words, and it names what the chart shows, including EGFR exon 19 deletion. These are the trial's sentences, not a verdict from the app. Public trial text is parsed in the cloud, twice, through Firebase AI Logic, then checked."

### 1:50 to 2:08. One Discuss item (18 seconds)

Shot: stay on NCT04486833. Hold the briefing's Brain metastases row: "Not checked automatically. Ask: do my brain metastases findings fit this trial?" plus the trial's own words. Do not attribute the "prior EGFR inhibitors" ask to this trial; that ask is on a different card (NCT04719997).

Narration: "It also leaves an honest open question. Brain metastases are not checked automatically, and that still needs a conversation. That is the point of the briefing: what to ask, not what to conclude."

### 2:08 to 2:26. Print sheet, handed to the oncologist (about 18 seconds)

Shot: print-click footage is not in the usable takes. Use the verified Playwright PDF `runbook/evidence/alex-print-sheet-2026-11-12.pdf` (11 pages, not one page). Hold pages 1 and 2 on the dark 1920x1080 ground. Show the print header "Inclusion" and "Private clinical-trial matching," the disclaimer, 9/277, and the ClinicalTrials.gov attribution in plain text. No logos. Do not call it a one-page or short list.

Narration: "Print the sheet and take it to the oncologist. It lists quoted findings and questions, plus the source, ClinicalTrials.gov. The conversation still belongs in the clinic."

### 2:26 to 2:34. Sam's card and the ALK driver (about 8 seconds)

Shot: from clip5-sam, hold 4 Strong, 277, and NCT03093116 (Cincinnati, OH, 2 miles, 4 of 6 key criteria met). Then the briefing: the ALK driver row, "Requires an ALK alteration: chart: ALK rearrangement," and the trial's own words listing ALK, ROS1, and NTRK1-3. Crop above the card's "Ask your oncologist: Does the chart document a ROS1 alteration?" question (a logic bug on an already-met OR criterion; do not deploy a fix for this film, and do not show that question). clip5 never reaches a legitimate Discuss row, so do not invent one and do not claim honest questions for clinic in the VO. Keep "Synthetic demo data" visible. Do not say Sam should enroll.

Narration: "For Sam, this build finds four strong matches. His top card meets four of six key criteria, including the ALK driver."

### 2:34 to 2:42. Ending slide, about 8 seconds

Shot: a still card, typography only, no logos. The app's dark ground. Hold 8 seconds, ending at 2:42.

On-screen text, short enough to read, using the same eval line as the writeup:

"Try it: inclusion-hybridai.web.app. Synthetic patients only. Clinic-note reading needs Chrome's on-device model; the rest works on any Chrome.

What users see: 0 unsafe typed checks on all three held-out sets. Model level: 1 prior-therapy miss on set 3, so prior-therapy rules aren't automated from the parser."

Narration, over the card: "Try the hosted demo. Synthetic patients only. Clinic-note reading needs Chrome's on-device model. The rest works on any Chrome."

End on this slide. No call to enroll, no logo sting, no slogan, and no return to a branded bumper. If the official eval numbers change before a later remux, update the eval line to match the writeup exactly.
