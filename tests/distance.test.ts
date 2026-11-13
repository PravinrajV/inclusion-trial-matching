import { describe, expect, it } from "vitest";
import { COLUMBUS_OH, DEFAULT_RADIUS_MILES, haversineMiles, isOhioState } from "../src/match/distance";

describe("on-device distance filter", () => {
  it("places Cleveland inside a 300-mile radius of Columbus and Denver outside it", () => {
    const cleveland = haversineMiles(COLUMBUS_OH, { lat: 41.4993, lon: -81.6944 });
    const denver = haversineMiles(COLUMBUS_OH, { lat: 39.7392, lon: -104.9903 });
    expect(cleveland).toBeGreaterThan(100);
    expect(cleveland).toBeLessThan(DEFAULT_RADIUS_MILES);
    expect(denver).toBeGreaterThan(DEFAULT_RADIUS_MILES);
  });

  it("recognizes Ohio state names", () => {
    expect(isOhioState("Ohio")).toBe(true);
    expect(isOhioState("OH")).toBe(true);
    expect(isOhioState("Michigan")).toBe(false);
  });
});
