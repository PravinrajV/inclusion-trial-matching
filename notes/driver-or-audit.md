# Driver-row OR-list audit

Date: 2026-11-12 (America/New_York). Cache: `public/criteria-cache.json`, 277 trials. Personas: Alex Rivera, Sam Okonkwo, and Jordan Blake (included because the run is cheap). No invented numbers.

## What changed

The old `driverQuotesAreDisjunctive` rule joined every driver-row quote and treated a bare `or` / `and/or` anywhere as enough to mark the row met whenever any sibling was met, including over a `not_met` sibling.

The new rule, in `src/ui/driver-or.ts`, only covers an UNKNOWN sibling when that gene and a met gene sit in the same quoted list joined by "or" or "and/or" (for example "ALK, ROS1, NTRK1, NTRK2, or NTRK3"). A `not_met` sibling always wins. A bare "or" elsewhere in the sentence ("histologically or cytologically", "stage III or IV") does not apply the override.

While comparing old and new picks, `kindKey` in `src/ui/matrix.ts` was also corrected so `egfr_min` (kidney function) is grouped as a lab, not as a driver. The driver prefix `egfr_` had been matching `egfr_min` before the labs list was checked. That grouping bug is not an OR-list flip. After the grouping fix, hero numbers were unchanged: Alex 9 Strong, first card NCT04486833 at 4 of 6; Sam 4 Strong, first card NCT03093116 at 4 of 6.

## Flip count (old OR rule vs new OR rule, after the egfr_min grouping fix)

Across 277 trials:

| Persona        | Driver rows flipped | Strong / Possible / Unlikely after the change |
|----------------|--------------------:|-----------------------------------------------|
| Alex Rivera    |                   4 | 9 / 198 / 70 (unchanged)                      |
| Sam Okonkwo    |                   4 | 4 / 200 / 73 (unchanged)                      |
| Jordan Blake   |                   1 | 0 / 94 / 183 (unchanged)                      |
| **Total**      |               **9** |                                               |

Every flip was hand-checked against the trial's quoted eligibility text below. All nine are safer displays. None are on a Strong card. None change 9 / 4 Strong or the 4 of 6 key-criteria tally on the hero first cards.

## Hand-checked flips

### 1. Alex Rivera, NCT04614103, met to not_met, already Unlikely

Quote: "Have historically or pathologically confirmed diagnosis of metastatic Stage IV NSCLC without EGFR, ALK, or ROS1 genomic alterations."

Alex has EGFR present, ALK absent, ROS1 unknown. The typed checks are EGFR `not_met`, ALK `met`, ROS1 `unknown`. The "or" list is an absence requirement (no EGFR and no ALK and no ROS1), not an inclusion OR. The old rule hid the EGFR miss behind the met ALK sibling and showed the driver row as met. The new rule keeps `not_met`. The trial was already Unlikely because of that EGFR `not_met` check. Correct flip.

### 2. Alex Rivera, NCT05098132, met to not_met, already Unlikely

Quote: "No known actionable EGFR, ALK, ROS1, or other actionable genomic aberrations for which there is a local standard of care available as front line therapy."

Same pattern as (1): EGFR `not_met`, ALK `met`, ROS1 `unknown`. Old rule showed met. New rule shows `not_met`. Already Unlikely. Correct flip.

### 3. Alex Rivera, NCT06096844, met to not_met, already Unlikely

Quote: "Patient must have a tumor that is negative for EGFR mutation/ALK translocations or other actionable first line mutations in which patients would receive first-line oral tyrosine kinase inhibitors."

EGFR `not_met`, ALK `met`. Old rule showed met. New rule shows `not_met`. Already Unlikely. Correct flip.

### 4. Alex Rivera, NCT06561386, met to not_met, already Unlikely

Quote: "Participants with epidermal growth factor receptor (EGFR), anaplastic lymphoma kinase (ALK), or ROS-1 mutations that are sensitive to available targeted inhibitor therapy. Participants with unknown EGFR, ALK, or ROS-1 status are excluded."

This is an exclusion for people who have EGFR or ALK or ROS1 alterations. Alex has EGFR, so EGFR is `not_met`, ALK (absent) is `met`, ROS1 is `unknown`. The old rule showed the driver row as met. The new rule shows `not_met`. Already Unlikely. Correct flip.

### 5. Sam Okonkwo, NCT04614103, met to not_met, already Unlikely

Same trial and quote as (1). Sam has ALK present, EGFR absent, ROS1 unknown, so ALK is `not_met` and EGFR is `met`. The old rule showed met. The new rule shows `not_met`. Already Unlikely. Correct flip.

### 6. Sam Okonkwo, NCT05098132, met to not_met, already Unlikely

Same trial and quote as (2). ALK `not_met`, EGFR `met`, ROS1 `unknown`. Correct flip; already Unlikely.

### 7. Sam Okonkwo, NCT06096844, met to not_met, already Unlikely

Same trial and quote as (3). ALK `not_met`, EGFR `met`. Correct flip; already Unlikely.

### 8. Sam Okonkwo, NCT06561386, met to not_met, already Unlikely

Same trial and quote as (4). ALK `not_met`, EGFR `met`, ROS1 `unknown`. Correct flip; already Unlikely.

### 9. Jordan Blake, NCT05098132, met to unknown, Possible

Same quote as (2): "No known actionable EGFR, ALK, ROS1, or other actionable genomic aberrations..."

Jordan has EGFR absent (`met`), ALK absent (`met`), and ROS1 unknown. The trial needs ROS1 to be known-absent as well. The old rule saw a bare "or" and two met genes and showed the driver row as met. The new rule leaves the row as unknown / Discuss. The trial stays Possible. Correct flip.

## Sam on NCT03093116 (no flip; expected keep)

Sam's top Strong card, NCT03093116, quotes "an ALK, ROS1, NTRK1, NTRK2, or NTRK3 gene rearrangement." ALK is `met` and ROS1 is `unknown`. The new rule still marks the driver row met, because those genes sit in the same quoted OR list, and it no longer asks about ROS1 in `askYourOncologistItems`. That is the intended keep, not a flip.

## Raw machine output

`notes/driver-or-tki-audit-raw.json` has the machine comparison used for this audit.
