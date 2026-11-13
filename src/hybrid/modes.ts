/**
 * Firebase AI Logic inference modes, kept in lockstep with the JS SDK
 * (firebase@13.3.0, package firebase/ai). Chart calls may only use
 * ONLY_ON_DEVICE so a missing model cannot silently fall back to the cloud.
 *
 * Source: https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options
 * SDK values (from @firebase/ai typings):
 *   PREFER_ON_DEVICE = "prefer_on_device"
 *   ONLY_ON_DEVICE   = "only_on_device"
 *   ONLY_IN_CLOUD    = "only_in_cloud"
 *   PREFER_IN_CLOUD  = "prefer_in_cloud"
 */

export const InferenceMode = {
  PREFER_ON_DEVICE: "prefer_on_device",
  ONLY_ON_DEVICE: "only_on_device",
  ONLY_IN_CLOUD: "only_in_cloud",
  PREFER_IN_CLOUD: "prefer_in_cloud",
} as const;

export type InferenceMode = (typeof InferenceMode)[keyof typeof InferenceMode];

/** Every call that reads a patient's chart or fact sheet. */
export const CHART_INFERENCE_MODE: InferenceMode = InferenceMode.ONLY_ON_DEVICE;

/** Public trial eligibility parsing, run once and cached. */
export const PUBLIC_PARSE_INFERENCE_MODE: InferenceMode = InferenceMode.ONLY_IN_CLOUD;

export class ForbiddenChartModeError extends Error {
  constructor(mode: string) {
    super(
      `Chart reads must use ONLY_ON_DEVICE, not ${mode}. PREFER_ON_DEVICE is not allowed because it can send the chart to the cloud if the on-device model is missing.`,
    );
    this.name = "ForbiddenChartModeError";
  }
}

export function assertChartInferenceMode(mode: string): asserts mode is typeof CHART_INFERENCE_MODE {
  if (mode !== CHART_INFERENCE_MODE) {
    throw new ForbiddenChartModeError(mode);
  }
}

export type DeviceModelStatus =
  | "unknown"
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available"
  | "no-firebase-config"
  | "not-chrome";

/**
 * If the on-device model cannot be used, the app never sends the chart to
 * the cloud. It switches to the short self-entry form instead.
 */
export function mustUseSelfEntryForm(status: DeviceModelStatus): boolean {
  return status !== "available" && status !== "downloadable" && status !== "downloading";
}


/**
 * Automatic / page-load live cloud parsing stays off so a judge visit does not
 * call Gemini on its own. An explicit, rate-capped "Refresh this trial's parse"
 * action is a separate path (see createUserRequestedPublicParseModel).
 */
export const CLIENT_LIVE_CLOUD_PARSE_ENABLED = false;

export class LiveCloudParseDisabledError extends Error {
  constructor() {
    super("Live cloud parsing is disabled in the client. Use the cached public trial records.");
    this.name = "LiveCloudParseDisabledError";
  }
}

export function assertClientLiveCloudParseDisabled(): void {
  if (CLIENT_LIVE_CLOUD_PARSE_ENABLED) {
    throw new Error("CLIENT_LIVE_CLOUD_PARSE_ENABLED must stay false so a judge visit never triggers a live Gemini call.");
  }
}

/** Factory kept as a hard stop if anything in the client tries to parse public trial text live. */
export function createPublicParseModel(): never {
  assertClientLiveCloudParseDisabled();
  throw new LiveCloudParseDisabledError();
}
