# Sam's ALK driver row: proof for the display fix

This note records why the writeup can say Sam's top card meets 4 of 6 key criteria, including the ALK driver. It uses the bundled cache and the current ranking code. It does not invent trial language.

## The trial's own words

Sam's top Strong card is NCT03093116. In `public/criteria-cache.json`, the typed `ros1_status` check carries this evidence quote, copied from the trial eligibility text:

> Histologically or cytologically confirmed diagnosis of locally advanced, or metastatic solid tumor (including primary CNS tumors) (Stage IV, American Joint Committee on Cancer v.7) that harbors an ALK, ROS1, NTRK1, NTRK2, or NTRK3 gene rearrangement by protocol specified tests.

That sentence lists ALK, ROS1, or NTRK as alternatives (an OR list), not a joint EGFR-and-ALK requirement.

## The fix is general

`src/ui/matrix.ts` defines `driverQuotesAreDisjunctive` and `pickMatrixItem`. For the driver row, if the quoted trial language contains "or" or "and/or", and any driver check is met, the row shows that met check. An unknown check for a different gene in the same sentence does not hide it. An AND requirement still uses worst-wins. The rule is not special-cased to NCT03093116 or to Sam.

A local structured ALK check for Sam (chart: ALK rearrangement) is therefore shown as met on this trial, with the quote above.

## Unit test

`tests/matrix.test.ts` includes this exact NCT03093116 quote and asserts that a met ALK check is shown when ROS1 is unknown. It also asserts that a "both EGFR and ALK" quote still uses worst-wins, and that the labs row is unchanged.

## Gold scores are unchanged

The ranking change is display-only. It does not alter the cloud parser or the held-out score files. Official pipeline scores remain in `notes/accuracy-raw/set{1,2,3}-ai-logic-score.json` and `notes/accuracy-raw/ai-logic-score-summary.json` (ran 2026-11-12T13:30:18Z, pipeline `ai-logic-v3-quote-two-run-verifier`):

- Set 1: 41/87, 0 unsafe
- Set 2: 70/131, 0 unsafe
- Set 3: 46/94, 1 unsafe (prior_therapy_excluded, NCT06170788, U16)

## Current hero numbers

Re-run on 12 November 2026 against `public/criteria-cache.json`, saved at `notes/hero-check-2026-11-12-tenth-man.json`:

- Sam: 4 Strong, 200 Possible, 73 Unlikely, 277 reviewed. First card NCT03093116, 4 of 6 key criteria met, including ALK, nearest site Cincinnati, OH, 2 miles.
- Alex: 9 Strong, 198 Possible, 70 Unlikely. First card NCT04486833, 4 of 6, including EGFR, nearest site Canton, OH, 103 miles.

`bothHeroesOk` is true.
