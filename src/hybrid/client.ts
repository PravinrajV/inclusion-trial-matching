import { initializeApp, type FirebaseApp } from "firebase/app";
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode as SdkInferenceMode, type GenerativeModel } from "firebase/ai";
import { parserResponseSchema } from "../../scripts/parser-response-schema.mjs";
import {
  assertChartInferenceMode,
  CHART_INFERENCE_MODE,
  InferenceMode,
  mustUseSelfEntryForm,
  type DeviceModelStatus,
} from "./modes";

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export function readFirebaseConfig(): FirebaseWebConfig | null {
  const env = import.meta.env;
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  const storageBucket = env.VITE_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID;
  const appId = env.VITE_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) {
    return null;
  }
  return { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };
}

export function createFirebaseApp(config: FirebaseWebConfig): FirebaseApp {
  return initializeApp(config);
}

export function initAppCheck(app: FirebaseApp): void {
  const debug = import.meta.env.VITE_APPCHECK_DEBUG === "true";
  if (debug && typeof self !== "undefined") {
    // Debug tokens are for local machines only. Never ship this flag on.
    // A registered token string is preferred; otherwise Chrome prints a
    // fresh token that still has to be safelisted in the Firebase console.
    const registered = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN?.trim();
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      registered && registered !== "true" ? registered : true;
  }
  const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim();
  if (!siteKey && !debug) {
    throw new Error("Set VITE_RECAPTCHA_ENTERPRISE_SITE_KEY, or enable the App Check debug flag for local work.");
  }
  // Production uses reCAPTCHA Enterprise (score-based web key) on Spark,
  // Essentials tier, with no billing. Debug-only localhost should not load
  // reCAPTCHA. Never ship VITE_APPCHECK_DEBUG or a debug token in a public build.
  const provider = siteKey
    ? new ReCaptchaEnterpriseProvider(siteKey)
    : new CustomProvider({
        getToken: () =>
          Promise.reject(
            new Error("App Check debug is on, and no reCAPTCHA Enterprise site key is configured."),
          ),
      });
  initializeAppCheck(app, {
    provider,
    isTokenAutoRefreshEnabled: true,
  });
}

/**
 * Chart model factory. The mode argument is required so tests can prove
 * that PREFER_ON_DEVICE is rejected.
 */
export function createChartModel(app: FirebaseApp, mode: string = CHART_INFERENCE_MODE): GenerativeModel {
  assertChartInferenceMode(mode);
  if (SdkInferenceMode.ONLY_ON_DEVICE !== InferenceMode.ONLY_ON_DEVICE) {
    throw new Error("SDK InferenceMode.ONLY_ON_DEVICE does not match the locked value only_on_device");
  }
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, { mode: SdkInferenceMode.ONLY_ON_DEVICE });
}

/** Headless Chromium can advertise LanguageModel as "downloadable" even though the interactive on-device path is not supported there. */
export function isHeadlessChrome(): boolean {
  if (typeof navigator === "undefined") return true;
  return /HeadlessChrome/i.test(navigator.userAgent || "");
}

export function defaultDeviceStatus(): DeviceModelStatus {
  if (typeof window === "undefined") return "not-chrome";
  if (isHeadlessChrome()) return "unavailable";
  const hasPromptApi = "LanguageModel" in window;
  if (!hasPromptApi) return "not-chrome";
  if (!readFirebaseConfig()) return "no-firebase-config";
  return "unknown";
}

/**
 * Ask Chrome whether the on-device model can actually run. "unknown" must not
 * stay the status on a THINK machine that has the Prompt API: that would hide
 * the clinic-note paste path. Headless Chrome is forced to the no-Nano path.
 */
export async function probeDeviceModelStatus(): Promise<DeviceModelStatus> {
  const base = defaultDeviceStatus();
  if (base === "not-chrome" || base === "no-firebase-config" || base === "unavailable") return base;
  const LanguageModel = (window as unknown as { LanguageModel?: { availability?: (opts?: object) => Promise<string> } }).LanguageModel;
  if (!LanguageModel?.availability) return "unavailable";
  try {
    const availability = await LanguageModel.availability();
    if (availability === "available") return "available";
    if (availability === "downloadable") return "downloadable";
    if (availability === "downloading") return "downloading";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Chart extraction model. Mode is locked to ONLY_ON_DEVICE. A missing on-device
 * model cannot fall back to the cloud.
 */
export function createChartExtractModel(app: FirebaseApp, _systemInstruction: string): GenerativeModel {
  assertChartInferenceMode(CHART_INFERENCE_MODE);
  if (SdkInferenceMode.ONLY_ON_DEVICE !== InferenceMode.ONLY_ON_DEVICE) {
    throw new Error("SDK InferenceMode.ONLY_ON_DEVICE does not match the locked value only_on_device");
  }
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, { mode: SdkInferenceMode.ONLY_ON_DEVICE });
}

/**
 * User-initiated public-trial parse. Called only from the rate-capped
 * "Refresh this trial's parse" action, behind App Check, with public
 * eligibility text only. This is the client AI Logic cloud call path.
 * Automatic page-load parsing stays disabled (CLIENT_LIVE_CLOUD_PARSE_ENABLED).
 */
export function createUserRequestedPublicParseModel(app: FirebaseApp, systemInstruction: string): GenerativeModel {
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, {
    mode: SdkInferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: "gemini-3.5-flash-lite",
      systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: parserResponseSchema(),
      },
    },
  });
}

export { mustUseSelfEntryForm };
