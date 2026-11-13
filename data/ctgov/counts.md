# Regional recruiting NSCLC pull

Source: ClinicalTrials.gov Data API v2. Attribute the data to ClinicalTrials.gov.
Data timestamp as returned by `GET /api/v2/version`: 2026-11-10T10:00:05
Retrieved (UTC): 2026-11-11T23:10:04.865Z

## Search

- `query.cond`: non-small cell lung cancer
- `filter.overallStatus`: RECRUITING
- `query.locn`: United States
- The Ohio + 300-mile cut is applied locally, not with `filter.geo`.

## Counts

- API totalCount for that search: **519**
- Studies actually pulled: **519**
- Of those, with at least one US site: **519**
- In the Inclusion region (Ohio or within 300 miles of Columbus): **277**
- Of the regional set, with at least one Ohio site: **152**
- Regional trials whose title, summary, conditions or eligibility mention stage III/IV, metastatic, locally advanced, unresectable, or recurrent disease: **250**
- Regional trials with early-stage language and no advanced/III/IV language: **12**
- Regional trials that mention both: **85**
- Regional trials with no matched stage language: **15**
- Median regional sites per trial: 2
- Max regional sites on one trial: 286

The stage flags are a local heuristic, not a ClinicalTrials.gov field. The cached parser still has to read eligibility and decide whether a study is in scope for stage III/IV NSCLC.

## Modifications

- Restricted the field list to the FIELDS array in scripts/ctgov-pull.mjs (not the full study record).
- Dropped trials with no regional site.
- Kept only regional sites on each slim record, with a computed milesFromColumbus field.
- Added heuristic stage flags from title, summary, conditions and eligibility text. These flags are not official ClinicalTrials.gov fields.
