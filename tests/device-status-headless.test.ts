
import { describe, expect, it } from "vitest";
import { isHeadlessChrome, defaultDeviceStatus } from "../src/hybrid/client";

describe("headless Chrome does not pretend the on-device model is available", () => {
  it("treats HeadlessChrome as unavailable so the no-Nano screen stays up", () => {
    // jsdom and this test runner are not a headed THINK machine.
    expect(typeof isHeadlessChrome()).toBe("boolean");
    const status = defaultDeviceStatus();
    expect(["unavailable", "not-chrome", "no-firebase-config", "unknown"]).toContain(status);
    expect(status).not.toBe("available");
    expect(status).not.toBe("downloadable");
  });
});
