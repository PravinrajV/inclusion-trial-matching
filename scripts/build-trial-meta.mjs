#!/usr/bin/env node
/**
 * Slim structured ClinicalTrials.gov fields for on-device ranking.
 * Source: data/ctgov/region-trials.json (already pulled). Does not call the network.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = JSON.parse(readFileSync(join(root, "data/ctgov/region-trials.json"), "utf8"));

const trials = (src.trials || []).map((t) => {
  const sites = (t.regionalSites || []).map((s) => {
    const row = { city: s.city || "", state: s.state || "" };
    if (s.lat != null) row.lat = s.lat;
    if (s.lon != null) row.lon = s.lon;
    if (s.facility) row.facility = s.facility;
    return row;
  });
  return {
    nctId: t.nctId,
    briefTitle: t.briefTitle || "",
    officialTitle: t.officialTitle || "",
    overallStatus: t.overallStatus || "",
    phases: t.phases || [],
    conditions: t.conditions || [],
    keywords: t.keywords || [],
    interventions: t.interventions || [],
    sites,
  };
});

const out = {
  dataTimestamp: src.meta?.dataTimestampFromApi || src.meta?.dataTimestamp || null,
  trials,
};
const json = `${JSON.stringify(out)}\n`;
const dests = [join(root, "public/trial-meta.json")];
for (const dest of dests) {
  writeFileSync(dest, json);
  console.log(`Wrote ${trials.length} trials to ${dest}`);
}
