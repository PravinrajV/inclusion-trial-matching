import { describe, expect, it } from "vitest";
import {
  bundledSnapshotMessage,
  classifyCacheError,
  resolvePublicCache,
} from "../src/cache/resolve";
import type { CriteriaCache } from "../src/cache/load";

const local: CriteriaCache = {
  trials: [{ nctId: "NCT00000001" } as CriteriaCache["trials"][number]],
  source: "local",
  dataTimestamp: "2026-11-10T10:00:05",
};

describe("classifyCacheError", () => {
  it("classifies a real anonymous sign-in failure as auth", () => {
    expect(classifyCacheError({ code: "auth/operation-not-allowed", message: "Anonymous sign-in is disabled." }).kind).toBe("auth");
    expect(classifyCacheError({ code: "auth/unauthorized-domain", message: "This domain is not authorized." }).kind).toBe("auth");
  });

  it("classifies App Check failures separately from Auth", () => {
    expect(classifyCacheError(new Error("AppCheck: 403 exchangeDebugToken failed")).kind).toBe("app-check");
    expect(
      classifyCacheError({
        code: "appCheck/initial-throttle",
        message: "Unable to call the reCAPTCHA Enterprise CreateAssessment method",
      }).kind,
    ).toBe("app-check");
    expect(
      classifyCacheError(
        new Error(
          "Error while retrieving App Check token: FirebaseError: AppCheck: 400 error. (appCheck/initial-throttle).",
        ),
      ).kind,
    ).toBe("app-check");
    expect(classifyCacheError(new Error("reCAPTCHA App Check token missing")).kind).toBe("app-check");
  });

  it("does not treat post-sign-in Auth SDK or Firestore errors as a sign-in failure", () => {
    expect(classifyCacheError({ code: "auth/network-request-failed", message: "Failed to fetch" }).kind).not.toBe("auth");
    expect(classifyCacheError(new Error("Missing or insufficient permissions.")).kind).not.toBe("auth");
  });

  it("classifies quota and network failures", () => {
    expect(classifyCacheError({ code: "resource-exhausted", message: "429 Quota exceeded" }).kind).toBe("quota");
    expect(classifyCacheError(new Error("Failed to fetch")).kind).toBe("network");
  });
});

describe("resolvePublicCache", () => {
  it("uses Firestore when it returns trials and does not fall back", () => {
    const remote: CriteriaCache = { trials: local.trials, source: "firestore" };
    const out = resolvePublicCache({ remote, local: { trials: [], source: "empty" } });
    expect(out.fallback).toBe(false);
    expect(out.level).toBe("ok");
    expect(out.cache.source).toBe("firestore");
    expect(out.message).toContain("Firestore");
    expect(out.message).not.toContain("Could not sign in");
  });

  it("shows a calm snapshot note when the live path fails and the bundled cache loads", () => {
    const auth = resolvePublicCache({
      error: classifyCacheError({ code: "auth/operation-not-allowed", message: "disabled" }),
      local,
    });
    expect(auth.fallback).toBe(true);
    expect(auth.level).toBe("fallback");
    expect(auth.cache.source).toBe("local");
    expect(auth.message).toBe(bundledSnapshotMessage(1));
    expect(auth.message).toBe("Using the bundled public trial snapshot (1 trial).");
    expect(auth.message).not.toContain("Could not sign in");

    const check = resolvePublicCache({
      error: classifyCacheError(new Error("reCAPTCHA App Check token missing")),
      local,
    });
    expect(check.message).toBe(bundledSnapshotMessage(1));
    expect(check.message).not.toContain("App Check");
    expect(check.message).not.toContain("Could not sign in");

    const many: CriteriaCache = {
      ...local,
      trials: Array.from({ length: 277 }, (_, i) => ({ nctId: `NCT${String(i).padStart(8, "0")}` }) as CriteriaCache["trials"][number]),
    };
    const snapshot = resolvePublicCache({
      error: classifyCacheError({ code: "failed-precondition", message: "CreateAssessment" }),
      local: many,
    });
    expect(snapshot.message).toBe("Using the bundled public trial snapshot (277 trials).");
  });

  it("falls back on a quota or network error instead of leaving the cache empty", () => {
    const quota = resolvePublicCache({
      error: classifyCacheError({ code: "resource-exhausted", message: "quota" }),
      local,
    });
    expect(quota.level).toBe("fallback");
    expect(quota.cache.trials).toHaveLength(1);
    expect(quota.message).toBe(bundledSnapshotMessage(1));

    const net = resolvePublicCache({
      error: classifyCacheError(new Error("Failed to fetch")),
      local,
    });
    expect(net.message).toBe(bundledSnapshotMessage(1));
  });

  it("says could not sign in only when sign-up failed and the bundled cache is also empty", () => {
    const out = resolvePublicCache({
      error: classifyCacheError({ code: "auth/operation-not-allowed", message: "disabled" }),
      local: { trials: [], source: "empty" },
    });
    expect(out.level).toBe("empty");
    expect(out.message).toContain("Could not sign in anonymously");
    expect(out.message).toContain("briefing cannot run");
  });

  it("does not mention sign-in on an empty cache when the failure was App Check or network", () => {
    const check = resolvePublicCache({
      error: classifyCacheError(new Error("AppCheck: 400 CreateAssessment")),
      local: { trials: [], source: "empty" },
    });
    expect(check.level).toBe("empty");
    expect(check.message).toContain("App Check");
    expect(check.message).not.toContain("Could not sign in");

    const net = resolvePublicCache({
      error: classifyCacheError(new Error("Failed to fetch")),
      local: { trials: [], source: "empty" },
    });
    expect(net.message).toContain("Could not reach Firestore");
    expect(net.message).not.toContain("Could not sign in");
  });
});
