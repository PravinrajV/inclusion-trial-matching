# ClinicalTrials.gov API v2: terms, attribution, and rate limits

Read on Wednesday, November 11, 2026 (America/New_York). These notes are from the official pages listed below, plus a live check of the API. Nothing here is legal advice.

## Official pages

- Terms and Conditions: https://clinicaltrials.gov/about-site/terms-conditions
  Last updated on that page: January 31, 2023.
- API landing page: https://clinicaltrials.gov/data-api/api
  Last updated on that page: August 26, 2025.
- About the API: https://clinicaltrials.gov/data-api/about-api
- Disclaimer: https://clinicaltrials.gov/about-site/disclaimer
- OpenAPI URL cited by the API page: https://clinicaltrials.gov/api/oas/v2/ctg-oas-v2.yaml
- Version endpoint: https://clinicaltrials.gov/api/v2/version
- Studies endpoint: https://clinicaltrials.gov/api/v2/studies

Local copies of the rendered pages are in `notes/sources/`, taken with headless Chrome the same day.

## Terms that matter for Inclusion

From the Terms and Conditions (https://clinicaltrials.gov/about-site/terms-conditions). The terms apply to all ClinicalTrials.gov data, "independent of format and method of acquisition." Downloading the data means accepting them. They stay in effect as long as we retain any of the data.

The data are available to all requesters, in and outside the United States, at no charge. No API key is required. A live `GET` to `/api/v2/studies` and `/api/v2/version` on November 11, 2026 succeeded without authentication.

In any publication or distribution of the data, we should:

1. Attribute the source of the data as ClinicalTrials.gov.
2. Update the data such that they are current at all times.
3. Clearly display the date the data were processed by ClinicalTrials.gov.
4. State any modifications made to the content of the data, along with a complete description of the modifications.

We shall not assert proprietary rights to any portion of the database, or represent the database or any part of it as other than a United States Government database.

We shall not use any email addresses extracted from the database for marketing or other promotional purposes.

The data carry an international copyright outside the United States and its Territories or Possessions. Some records may also be subject to the copyright of third parties.

The government makes no warranties and assumes no liability for use of the data.

For Inclusion that means:

- The app and the README will attribute trial records to ClinicalTrials.gov, in text. Contest rule 6 bars third-party logos, so we will not use the ClinicalTrials.gov or NLM marks, wordmarks, or logo files.
- Every cached record and the UI will show the `dataTimestamp` from `GET /api/v2/version`, which is the date ClinicalTrials.gov last processed the data, plus the time we retrieved it.
- We will spell out our modifications: a reduced field list, a local Ohio + 300-mile site filter, computed distances, and heuristic stage flags. Parsed eligibility checks are our derived work, not a ClinicalTrials.gov field.
- The cache has to be re-pulled before submission so the copy we ship is current. Data on the site is refreshed daily Monday through Friday, generally by 9:00 a.m. ET (14:00 UTC), per the API page. Check `/api/v2/version` before a pull; do not assume the refresh has finished just because the clock says it should have.
- We will not scrape or use investigator email addresses.

## What the API page actually says

- Current documented API version from a live call on November 11, 2026: `apiVersion` 2.0.5, `dataTimestamp` `2026-11-10T10:00:05` (the API does not include a timezone offset on that field; recorded as returned).
- The API page still links to the OpenAPI document at https://clinicaltrials.gov/api/oas/v2/ctg-oas-v2.yaml. That URL returned HTTP 404 on November 11, 2026.
- Notice to API users (August 26, 2025): a modernized data ingest changed some "markup" fields and the source of locations and geopoint data.
- CORS: a request sent with `Origin: https://example.web.app` received `access-control-allow-origin: *`. A browser app could query the API directly. That is why the Outbox and the condition-only search rule exist. The client must not send a city, state, or `filter.geo` value, because that would be health-adjacent information leaving the laptop. Distance filtering happens on the device against the cached sites.

## Rate limits

This is the important gap.

The Terms and Conditions, the API landing page, About the API, and the live `/api/v2/studies` response headers on November 11, 2026 do not publish a numeric rate limit. The response had no `RateLimit-*`, `X-RateLimit-*`, or `Retry-After` headers. I am not going to invent a requests-per-minute number.

Third-party writeups disagree with each other (some say "about 50 requests per minute," others borrow NCBI E-utilities figures). Those are not official ClinicalTrials.gov policy, and they are not used as a limit here.

Practice for our admin pull, until NLM publishes a number:

- One request per second, with exponential backoff on HTTP 429 or 5xx, capped at about a minute.
- A short, honest `User-Agent`.
- Prefer a scheduled server-side pull and a Firestore cache over live pagination from the browser.
- If we ever receive a 429, log it and slow down further.

The November 11 pull of 519 studies (11 pages plus a version call, paced at one request per second) completed without a 429.

## How Inclusion uses the API

The admin script `scripts/ctgov-pull.mjs` searches with:

- `query.cond=non-small cell lung cancer`
- `filter.overallStatus=RECRUITING`
- `query.locn=United States` (a country string, not a patient city)

It then keeps a trial only if at least one United States site is in Ohio or has a `geoPoint` within 300 miles of Columbus, OH (39.9612, -82.9988), using a haversine in statute miles. That filter is local. We do not send `filter.geo` from the client.

Writes to the criteria cache will be server-side only, once per schema version.
