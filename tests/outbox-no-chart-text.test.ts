import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertConditionOnlySearch,
  buildConditionOnlySearchUrl,
  ChartTextBlockedError,
  createOutbox,
  networkLabel,
  PUBLIC_QUERY_LABEL,
  LOCAL_CACHE_LABEL,
} from "../src/outbox/interceptor";
import { findChartLeaks } from "../src/outbox/chart-guard";
import { emptyFactSheet, factSheetSnippets } from "../src/schema/fact-sheet";

const CHART = `Oncology progress note. 62-year-old with stage IV lung adenocarcinoma, EGFR exon 19 deletion, progressed on osimertinib. ECOG 1. No untreated brain metastases. Lives near the Scioto River trail in Columbus.`;

describe("chart leak scanner", () => {
  it("finds plain chart text in a JSON body", () => {
    const leaks = findChartLeaks({ body: JSON.stringify({ prompt: CHART }) }, [CHART]);
    expect(leaks.some((l) => l.foundIn === "body" && l.encoding === "plain")).toBe(true);
  });

  it("finds URI-encoded chart text in a URL", () => {
    const url = `https://generativelanguage.googleapis.com/v1/models?q=${encodeURIComponent(CHART)}`;
    const leaks = findChartLeaks({ url }, [CHART]);
    expect(leaks.some((l) => l.foundIn === "url" && l.encoding === "uri")).toBe(true);
  });

  it("finds base64-encoded chart text in a body", () => {
    const body = btoa(CHART);
    const leaks = findChartLeaks({ body }, [CHART]);
    expect(leaks.some((l) => l.encoding === "base64")).toBe(true);
  });

  it("does not flag a condition-only trial search", () => {
    const url = buildConditionOnlySearchUrl({ condition: "non-small cell lung cancer" });
    const leaks = findChartLeaks({ url }, [CHART]);
    expect(leaks).toEqual([]);
  });
});

describe("Outbox interceptor", () => {
  const originalFetch = window.fetch;
  let sent: { url: string; body?: string }[];

  beforeEach(() => {
    sent = [];
    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === "string" ? init.body : undefined;
      sent.push(body === undefined ? { url } : { url, body });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  it("blocks a cloud request whose body contains chart text and records it in the Outbox", async () => {
    const sheet = emptyFactSheet("self_entry");
    sheet.notes = "EGFR exon 19 deletion documented on liquid biopsy.";
    const outbox = createOutbox(() => factSheetSnippets(sheet, CHART));
    outbox.install();
    await expect(
      fetch("https://firebase.googleapis.com/v1beta/models/gemini:generateContent", {
        method: "POST",
        body: JSON.stringify({ contents: CHART }),
      }),
    ).rejects.toBeInstanceOf(ChartTextBlockedError);
    expect(sent).toEqual([]);
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]?.blocked).toBe(true);
    expect(outbox.entries[0]?.destination).toBe("firebase");
    outbox.uninstall();
  });

  it("allows a condition-only ClinicalTrials.gov request and lists the exact query in the Outbox", async () => {
    const outbox = createOutbox(() => factSheetSnippets(emptyFactSheet("self_entry"), CHART));
    outbox.install();
    const url = buildConditionOnlySearchUrl({ condition: "non-small cell lung cancer" });
    assertConditionOnlySearch(url);
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    expect(outbox.entries).toHaveLength(1);
    const entry = outbox.entries[0];
    expect(entry?.blocked).toBe(false);
    expect(entry?.destination).toBe("clinicaltrials.gov");
    expect(entry?.queryParams["query.cond"]).toBe("non-small cell lung cancer");
    expect(entry?.queryParams["filter.overallStatus"]).toBe("RECRUITING");
    expect(entry?.queryParams["filter.geo"]).toBeUndefined();
    expect(entry?.queryParams["query.locn"]).toBeUndefined();
    outbox.uninstall();
  });

  it("rejects a helper that tries to add a geo filter to the public search", () => {
    const bad = "https://clinicaltrials.gov/api/v2/studies?query.cond=nsclc&filter.geo=distance(39.9612,-82.9988,300mi)";
    expect(() => assertConditionOnlySearch(bad)).toThrow(/filter.geo/);
  });
});

describe("network labels", () => {
  it("labels Firestore and condition-only searches as a public query with no chart data", () => {
    expect(networkLabel({ blocked: false, destination: "firebase" })).toBe(PUBLIC_QUERY_LABEL);
    expect(networkLabel({ blocked: false, destination: "clinicaltrials.gov" })).toBe(PUBLIC_QUERY_LABEL);
    expect(networkLabel({ blocked: false, destination: "same-origin" })).toBe(LOCAL_CACHE_LABEL);
    expect(networkLabel({ blocked: true, destination: "firebase" })).toBe("Blocked, chart text was not sent");
  });
});

describe("public refresh allowlist", () => {
  const originalFetch = window.fetch;
  let sent: { url: string; body?: string }[];

  beforeEach(() => {
    sent = [];
    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === "string" ? init.body : undefined;
      sent.push(body === undefined ? { url } : { url, body });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  const refreshUrl = "https://firebasevertexai.googleapis.com/v1beta/projects/inclusion-hybridai/models/gemini-3.5-flash-lite:generateContent";

  it("allows a refresh body that only contains public trial text overlapping a chart term", async () => {
    const { readFileSync } = await import("node:fs");
    const { publicTrialAllowlistText, withPublicTextAllowlist } = await import("../src/outbox/interceptor");
    const elig = JSON.parse(readFileSync("public/eligibility-criteria.json", "utf8"));
    const trial = elig.NCT04486833;
    const publicText = publicTrialAllowlistText(trial);
    expect(publicText.toLowerCase()).toContain("osimertinib");
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: publicText }] }],
    });
    const sheet = emptyFactSheet("self_entry");
    sheet.priorTherapies = ["osimertinib"];
    const outbox = createOutbox(() => factSheetSnippets(sheet, CHART));
    outbox.install();
    const res = await withPublicTextAllowlist(publicText, () =>
      fetch(refreshUrl, { method: "POST", body }),
    );
    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(outbox.entries[0]?.blocked).toBe(false);
    outbox.uninstall();
  });

  it("still blocks the same refresh body when a chart-unique string is added", async () => {
    const { readFileSync } = await import("node:fs");
    const { publicTrialAllowlistText, withPublicTextAllowlist, ChartTextBlockedError } = await import(
      "../src/outbox/interceptor"
    );
    const elig = JSON.parse(readFileSync("public/eligibility-criteria.json", "utf8"));
    const trial = elig.NCT04486833;
    const publicText = publicTrialAllowlistText(trial);
    const unique = "62-year-old never-smoker";
    expect(publicText.toLowerCase()).not.toContain(unique);
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${publicText}\n${unique}` }] }],
    });
    const sheet = emptyFactSheet("self_entry");
    sheet.priorTherapies = ["osimertinib"];
    sheet.notes = unique;
    const outbox = createOutbox(() => factSheetSnippets(sheet));
    outbox.install();
    await expect(
      withPublicTextAllowlist(publicText, () => fetch(refreshUrl, { method: "POST", body })),
    ).rejects.toBeInstanceOf(ChartTextBlockedError);
    expect(sent).toEqual([]);
    expect(outbox.entries[0]?.blocked).toBe(true);
    outbox.uninstall();
  });

  it("allows parser-prompt examples that overlap a chart variant, and still blocks chart-unique text", async () => {
    const { readFileSync } = await import("node:fs");
    const { publicTrialAllowlistText, withPublicTextAllowlist, ChartTextBlockedError } = await import(
      "../src/outbox/interceptor"
    );
    const elig = JSON.parse(readFileSync("public/eligibility-criteria.json", "utf8"));
    const trial = elig.NCT04486833;
    const prompt = readFileSync("prompts/cloud-eligibility-parser.md", "utf8");
    expect(prompt.toLowerCase()).toContain("exon 19 deletion");
    const publicText = `${publicTrialAllowlistText(trial)}\n${prompt}`;
    const unique = "62-year-old never-smoker";
    const sheet = emptyFactSheet("self_entry");
    sheet.priorTherapies = ["osimertinib"];
    sheet.biomarkers.egfr = { status: "present", variant: "exon 19 deletion" };
    sheet.notes = unique;
    const outbox = createOutbox(() => factSheetSnippets(sheet));
    outbox.install();
    const allowedBody = JSON.stringify({ system: prompt, user: publicTrialAllowlistText(trial) });
    const res = await withPublicTextAllowlist(publicText, () =>
      fetch(refreshUrl, { method: "POST", body: allowedBody }),
    );
    expect(res.ok).toBe(true);
    expect(outbox.entries[0]?.blocked).toBe(false);
    await expect(
      withPublicTextAllowlist(publicText, () =>
        fetch(refreshUrl, { method: "POST", body: `${allowedBody}\n${unique}` }),
      ),
    ).rejects.toBeInstanceOf(ChartTextBlockedError);
    expect(outbox.entries[1]?.blocked).toBe(true);
    outbox.uninstall();
  });
});
