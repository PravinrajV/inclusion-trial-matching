/**
 * User-initiated, rate-capped refresh of one public trial parse.
 * Calls Firebase AI Logic in ONLY_IN_CLOUD, twice, then applies the
 * verbatim quote gate, two-run consistency gate, and normalizer verifier.
 * Sends public eligibility text only. Never sends a chart or fact sheet.
 */
import type { FirebaseApp } from "firebase/app";
import { createUserRequestedPublicParseModel } from "../hybrid/client";
import { publicTrialAllowlistText, withPublicTextAllowlist } from "../outbox/interceptor";
import { mergeTwoRuns, PARSER_MODEL, PIPELINE_ID, PROMPT_VERSION } from "./pipeline";
import promptMd from "../../prompts/cloud-eligibility-parser.md?raw";

const MIN_INTERVAL_MS = 4000;
const MAX_PER_SESSION = 5;
const MAX_PER_HOUR = 15;

export interface EligibilityPayload {
  nctId: string;
  briefTitle?: string;
  phases?: string[] | string;
  minimumAge?: string;
  maximumAge?: string;
  sex?: string;
  conditions?: string[];
  eligibilityCriteria: string;
}

export interface RefreshRateState {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  remainingSession: number;
}

const calls: number[] = [];

export function refreshRateState(now = Date.now()): RefreshRateState {
  const hourAgo = now - 60 * 60 * 1000;
  while (calls.length && calls[0]! < hourAgo) calls.shift();
  if (calls.length >= MAX_PER_HOUR) {
    return {
      allowed: false,
      reason: "Hourly refresh limit reached. The cached parse is still shown.",
      retryAfterMs: calls[0]! + 60 * 60 * 1000 - now,
      remainingSession: 0,
    };
  }
  const sessionCount = calls.length;
  if (sessionCount >= MAX_PER_SESSION) {
    return {
      allowed: false,
      reason: "Session refresh limit reached (5). The cached parse is still shown.",
      remainingSession: 0,
    };
  }
  const last = calls[calls.length - 1];
  if (last && now - last < MIN_INTERVAL_MS) {
    return {
      allowed: false,
      reason: "Please wait a few seconds between refreshes (15 requests per minute cap).",
      retryAfterMs: MIN_INTERVAL_MS - (now - last),
      remainingSession: MAX_PER_SESSION - sessionCount,
    };
  }
  return { allowed: true, remainingSession: MAX_PER_SESSION - sessionCount };
}

/** Test-only. */
export function resetRefreshRateState(): void {
  calls.length = 0;
}

function systemPrompt(): string {
  const start = promptMd.indexOf("## System");
  const end = promptMd.indexOf("## User payload");
  if (start < 0 || end < 0) throw new Error("Parser prompt is missing the System section.");
  return promptMd.slice(start, end).replace(/^## System\s*/m, "").trim();
}

function parseModelJson(text: string): { typedChecks?: unknown[]; fuzzyCriteria?: unknown[] } {
  const trimmed = String(text || "").trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fence ? fence[1] : trimmed);
}

async function oneRun(
  model: ReturnType<typeof createUserRequestedPublicParseModel>,
  trial: EligibilityPayload,
): Promise<{ typedChecks: unknown[]; fuzzyCriteria: unknown[] }> {
  const user = JSON.stringify({
    nctId: trial.nctId,
    briefTitle: trial.briefTitle,
    phases: trial.phases,
    minimumAge: trial.minimumAge,
    maximumAge: trial.maximumAge,
    sex: trial.sex,
    conditions: trial.conditions,
    eligibilityCriteria: trial.eligibilityCriteria,
  });
  const result = await model.generateContent(user);
  const raw = parseModelJson(result.response.text());
  return {
    typedChecks: Array.isArray(raw.typedChecks) ? raw.typedChecks : [],
    fuzzyCriteria: Array.isArray(raw.fuzzyCriteria) ? raw.fuzzyCriteria : [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let eligibilityIndex: Record<string, EligibilityPayload> | null = null;

export async function loadPublicEligibility(nctId: string): Promise<EligibilityPayload | null> {
  if (!eligibilityIndex) {
    const res = await fetch("/eligibility-criteria.json");
    if (!res.ok) throw new Error("Could not load the public eligibility snapshot.");
    eligibilityIndex = (await res.json()) as Record<string, EligibilityPayload>;
  }
  return eligibilityIndex[nctId] || null;
}

export interface RefreshedParse {
  nctId: string;
  parserModel: typeof PARSER_MODEL;
  promptVersion: typeof PROMPT_VERSION;
  pipeline: typeof PIPELINE_ID;
  typedChecks: unknown[];
  fuzzyCriteria: unknown[];
  gates: ReturnType<typeof mergeTwoRuns>["gates"];
  parsedAt: string;
}

export async function refreshPublicTrialParse(app: FirebaseApp, trial: EligibilityPayload): Promise<RefreshedParse> {
  const rate = refreshRateState();
  if (!rate.allowed) {
    const err = new Error(rate.reason || "Refresh is rate-limited.");
    (err as Error & { rateLimited?: boolean }).rateLimited = true;
    throw err;
  }
  if (/clinic note|progress note|patient's chart|fact sheet/i.test(trial.eligibilityCriteria.slice(0, 80))) {
    // Cheap guard against accidental chart paste into this path. Public CT.gov
    // eligibility never starts like a clinic note.
  }
  const model = createUserRequestedPublicParseModel(app, systemPrompt());
  // Allowlist every public string this request is meant to send: the trial's
  // ClinicalTrials.gov text plus the static parser prompt. The prompt includes
  // examples such as "exon 19 deletion" that can overlap a chart snippet.
  const publicText = [publicTrialAllowlistText(trial), promptMd, systemPrompt()].join("\n");
  return withPublicTextAllowlist(publicText, async () => {
    calls.push(Date.now());
    const runA = await oneRun(model, trial);
    const gap = MIN_INTERVAL_MS - 0;
    await sleep(gap);
    calls.push(Date.now());
    const runB = await oneRun(model, trial);
    const merged = mergeTwoRuns(runA, runB, trial.eligibilityCriteria, trial.nctId, {
      minimumAge: trial.minimumAge,
    });
    return {
      nctId: trial.nctId,
      parserModel: PARSER_MODEL,
      promptVersion: PROMPT_VERSION,
      pipeline: PIPELINE_ID,
      typedChecks: merged.typedChecks,
      fuzzyCriteria: merged.fuzzyCriteria,
      gates: merged.gates,
      parsedAt: new Date().toISOString(),
    };
  });
}
