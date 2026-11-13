import { icon } from "./icons";
/** Offline command map: bundled US state outlines, no tiles, no network. */

export const COLUMBUS = { lat: 39.9612, lon: -82.9988 };
const MILES_PER_DEG_LAT = 69.172;
const VIEW_MILES = 340;
const RINGS = [50, 150, 300] as const;

export interface MapHome {
  lat: number;
  lon: number;
  city?: string;
  state?: string;
}

export interface MapMarker {
  nctId: string;
  title: string;
  tier: "strong" | "possible" | "unlikely";
  lat: number;
  lon: number;
  city?: string;
  state?: string;
  miles?: number;
  visible: boolean;
}

interface GeoFeature {
  type: string;
  properties: { name: string; isOhio?: boolean };
  geometry: { type: string; coordinates: unknown };
}

interface GeoCollection {
  type: string;
  attribution?: string;
  features: GeoFeature[];
}

let atlasPromise: Promise<GeoCollection> | null = null;

export function loadRegionAtlas(): Promise<GeoCollection> {
  if (!atlasPromise) {
    atlasPromise = fetch("/map/region-states.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load the local map atlas (${r.status}).`);
        return r.json() as Promise<GeoCollection>;
      })
      .catch((err) => {
        atlasPromise = null;
        throw err;
      });
  }
  return atlasPromise;
}

export function projectMiles(lat: number, lon: number, origin = COLUMBUS): { x: number; y: number } {
  const cos = Math.cos((origin.lat * Math.PI) / 180);
  return {
    x: (lon - origin.lon) * cos * MILES_PER_DEG_LAT,
    y: (lat - origin.lat) * MILES_PER_DEG_LAT,
  };
}

/** SVG coords: origin at center, +y down, 1 unit = 1 mile. */
export function toSvg(lat: number, lon: number): { x: number; y: number } {
  const p = projectMiles(lat, lon);
  return { x: p.x, y: -p.y };
}

function ringPath(coords: unknown, depth = 0): string {
  if (!Array.isArray(coords) || coords.length === 0) return "";
  const first = coords[0];
  if (typeof first === "number") return "";
  if (Array.isArray(first) && typeof first[0] === "number") {
    const pts = (coords as number[][]).map(([lon, lat]) => toSvg(lat, lon));
    if (pts.length < 2) return "";
    return `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")} Z`;
  }
  return (coords as unknown[]).map((c) => ringPath(c, depth + 1)).join(" ");
}

export interface MapCluster {
  id: string;
  lat: number;
  lon: number;
  city?: string;
  state?: string;
  bestTier: "strong" | "possible" | "unlikely";
  markers: MapMarker[];
}

export function clusterMarkers(markers: MapMarker[]): MapCluster[] {
  const buckets = new Map<string, MapMarker[]>();
  for (const m of markers) {
    const key = `${m.lat.toFixed(2)},${m.lon.toFixed(2)}`;
    const list = buckets.get(key);
    if (list) list.push(m);
    else buckets.set(key, [m]);
  }
  const rank = { strong: 0, possible: 1, unlikely: 2 };
  const clusters: MapCluster[] = [];
  for (const [, list] of buckets) {
    const first = list[0];
    const best = list.reduce((a, b) => (rank[a.tier] < rank[b.tier] ? a : b));
    const item: MapCluster = {
      id: list.map((m) => m.nctId).sort().join("|"),
      lat: first.lat,
      lon: first.lon,
      bestTier: best.tier,
      markers: list,
    };
    if (first.city) item.city = first.city;
    if (first.state) item.state = first.state;
    clusters.push(item);
  }
  return clusters;
}

/** Miles below the home pin for the origin city label. Clears the halo at 1280, 1440, and mobile. */
export const HOME_LABEL_OFFSET_Y = 32;
/** Keep other labels at least this far (miles) from the home pin and its city label. */
export const HOME_CLEARANCE_MILES = 56;

/** Push a point off the home pin, preferring above so it does not sit on the city label below. */
export function clearOfHome(
  x: number,
  y: number,
  hx: number,
  hy: number,
  min = HOME_CLEARANCE_MILES,
): { x: number; y: number } {
  const dx = x - hx;
  const dy = y - hy;
  const d = Math.hypot(dx, dy);
  if (d >= min) return { x, y };
  if (d < 0.01 || dy >= 0) return { x: hx, y: hy - min };
  const s = min / d;
  return { x: hx + dx * s, y: hy + dy * s };
}

export function isAtHome(x: number, y: number, hx: number, hy: number, radius = 20): boolean {
  return Math.hypot(x - hx, y - hy) < radius;
}

function placeLabel(
  name: string,
  geometry: GeoFeature["geometry"],
  home: { x: number; y: number },
): string {
  const pts: { x: number; y: number }[] = [];
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords) || coords.length === 0) return;
    if (typeof coords[0] === "number") return;
    if (Array.isArray(coords[0]) && typeof coords[0][0] === "number") {
      for (const p of coords as number[][]) pts.push(toSvg(p[1], p[0]));
      return;
    }
    for (const c of coords as unknown[]) walk(c);
  };
  walk(geometry.coordinates);
  if (!pts.length) return "";
  const raw = {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
  const pt = clearOfHome(raw.x, raw.y, home.x, home.y);
  return `<text class="map-label" x="${pt.x.toFixed(1)}" y="${pt.y.toFixed(1)}">${escapeMap(name)}</text>`;
}

function escapeMap(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function siteLabel(c: MapCluster): string {
  if (c.city && c.state) return `${c.city}, ${c.state}`;
  return c.city || c.state || "Trial site";
}

function shortTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= 72) return t;
  return `${t.slice(0, 69).replace(/\s+\S*$/, "")}…`;
}

export function clusterTip(c: MapCluster, place: string): string {
  const lines = c.markers.slice(0, 3).map((m) => {
    const miles = m.miles == null ? "" : ` · ${m.miles} miles`;
    return `${shortTitle(m.title || m.nctId)}${miles}`;
  });
  const more = c.markers.length > 3 ? `\n+${c.markers.length - 3} more` : "";
  return `${place}\n${lines.join("\n")}${more}`;
}

export function renderRegionMap(opts: {
  atlas: GeoCollection;
  home: MapHome | null;
  markers: MapMarker[];
  selectedNctId?: string | null;
}): string {
  const features = opts.atlas.features;
  const states = features
    .map((f) => {
      const d = ringPath(f.geometry.coordinates);
      const cls = f.properties.isOhio ? "map-state is-ohio" : "map-state";
      return `<path class="${cls}" data-state="${escapeMap(f.properties.name)}" d="${d}" />`;
    })
    .join("");
  const home = opts.home && Number.isFinite(opts.home.lat) && Number.isFinite(opts.home.lon) ? opts.home : COLUMBUS;
  const hp = toSvg(home.lat, home.lon);
  const labels = features
    .filter((f) => ["Ohio", "Indiana", "Kentucky", "Michigan", "Pennsylvania", "West Virginia"].includes(f.properties.name))
    .map((f) => placeLabel(f.properties.name.toUpperCase(), f.geometry, hp))
    .join("");
  const rings = RINGS.map((r) => `<circle class="map-ring" data-miles="${r}" cx="${hp.x.toFixed(2)}" cy="${hp.y.toFixed(2)}" r="${r}" />`).join("");
  const ringAngle = (22 * Math.PI) / 180;
  const ringLabels = RINGS.map((r) => {
    const x = hp.x + r * Math.cos(ringAngle);
    const y = hp.y - r * Math.sin(ringAngle);
    return `<g class="map-ring-tag" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <rect class="map-ring-plate" x="-16" y="-7" width="32" height="14" rx="3" />
      <text class="map-ring-label" text-anchor="middle" dominant-baseline="middle" y="0.6">${r} mi</text>
    </g>`;
  }).join("");
  const homeCity = opts.home?.city || "Home";
  const homePin = `<g class="map-home" transform="translate(${hp.x.toFixed(2)} ${hp.y.toFixed(2)})">
      <circle class="map-home-halo" r="10" />
      <circle class="map-home-dot" r="3.6" />
      <text class="map-home-label" x="0" y="${HOME_LABEL_OFFSET_Y}" text-anchor="middle">${escapeMap(homeCity)}</text>
    </g>`;

  const clusters = clusterMarkers(opts.markers);
  const selected = opts.selectedNctId ?? null;
  const dots = clusters
    .map((c) => {
      const p = toSvg(c.lat, c.lon);
      const active = selected ? c.markers.some((m) => m.nctId === selected) : false;
      const highlight = c.markers.some((m) => m.visible);
      const n = c.markers.length;
      const ncts = c.markers.map((m) => m.nctId).join(",");
      const size = c.bestTier === "strong" ? 5.2 : c.bestTier === "possible" ? 4.2 : 3.2;
      const count = n > 1 ? `<text class="map-count" y="1.2">${n}</text>` : "";
      const tip = clusterTip(c, siteLabel(c));
      const pinLabel = escapeMap(siteLabel(c));
      const atHome = isAtHome(p.x, p.y, hp.x, hp.y);
      const siteText = atHome ? "" : `<text class="map-site-label" x="22" y="-14">${pinLabel}</text>`;
      return `<g class="map-site${active ? " is-selected" : ""}${highlight ? " is-shown" : ""}${atHome ? " is-home-site" : ""}" data-ncts="${escapeMap(ncts)}" data-tier="${c.bestTier}" data-label="${escapeMap(siteLabel(c))}" data-tip="${escapeMap(tip)}" transform="translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})">
        <circle class="map-site-hit" r="12" />
        <circle class="map-site-dot" r="${size}" />
        ${count}
        ${siteText}
      </g>`;
    })
    .join("");

  const vb = `${-VIEW_MILES} ${-VIEW_MILES} ${VIEW_MILES * 2} ${VIEW_MILES * 2}`;
  return `<svg class="region-map" viewBox="${vb}" role="img" aria-label="Offline map of Ohio and a 300-mile region, with the patient's home and nearby trial sites.">
    <title>Ohio and nearby trial sites</title>
    <rect class="map-sea" x="${-VIEW_MILES}" y="${-VIEW_MILES}" width="${VIEW_MILES * 2}" height="${VIEW_MILES * 2}" />
    <g class="map-states">${states}</g>
    <g class="map-rings" aria-hidden="true">${rings}${ringLabels}</g>
    <g class="map-labels" aria-hidden="true">${labels}</g>
    <g class="map-sites">${dots}</g>
    ${homePin}
  </svg>
  <div class="map-tooltip" id="map-tooltip" hidden></div>
  <button type="button" class="map-info" id="map-info" aria-expanded="false" aria-controls="map-info-tip" aria-label="About this map">${icon("info")}</button>
  <div class="map-info-tip" id="map-info-tip" hidden>${escapeMap(opts.atlas.attribution || "State outlines are bundled from public-domain sources. No map tiles are loaded.")}</div>`;
}

export function bindRegionMap(
  host: HTMLElement,
  handlers: {
    onHover: (nctIds: string[]) => void;
    onLeave: () => void;
    onSelect: (nctIds: string[]) => void;
  },
): void {
  const tooltip = host.querySelector("#map-tooltip") as HTMLElement | null;
  const sites = host.querySelectorAll<SVGGElement>(".map-site");
  for (const site of sites) {
    const ncts = (site.getAttribute("data-ncts") || "").split(",").filter(Boolean);
    const label = site.getAttribute("data-label") || "Trial site";
    const showTip = (): void => {
      if (!tooltip) return;
      tooltip.hidden = false;
      tooltip.textContent = site.getAttribute("data-tip") || label;
    };
    const hideTip = (): void => {
      if (tooltip) tooltip.hidden = true;
    };
    site.addEventListener("pointerenter", () => {
      showTip();
      handlers.onHover(ncts);
    });
    site.addEventListener("pointerleave", () => {
      hideTip();
      handlers.onLeave();
    });
    site.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handlers.onSelect(ncts);
    });
    site.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        handlers.onSelect(ncts);
      }
    });
    site.setAttribute("tabindex", "0");
    site.setAttribute("role", "button");
    site.setAttribute("aria-label", `${label}, ${ncts.length} ${ncts.length === 1 ? "trial" : "trials"}`);
  }
  const infoBtn = host.querySelector("#map-info") as HTMLButtonElement | null;
  const infoTip = host.querySelector("#map-info-tip") as HTMLElement | null;
  if (infoBtn && infoTip) {
    const toggle = (open?: boolean): void => {
      const next = open ?? infoTip.hidden;
      infoTip.hidden = !next;
      infoBtn.setAttribute("aria-expanded", next ? "true" : "false");
    };
    infoBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggle();
    });
    infoBtn.addEventListener("pointerenter", () => toggle(true));
    infoBtn.addEventListener("pointerleave", () => toggle(false));
    infoBtn.addEventListener("blur", () => toggle(false));
  }
}

export function syncMapSelection(host: HTMLElement, nctId: string | null): void {
  for (const site of host.querySelectorAll(".map-site")) {
    const ncts = (site.getAttribute("data-ncts") || "").split(",");
    site.classList.toggle("is-selected", Boolean(nctId && ncts.includes(nctId)));
  }
}
