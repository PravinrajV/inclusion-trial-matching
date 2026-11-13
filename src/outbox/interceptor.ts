import { findChartLeaks, isLocalDestination } from "./chart-guard";

let publicTextAllowlist = "";

/**
 * For a public-trial refresh, snippets that already occur verbatim in the
 * ClinicalTrials.gov text being sent are not treated as chart leaks in that
 * request. Chart-unique text still blocks. Nested calls restore the previous value.
 */
export async function withPublicTextAllowlist<T>(publicText: string, fn: () => Promise<T>): Promise<T> {
  const prev = publicTextAllowlist;
  publicTextAllowlist = publicText;
  try {
    return await fn();
  } finally {
    publicTextAllowlist = prev;
  }
}

export function publicTrialAllowlistText(trial: {
  nctId?: string;
  briefTitle?: string;
  phases?: string[] | string;
  minimumAge?: string;
  maximumAge?: string;
  sex?: string;
  conditions?: string[];
  eligibilityCriteria?: string;
}): string {
  const phases = Array.isArray(trial.phases) ? trial.phases.join(" ") : trial.phases || "";
  const conditions = Array.isArray(trial.conditions) ? trial.conditions.join("\n") : "";
  return [
    trial.nctId,
    trial.briefTitle,
    phases,
    trial.minimumAge,
    trial.maximumAge,
    trial.sex,
    conditions,
    trial.eligibilityCriteria,
  ]
    .filter((v) => v && String(v).trim())
    .join("\n");
}

export type OutboxDestination = "clinicaltrials.gov" | "firebase" | "same-origin" | "other";

/** Label for condition-only / public-cache network requests that leave the page. */
export const PUBLIC_QUERY_LABEL = "Public query, no chart data";
export const LOCAL_CACHE_LABEL = "Local public cache, no chart data";

export function networkLabel(entry: { blocked: boolean; destination: OutboxDestination }): string {
  if (entry.blocked) return "Blocked, chart text was not sent";
  if (entry.destination === "firebase" || entry.destination === "clinicaltrials.gov") return PUBLIC_QUERY_LABEL;
  if (entry.destination === "same-origin") return LOCAL_CACHE_LABEL;
  return PUBLIC_QUERY_LABEL;
}


export interface OutboxEntry {
  id: string;
  at: string;
  method: string;
  url: string;
  destination: OutboxDestination;
  queryParams: Record<string, string>;
  bodyKeys: string[];
  bodyByteLength: number;
  blocked: boolean;
  blockReason?: string;
  leaks?: { foundIn: string; encoding: string }[];
}

export interface Outbox {
  entries: OutboxEntry[];
  install: () => void;
  uninstall: () => void;
}

export class ChartTextBlockedError extends Error {
  readonly leaks: ReturnType<typeof findChartLeaks>;
  constructor(leaks: ReturnType<typeof findChartLeaks>) {
    super(
      `Blocked a request that would have sent chart text to the network (${leaks[0]?.foundIn}, ${leaks[0]?.encoding}).`,
    );
    this.name = "ChartTextBlockedError";
    this.leaks = leaks;
  }
}

export function classifyDestination(url: string): OutboxDestination {
  try {
    const u = new URL(url, window.location?.href ?? "http://localhost");
    const host = u.hostname.toLowerCase();
    if (host === "clinicaltrials.gov" || host.endsWith(".clinicaltrials.gov")) {
      return "clinicaltrials.gov";
    }
    if (
      host.endsWith(".googleapis.com") ||
      host.endsWith(".firebaseio.com") ||
      host.endsWith(".cloudfunctions.net") ||
      host.endsWith(".firebaseapp.com") ||
      host.endsWith(".web.app") ||
      host.endsWith(".google.com")
    ) {
      return "firebase";
    }
    if (typeof window !== "undefined" && window.location && u.origin === window.location.origin) {
      return "same-origin";
    }
    return "other";
  } catch {
    return "other";
  }
}

export function queryParamsOf(url: string): Record<string, string> {
  try {
    const u = new URL(url, "http://localhost");
    const out: Record<string, string> = {};
    u.searchParams.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  } catch {
    return {};
  }
}

function bodyKeysOf(body: string): string[] {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed as Record<string, unknown>);
    }
  } catch {
    // not JSON
  }
  return [];
}

async function readBody(init?: RequestInit | Request): Promise<string> {
  if (!init) return "";
  if (init instanceof Request) {
    try {
      return await init.clone().text();
    } catch {
      return "";
    }
  }
  const body = init.body;
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Blob) return body.text();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body as ArrayBufferView);
  }
  return "";
}

let seq = 0;

export function createOutbox(getSnippets: () => string[]): Outbox {
  const entries: OutboxEntry[] = [];
  let originalFetch: typeof fetch | null = null;
  let installed = false;

  const inspectAndMaybeBlock = async (input: RequestInfo | URL, init?: RequestInit): Promise<void> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method =
      init?.method ??
      (input instanceof Request ? input.method : "GET");
    const body = await readBody(init ?? (input instanceof Request ? input : undefined));
    const headerParts: string[] = [];
    const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    if (headers) {
      const h = new Headers(headers);
      h.forEach((value, key) => {
        headerParts.push(`${key}: ${value}`);
      });
    }
    const snippets = getSnippets().filter((s) => s && s.trim().length >= 8);
    const leaks = findChartLeaks({ url, body, headers: headerParts.join("\n") }, snippets, {
      publicText: publicTextAllowlist,
    });
    const shouldScan = !isLocalDestination(url) || classifyDestination(url) !== "same-origin";
    // Always scan non-local destinations. Also scan localhost when the
    // destination class is not same-origin (for example a CT.gov URL).
    const blocked = leaks.length > 0 && (shouldScan || classifyDestination(url) !== "same-origin" || !isLocalDestination(url));
    const reallyBlocked = leaks.length > 0 && !isLocalDestination(url);

    const entry: OutboxEntry = {
      id: `ob-${++seq}`,
      at: new Date().toISOString(),
      method: (method ?? "GET").toUpperCase(),
      url,
      destination: classifyDestination(url),
      queryParams: queryParamsOf(url),
      bodyKeys: bodyKeysOf(body),
      bodyByteLength: new TextEncoder().encode(body).length,
      blocked: reallyBlocked,
    };
    if (reallyBlocked) {
      entry.blockReason = "Request body, URL or headers contained chart text.";
      entry.leaks = leaks.map((l) => ({ foundIn: l.foundIn, encoding: l.encoding }));
    }
    entries.push(entry);
    if (reallyBlocked) {
      throw new ChartTextBlockedError(leaks);
    }
    void blocked;
  };

  return {
    entries,
    install() {
      if (installed) return;
      originalFetch = window.fetch.bind(window);
      const inner = originalFetch;
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        await inspectAndMaybeBlock(input, init);
        return inner(input, init);
      }) as typeof fetch;
      installed = true;
    },
    uninstall() {
      if (!installed || !originalFetch) return;
      window.fetch = originalFetch;
      originalFetch = null;
      installed = false;
    },
  };
}

/**
 * Client-side ClinicalTrials.gov search may only send a condition and a
 * recruiting status. Distance is applied later, on the device, against
 * cached sites. A location here would be health-adjacent information
 * leaving the laptop.
 */
export function buildConditionOnlySearchUrl(options: {
  condition: string;
  overallStatus?: string;
  pageSize?: number;
}): string {
  const params = new URLSearchParams();
  params.set("query.cond", options.condition);
  params.set("filter.overallStatus", options.overallStatus ?? "RECRUITING");
  params.set("countTotal", "true");
  params.set("pageSize", String(options.pageSize ?? 1));
  // Deliberately no filter.geo, no query.locn, no city, no state.
  return `https://clinicaltrials.gov/api/v2/studies?${params.toString()}`;
}

const FORBIDDEN_SEARCH_KEYS = ["filter.geo", "query.locn", "query.lcnty", "query.city"];

export function assertConditionOnlySearch(url: string): void {
  const u = new URL(url);
  if (u.hostname !== "clinicaltrials.gov") {
    throw new Error("Not a ClinicalTrials.gov URL");
  }
  for (const key of FORBIDDEN_SEARCH_KEYS) {
    if (u.searchParams.has(key)) {
      throw new Error(`ClinicalTrials.gov search must not include ${key}. Filter distance on the device.`);
    }
  }
  if (!u.searchParams.get("query.cond")) {
    throw new Error("ClinicalTrials.gov search must include query.cond");
  }
}
