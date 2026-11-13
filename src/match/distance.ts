export interface LatLon {
  lat: number;
  lon: number;
}

/** Statute miles, WGS-84 mean Earth radius. */
export function haversineMiles(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.7613;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function isOhioState(state: string | null | undefined): boolean {
  if (!state) return false;
  const s = state.trim().toLowerCase();
  return s === "ohio" || s === "oh";
}

export const COLUMBUS_OH: LatLon & { label: string } = {
  lat: 39.9612,
  lon: -82.9988,
  label: "Columbus, OH",
};

export const DEFAULT_RADIUS_MILES = 300;
