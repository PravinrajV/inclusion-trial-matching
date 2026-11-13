import { describe, expect, it } from "vitest";
import { InferenceMode as SdkInferenceMode } from "firebase/ai";
import {
  assertChartInferenceMode,
  CHART_INFERENCE_MODE,
  ForbiddenChartModeError,
  InferenceMode,
  mustUseSelfEntryForm,
  PUBLIC_PARSE_INFERENCE_MODE,
  CLIENT_LIVE_CLOUD_PARSE_ENABLED,
  createPublicParseModel,
  LiveCloudParseDisabledError,
} from "../src/hybrid/modes";

describe("hybrid inference modes", () => {
  it("locks local constants to the Firebase AI Logic SDK values", () => {
    expect(InferenceMode.ONLY_ON_DEVICE).toBe(SdkInferenceMode.ONLY_ON_DEVICE);
    expect(InferenceMode.PREFER_ON_DEVICE).toBe(SdkInferenceMode.PREFER_ON_DEVICE);
    expect(InferenceMode.ONLY_IN_CLOUD).toBe(SdkInferenceMode.ONLY_IN_CLOUD);
    expect(InferenceMode.PREFER_IN_CLOUD).toBe(SdkInferenceMode.PREFER_IN_CLOUD);
    expect(CHART_INFERENCE_MODE).toBe("only_on_device");
    expect(PUBLIC_PARSE_INFERENCE_MODE).toBe("only_in_cloud");
  });

  it("rejects PREFER_ON_DEVICE for chart reads", () => {
    expect(() => assertChartInferenceMode(InferenceMode.PREFER_ON_DEVICE)).toThrow(ForbiddenChartModeError);
    expect(() => assertChartInferenceMode(InferenceMode.ONLY_IN_CLOUD)).toThrow(ForbiddenChartModeError);
    expect(() => assertChartInferenceMode(InferenceMode.ONLY_ON_DEVICE)).not.toThrow();
  });

  it("falls back to the self-entry form when the on-device model is missing", () => {
    expect(mustUseSelfEntryForm("unavailable")).toBe(true);
    expect(mustUseSelfEntryForm("not-chrome")).toBe(true);
    expect(mustUseSelfEntryForm("no-firebase-config")).toBe(true);
    expect(mustUseSelfEntryForm("available")).toBe(false);
    expect(mustUseSelfEntryForm("downloadable")).toBe(false);
  });

  it("keeps live cloud parsing disabled in the client so a judge visit cannot call Gemini", () => {
    expect(CLIENT_LIVE_CLOUD_PARSE_ENABLED).toBe(false);
    expect(() => createPublicParseModel()).toThrow(LiveCloudParseDisabledError);
  });
});
