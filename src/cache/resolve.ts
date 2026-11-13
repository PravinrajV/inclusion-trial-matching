import type { CriteriaCache } from "./load";

export type CacheErrorKind = "auth" | "app-check" | "quota" | "network" | "unknown";

export interface ClassifiedCacheError {
  kind: CacheErrorKind;
  detail: string;
}

export interface PublicCacheResult {
  cache: CriteriaCache;
  fallback: boolean;
  level: "ok" | "fallback" | "empty";
  message: string;
}

/** Firebase Auth codes that mean anonymous sign-up itself failed. */
const SIGN_IN_FAILURE_CODES = [
  "auth/operation-not-allowed",
  "auth/admin-restricted-operation",
  "auth/unauthorized-domain",
  "auth/invalid-api-key",
  "auth/api-key-not-valid.",
  "auth/app-deleted",
  "auth/app-not-authorized",
];

export function classifyCacheError(err: unknown): ClassifiedCacheError {
  const detail = err instanceof Error ? err.message : String(err);
  const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code || "") : "";
  const blob = `${code} ${detail}`.toLowerCase();
  if (
    blob.includes("appcheck") ||
    blob.includes("app-check") ||
    blob.includes("app check") ||
    blob.includes("recaptcha") ||
    blob.includes("attestation") ||
    blob.includes("exchangerecaptcha") ||
    blob.includes("createassessment")
  ) {
    return { kind: "app-check", detail };
  }
  if (isAnonymousSignInFailure(code, blob)) {
    return { kind: "auth", detail };
  }
  if (
    blob.includes("quota") ||
    blob.includes("resource-exhausted") ||
    blob.includes("resource exhausted") ||
    (blob.includes("429") && !blob.includes("appcheck"))
  ) {
    return { kind: "quota", detail };
  }
  if (
    blob.includes("network") ||
    blob.includes("failed to fetch") ||
    blob.includes("offline") ||
    blob.includes("unavailable") ||
    blob.includes("failed-precondition")
  ) {
    return { kind: "network", detail };
  }
  return { kind: "unknown", detail };
}

/** True only when anonymous sign-up itself failed, not for App Check or Firestore errors. */
export function isAnonymousSignInFailure(code: string, blob: string): boolean {
  const c = code.toLowerCase();
  const b = blob.toLowerCase();
  if (SIGN_IN_FAILURE_CODES.some((item) => c === item || b.includes(item))) return true;
  return false;
}

export function bundledSnapshotMessage(count: number): string {
  const noun = count === 1 ? "trial" : "trials";
  return `Using the bundled public trial snapshot (${count} ${noun}).`;
}

function reasonLine(error: ClassifiedCacheError): string {
  if (error.kind === "auth") {
    return "Could not sign in anonymously, so Firestore was not read.";
  }
  if (error.kind === "app-check") {
    return "App Check or reCAPTCHA could not verify this app, so Firestore was not read.";
  }
  if (error.kind === "quota") {
    return "A Firebase quota was reached, so Firestore was not read.";
  }
  if (error.kind === "network") {
    return "Could not reach Firestore.";
  }
  return "Could not read the public trial cache from Firestore.";
}

export function resolvePublicCache(opts: {
  remote?: CriteriaCache | undefined;
  error?: ClassifiedCacheError | undefined;
  local: CriteriaCache;
}): PublicCacheResult {
  const remoteOk = Boolean(opts.remote && opts.remote.trials.length);
  if (remoteOk && opts.remote) {
    return {
      cache: opts.remote,
      fallback: false,
      level: "ok",
      message: describeLoaded(opts.remote, "Firestore"),
    };
  }
  if (opts.local.trials.length) {
    // Live path failed (or was skipped) and the bundled snapshot loaded.
    // Keep this a calm info line. Do not mention sign-in unless sign-up failed,
    // and even then the public banner stays the snapshot note.
    return {
      cache: opts.local,
      fallback: true,
      level: "fallback",
      message: bundledSnapshotMessage(opts.local.trials.length),
    };
  }
  const lead = opts.error ? reasonLine(opts.error) + " " : "";
  return {
    cache: { trials: [], source: "empty" },
    fallback: true,
    level: "empty",
    message: `${lead}Public trial records could not be loaded from Firestore or the bundled cache. The briefing cannot run without them.`,
  };
}

function describeLoaded(cache: CriteriaCache, src: string): string {
  const when = cache.dataTimestamp ? ` ClinicalTrials.gov dataTimestamp ${cache.dataTimestamp}.` : "";
  return `Loaded ${cache.trials.length} public trial records from ${src}.${when}`;
}
