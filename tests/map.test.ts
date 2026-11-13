import { describe, expect, it } from "vitest";
import {
  COLUMBUS,
  HOME_CLEARANCE_MILES,
  HOME_LABEL_OFFSET_Y,
  clearOfHome,
  clusterMarkers,
  isAtHome,
  projectMiles,
  toSvg,
  type MapMarker,
} from "../src/ui/map";

describe("offline region map", () => {
  it("projects Columbus to the origin", () => {
    const p = projectMiles(COLUMBUS.lat, COLUMBUS.lon);
    expect(Math.abs(p.x)).toBeLessThan(0.001);
    expect(Math.abs(p.y)).toBeLessThan(0.001);
    const s = toSvg(COLUMBUS.lat, COLUMBUS.lon);
    expect(s.x).toBeCloseTo(0, 5);
    expect(s.y).toBeCloseTo(0, 5);
  });

  it("clusters nearby sites and keeps the strongest tier", () => {
    const markers: MapMarker[] = [
      { nctId: "NCT1", title: "A", tier: "possible", lat: 39.96, lon: -83.0, visible: true },
      { nctId: "NCT2", title: "B", tier: "strong", lat: 39.961, lon: -83.002, visible: true },
      { nctId: "NCT3", title: "C", tier: "possible", lat: 41.5, lon: -81.7, visible: false },
    ];
    const clusters = clusterMarkers(markers);
    expect(clusters).toHaveLength(2);
    const columbus = clusters.find((c) => c.markers.some((m) => m.nctId === "NCT1"));
    expect(columbus?.bestTier).toBe("strong");
    expect(columbus?.markers).toHaveLength(2);
  });

  it("places the origin city label below the pin, clear of the halo", () => {
    expect(HOME_LABEL_OFFSET_Y).toBeGreaterThan(20);
  });

  it("pushes a label that sits on the home pin away, preferring above the city name", () => {
    const p = clearOfHome(0, 0, 0, 0);
    expect(p.y).toBeLessThan(0);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(HOME_CLEARANCE_MILES);
    const alreadyClear = clearOfHome(0, -80, 0, 0);
    expect(alreadyClear).toEqual({ x: 0, y: -80 });
  });

  it("treats a site at the origin as sitting on the home pin", () => {
    const h = toSvg(COLUMBUS.lat, COLUMBUS.lon);
    const s = toSvg(COLUMBUS.lat, COLUMBUS.lon);
    expect(isAtHome(s.x, s.y, h.x, h.y)).toBe(true);
    const far = toSvg(41.5, -81.7);
    expect(isAtHome(far.x, far.y, h.x, h.y)).toBe(false);
  });
});
