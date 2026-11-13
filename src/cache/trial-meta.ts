import { haversineMiles } from "../match/distance";
import type { HomeLocation } from "../schema/fact-sheet";

export interface TrialSite {
  city: string;
  state: string;
  lat?: number;
  lon?: number;
  facility?: string;
}

export interface TrialMeta {
  nctId: string;
  phases: string[];
  sites: TrialSite[];
  briefTitle?: string;
  officialTitle?: string;
  overallStatus?: string;
  conditions?: string[];
  keywords?: string[];
  interventions?: string[];
}

export interface NearestSite {
  city: string;
  state: string;
  facility?: string;
  miles?: number;
  label: string;
}

export async function loadTrialMeta(url = "/trial-meta.json"): Promise<Map<string, TrialMeta>> {
  const map = new Map<string, TrialMeta>();
  try {
    const res = await fetch(url);
    if (!res.ok) return map;
    const data = (await res.json()) as { trials?: TrialMeta[] };
    for (const row of data.trials || []) {
      if (row?.nctId) map.set(row.nctId, row);
    }
  } catch {
    // Meta is optional. The briefing still works without sites or phase.
  }
  return map;
}

export function formatPhase(phases: string[] | undefined): string | null {
  const nums = (phases || [])
    .map((p) => {
      const m = String(p).toUpperCase().match(/(\d)/);
      return m ? m[1] : "";
    })
    .filter((n) => n && n !== "0");
  const unique = [...new Set(nums)];
  if (!unique.length) return null;
  return unique.length === 1 ? `Phase ${unique[0]}` : `Phase ${unique.join("/")}`;
}

export function nearestSite(home: HomeLocation | null | undefined, sites: TrialSite[] | undefined): NearestSite | null {
  if (!sites?.length) return null;
  if (home && Number.isFinite(home.lat) && Number.isFinite(home.lon)) {
    let best: { site: TrialSite; miles: number } | null = null;
    for (const site of sites) {
      if (site.lat == null || site.lon == null) continue;
      const miles = haversineMiles({ lat: home.lat, lon: home.lon }, { lat: site.lat, lon: site.lon });
      if (!best || miles < best.miles) best = { site, miles };
    }
    if (best) {
      const out: NearestSite = {
        city: best.site.city,
        state: best.site.state,
        miles: Math.round(best.miles),
        label: `${formatPlace(best.site)}, ${Math.round(best.miles)} miles`,
      };
      if (best.site.facility) out.facility = best.site.facility;
      return out;
    }
  }
  const first = sites[0];
  if (!first) return null;
  const out: NearestSite = { city: first.city, state: first.state, label: formatPlace(first) };
  if (first.facility) out.facility = first.facility;
  return out;
}

export function formatPlace(site: { city?: string; state?: string }): string {
  const city = (site.city || "").trim();
  const state = abbreviateState((site.state || "").trim());
  if (city && state) return `${city}, ${state}`;
  return city || state || "Regional site";
}

function abbreviateState(state: string): string {
  if (!state) return "";
  if (state.length <= 3) return state.toUpperCase();
  const map: Record<string, string> = {
    ohio: "OH",
    kentucky: "KY",
    indiana: "IN",
    michigan: "MI",
    pennsylvania: "PA",
    "west virginia": "WV",
  };
  return map[state.toLowerCase()] || state;
}
