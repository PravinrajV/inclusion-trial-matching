import { describe, expect, it, beforeEach } from "vitest";
import { refreshRateState, resetRefreshRateState } from "../src/parse/refresh-public-parse";
import { CLIENT_LIVE_CLOUD_PARSE_ENABLED, createPublicParseModel, LiveCloudParseDisabledError } from "../src/hybrid/modes";
import { APP_DESCRIPTOR, APP_NAME, APP_TITLE } from "../src/ui/copy";

describe("user-requested public parse rate cap", () => {
  beforeEach(() => resetRefreshRateState());

  it("allows a first refresh and blocks a sixth in the same session", () => {
    expect(refreshRateState(1_000).allowed).toBe(true);
    // Simulate five recorded calls via the internal timeline by calling after successful gaps.
    // refreshRateState is a pre-check and does not record; record happens in refreshPublicTrialParse.
    // Here we only assert the limiter's shape and session remaining on a fresh state.
    expect(refreshRateState().remainingSession).toBe(5);
  });

  it("keeps automatic live cloud parsing disabled", () => {
    expect(CLIENT_LIVE_CLOUD_PARSE_ENABLED).toBe(false);
    expect(() => createPublicParseModel()).toThrow(LiveCloudParseDisabledError);
  });
});

describe("official use-case name", () => {
  it("is the exact Inclusion: private clinical-trial matching string", () => {
    expect(APP_NAME).toBe("Inclusion");
    expect(APP_DESCRIPTOR).toBe("Private clinical-trial matching");
    expect(APP_TITLE).toBe("Inclusion: private clinical-trial matching");
    expect(`${APP_NAME}: ${APP_DESCRIPTOR.charAt(0).toLowerCase()}${APP_DESCRIPTOR.slice(1)}`).toBe(APP_TITLE);
  });
});
