#!/usr/bin/env node
/**
 * Bundle a public-domain US state outline clip (us-atlas, derived from
 * Natural Earth / US Census cartographic boundaries) for the Ohio + 300 mi
 * command map. Runtime never fetches tiles or a network atlas.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { feature } from "topojson-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const topo = JSON.parse(readFileSync(join(root, "node_modules/us-atlas/states-10m.json"), "utf8"));
const geo = feature(topo, topo.objects.states);

const KEEP = new Set([
  "Ohio",
  "Indiana",
  "Kentucky",
  "Michigan",
  "Pennsylvania",
  "West Virginia",
  "Illinois",
  "Virginia",
  "Maryland",
  "Tennessee",
  "Wisconsin",
  "North Carolina",
]);

function simplifyRing(ring, minDeg) {
  if (ring.length < 8) return ring;
  const out = [ring[0]];
  for (let i = 1; i < ring.length - 1; i += 1) {
    const prev = out[out.length - 1];
    const cur = ring[i];
    const dx = cur[0] - prev[0];
    const dy = cur[1] - prev[1];
    if (dx * dx + dy * dy >= minDeg * minDeg) out.push(cur);
  }
  out.push(ring[ring.length - 1]);
  return out.length >= 4 ? out : ring;
}

function simplifyCoords(coords, minDeg) {
  if (typeof coords[0][0] === "number") return simplifyRing(coords, minDeg);
  return coords.map((c) => simplifyCoords(c, minDeg));
}

const features = geo.features
  .filter((f) => KEEP.has(f.properties?.name))
  .map((f) => ({
    type: "Feature",
    properties: { name: f.properties.name, isOhio: f.properties.name === "Ohio" },
    geometry: {
      type: f.geometry.type,
      coordinates: simplifyCoords(f.geometry.coordinates, 0.02),
    },
  }));

const out = {
  type: "FeatureCollection",
  attribution:
    "State outlines derived from us-atlas (Natural Earth / U.S. Census cartographic boundaries). Public domain. Bundled locally; no map tiles are loaded at runtime.",
  features,
};

const destDir = join(root, "public/map");
mkdirSync(destDir, { recursive: true });
const dest = join(destDir, "region-states.json");
writeFileSync(dest, `${JSON.stringify(out)}\n`);
console.log(`Wrote ${features.length} states to ${dest} (${Math.round(JSON.stringify(out).length / 1024)} KB)`);
