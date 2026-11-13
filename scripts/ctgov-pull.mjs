/**
 * Pull recruiting non-small cell lung cancer studies from the
 * ClinicalTrials.gov Data API v2 and filter to the Inclusion region.
 *
 * The client must never send a location with a ClinicalTrials.gov search.
 * This script is a server/admin job. It queries by condition and recruiting
 * status only (plus a United States location string, which is not a patient
 * location), then applies the Ohio + 300-mile filter locally.
 *
 * Pace: one request per second, exponential backoff on 429/5xx.
 * No API key is used or required.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "ctgov");
const RAW = join(OUT, "raw");

const API = "https://clinicaltrials.gov/api/v2";
const USER_AGENT = "Inclusion/0.1 (hackathon research pull; condition-only NSCLC cache; contact via project README)";

// Columbus, OH. All of Ohio sits inside a 300-mile radius of Columbus,
// so "Ohio plus about 300 miles" is this circle plus any Ohio site
// whose geoPoint is missing.
export const COLUMBUS = { lat: 39.9612, lon: -82.9988, label: "Columbus, OH" };
export const RADIUS_MILES = 300;

const FIELDS = [
  "NCTId",
  "BriefTitle",
  "OfficialTitle",
  "OverallStatus",
  "Phase",
  "StudyType",
  "EligibilityCriteria",
  "HealthyVolunteers",
  "Sex",
  "MinimumAge",
  "MaximumAge",
  "StdAge",
  "Condition",
  "Keyword",
  "LocationFacility",
  "LocationCity",
  "LocationState",
  "LocationZip",
  "LocationCountry",
  "LocationGeoPoint",
  "LocationStatus",
  "BriefSummary",
  "InterventionName",
  "LeadSponsorName",
  "LastUpdatePostDate",
  "StartDate",
  "HasResults",
  "OrgStudyId",
].join(",");

const SEARCH = {
  "query.cond": "non-small cell lung cancer",
  "filter.overallStatus": "RECRUITING",
  "query.locn": "United States",
  countTotal: "true",
  pageSize: "50",
  fields: FIELDS,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function haversineMiles(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.7613;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function isOhioState(state) {
  if (!state) return false;
  const s = state.trim().toLowerCase();
  return s === "ohio" || s === "oh";
}

async function getJson(url, attempt = 0) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) {
      throw new Error(`Gave up on ${url} after ${attempt} retries (${res.status})`);
    }
    const wait = Math.min(60_000, 1000 * 2 ** attempt);
    console.error(`HTTP ${res.status}, waiting ${wait}ms`);
    await sleep(wait);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

function buildUrl(pageToken) {
  const params = new URLSearchParams(SEARCH);
  if (pageToken) params.set("pageToken", pageToken);
  return `${API}/studies?${params.toString()}`;
}

function locationsOf(study) {
  return study?.protocolSection?.contactsLocationsModule?.locations ?? [];
}

function classifySite(loc) {
  const country = (loc.country ?? "").trim();
  const geo = loc.geoPoint;
  const ohio = isOhioState(loc.state);
  let miles = null;
  if (geo && typeof geo.lat === "number" && typeof geo.lon === "number") {
    miles = haversineMiles(COLUMBUS, { lat: geo.lat, lon: geo.lon });
  }
  const inRadius = miles !== null && miles <= RADIUS_MILES;
  const inRegion = (country === "United States" || country === "USA") && (ohio || inRadius);
  return { inRegion, ohio, miles, inRadius };
}

const STAGE_ADVANCED =
  /\b(stage\s*(iii|iiia|iiib|iiic|3|3a|3b|3c|iv|iva|ivb|4|4a|4b)|locally\s+advanced|unresectable|metastatic|advanced\s+(nsclc|non[-\s]?small)|recurrent)\b/i;
const STAGE_EARLY_HINT =
  /\b(stage\s*(i|ia|ib|ii|iia|iib|1|1a|1b|2|2a|2b)\b|early[-\s]?stage|resectable\s+(stage|nsclc)|adjuvant|neoadjuvant)\b/i;

function textBlob(study) {
  const p = study.protocolSection ?? {};
  const bits = [
    p.identificationModule?.briefTitle,
    p.identificationModule?.officialTitle,
    p.descriptionModule?.briefSummary,
    p.eligibilityModule?.eligibilityCriteria,
    ...(p.conditionsModule?.conditions ?? []),
    ...(p.conditionsModule?.keywords ?? []),
  ];
  return bits.filter(Boolean).join("\n");
}

function stageFlags(study) {
  const text = textBlob(study);
  return {
    mentionsAdvancedOrIIIOrIV: STAGE_ADVANCED.test(text),
    mentionsEarlyStageLanguage: STAGE_EARLY_HINT.test(text),
  };
}

function slimStudy(study) {
  const p = study.protocolSection ?? {};
  const id = p.identificationModule ?? {};
  const status = p.statusModule ?? {};
  const elig = p.eligibilityModule ?? {};
  const design = p.designModule ?? {};
  const flags = stageFlags(study);
  const allLocs = locationsOf(study);
  const regionalSites = [];
  const seen = new Set();
  for (const loc of allLocs) {
    const c = classifySite(loc);
    if (!c.inRegion) continue;
    const key = [loc.facility, loc.city, loc.state, loc.zip].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    regionalSites.push({
      facility: loc.facility ?? null,
      city: loc.city ?? null,
      state: loc.state ?? null,
      zip: loc.zip ?? null,
      country: loc.country ?? null,
      status: loc.status ?? null,
      lat: loc.geoPoint?.lat ?? null,
      lon: loc.geoPoint?.lon ?? null,
      milesFromColumbus: c.miles !== null ? Math.round(c.miles * 10) / 10 : null,
      inOhio: c.ohio,
    });
  }
  regionalSites.sort((a, b) => (a.milesFromColumbus ?? 9999) - (b.milesFromColumbus ?? 9999));
  return {
    nctId: id.nctId,
    briefTitle: id.briefTitle ?? null,
    officialTitle: id.officialTitle ?? null,
    overallStatus: status.overallStatus ?? null,
    lastUpdatePostDate: status.lastUpdatePostDateStruct?.date ?? null,
    startDate: status.startDateStruct?.date ?? null,
    studyType: design.studyType ?? null,
    phases: design.phases ?? [],
    leadSponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name ?? null,
    conditions: p.conditionsModule?.conditions ?? [],
    keywords: p.conditionsModule?.keywords ?? [],
    interventions: (p.armsInterventionsModule?.interventions ?? []).map((i) => i.name).filter(Boolean),
    sex: elig.sex ?? null,
    minimumAge: elig.minimumAge ?? null,
    maximumAge: elig.maximumAge ?? null,
    stdAges: elig.stdAges ?? [],
    healthyVolunteers: elig.healthyVolunteers ?? null,
    eligibilityCriteria: elig.eligibilityCriteria ?? null,
    briefSummary: p.descriptionModule?.briefSummary ?? null,
    stage: flags,
    regionalSiteCount: regionalSites.length,
    regionalSites,
  };
}

function summarize(slims) {
  const withOhio = slims.filter((s) => s.regionalSites.some((l) => l.inOhio));
  const advanced = slims.filter((s) => s.stage.mentionsAdvancedOrIIIOrIV);
  const earlyOnly = slims.filter(
    (s) => s.stage.mentionsEarlyStageLanguage && !s.stage.mentionsAdvancedOrIIIOrIV,
  );
  const both = slims.filter(
    (s) => s.stage.mentionsAdvancedOrIIIOrIV && s.stage.mentionsEarlyStageLanguage,
  );
  const neither = slims.filter(
    (s) => !s.stage.mentionsAdvancedOrIIIOrIV && !s.stage.mentionsEarlyStageLanguage,
  );
  return {
    regionTrials: slims.length,
    withAtLeastOneOhioSite: withOhio.length,
    mentionsAdvancedOrStageIIIOrIV: advanced.length,
    earlyStageLanguageWithoutAdvanced: earlyOnly.length,
    mentionsBothAdvancedAndEarlyLanguage: both.length,
    noStageLanguageMatched: neither.length,
    medianRegionalSites: median(slims.map((s) => s.regionalSiteCount)),
    maxRegionalSites: Math.max(0, ...slims.map((s) => s.regionalSiteCount)),
  };
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  const retrievedAt = new Date().toISOString();
  const version = await getJson(`${API}/version`);
  writeFileSync(join(OUT, "version.json"), JSON.stringify(version, null, 2) + "\n");
  console.log("API version", version);

  const pages = [];
  let token;
  let page = 0;
  let totalCount = null;
  do {
    if (page > 0) await sleep(1000);
    page += 1;
    const url = buildUrl(token);
    console.log(`Fetching page ${page}...`);
    const data = await getJson(url);
    if (totalCount === null) totalCount = data.totalCount ?? null;
    writeFileSync(join(RAW, `page-${String(page).padStart(3, "0")}.json`), JSON.stringify(data) + "\n");
    pages.push(data);
    token = data.nextPageToken;
    console.log(`  studies so far: ${pages.reduce((n, p) => n + (p.studies?.length ?? 0), 0)} / ${totalCount}`);
  } while (token);

  const studies = pages.flatMap((p) => p.studies ?? []);
  if (totalCount !== null && studies.length !== totalCount) {
    console.error(`Warning: got ${studies.length} studies, API totalCount was ${totalCount}`);
  }

  const slims = [];
  let usStudies = 0;
  for (const study of studies) {
    const nct = study.protocolSection?.identificationModule?.nctId;
    const locs = locationsOf(study);
    const hasUs = locs.some((l) => l.country === "United States" || l.country === "USA");
    if (hasUs) usStudies += 1;
    const slim = slimStudy(study);
    if (slim.regionalSiteCount > 0) slims.push(slim);
  }
  slims.sort((a, b) => a.nctId.localeCompare(b.nctId));

  const counts = {
    source: "ClinicalTrials.gov Data API v2",
    attribution: "ClinicalTrials.gov, National Library of Medicine, National Institutes of Health",
    apiVersion: version.apiVersion ?? null,
    dataTimestampFromApi: version.dataTimestamp ?? null,
    retrievedAtUtc: retrievedAt,
    search: {
      "query.cond": SEARCH["query.cond"],
      "filter.overallStatus": SEARCH["filter.overallStatus"],
      "query.locn": SEARCH["query.locn"],
      note: "Location in this admin search is the country string 'United States', not a patient city. The 300-mile / Ohio filter is applied on the pulled records, not by filter.geo.",
    },
    region: {
      center: COLUMBUS,
      radiusMiles: RADIUS_MILES,
      rule: "A trial is in the region if it has at least one United States site in Ohio, or with a geoPoint within 300 miles of Columbus, OH (39.9612, -82.9988). Distance is a haversine in statute miles. Sites with no geoPoint are included only when the state is Ohio.",
    },
    apiTotalCountForSearch: totalCount,
    studiesPulled: studies.length,
    studiesWithAtLeastOneUsSite: usStudies,
    ...summarize(slims),
    modifications: [
      "Restricted the field list to the FIELDS array in scripts/ctgov-pull.mjs (not the full study record).",
      "Dropped trials with no regional site.",
      "Kept only regional sites on each slim record, with a computed milesFromColumbus field.",
      "Added heuristic stage flags from title, summary, conditions and eligibility text. These flags are not official ClinicalTrials.gov fields.",
    ],
  };

  writeFileSync(join(OUT, "counts.json"), JSON.stringify(counts, null, 2) + "\n");
  writeFileSync(join(OUT, "region-trials.json"), JSON.stringify({ meta: counts, trials: slims }, null, 2) + "\n");

  const md = `# Regional recruiting NSCLC pull

Source: ClinicalTrials.gov Data API v2. Attribute the data to ClinicalTrials.gov.
Data timestamp as returned by \`GET /api/v2/version\`: ${counts.dataTimestampFromApi}
Retrieved (UTC): ${counts.retrievedAtUtc}

## Search

- \`query.cond\`: ${SEARCH["query.cond"]}
- \`filter.overallStatus\`: ${SEARCH["filter.overallStatus"]}
- \`query.locn\`: ${SEARCH["query.locn"]}
- The Ohio + 300-mile cut is applied locally, not with \`filter.geo\`.

## Counts

- API totalCount for that search: **${counts.apiTotalCountForSearch}**
- Studies actually pulled: **${counts.studiesPulled}**
- Of those, with at least one US site: **${counts.studiesWithAtLeastOneUsSite}**
- In the Inclusion region (Ohio or within ${RADIUS_MILES} miles of Columbus): **${counts.regionTrials}**
- Of the regional set, with at least one Ohio site: **${counts.withAtLeastOneOhioSite}**
- Regional trials whose title, summary, conditions or eligibility mention stage III/IV, metastatic, locally advanced, unresectable, or recurrent disease: **${counts.mentionsAdvancedOrStageIIIOrIV}**
- Regional trials with early-stage language and no advanced/III/IV language: **${counts.earlyStageLanguageWithoutAdvanced}**
- Regional trials that mention both: **${counts.mentionsBothAdvancedAndEarlyLanguage}**
- Regional trials with no matched stage language: **${counts.noStageLanguageMatched}**
- Median regional sites per trial: ${counts.medianRegionalSites}
- Max regional sites on one trial: ${counts.maxRegionalSites}

The stage flags are a local heuristic, not a ClinicalTrials.gov field. The cached parser still has to read eligibility and decide whether a study is in scope for stage III/IV NSCLC.

## Modifications

${counts.modifications.map((m) => `- ${m}`).join("\n")}
`;
  writeFileSync(join(OUT, "counts.md"), md);
  console.log(JSON.stringify(counts, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
