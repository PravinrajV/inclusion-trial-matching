import { icon } from "./icons";

export type HybridStage = "idle" | "cloud" | "device" | "match" | "done";

function connector(dir: "in" | "out"): string {
  return `<div class="hybrid-connect" data-dir="${dir}" aria-hidden="true"><span class="hybrid-connect-line"></span><span class="hybrid-connect-head"></span></div>`;
}

export type ChartInferenceSource = "nano" | "self-entry" | "synthetic" | "unavailable";

export function chartSourceLabel(source: ChartInferenceSource): string {
  if (source === "nano") return "On-device · Gemini Nano";
  if (source === "synthetic") return "On this device · no model (synthetic facts)";
  if (source === "self-entry") return "On this device · no model (self-entry)";
  return "On this device · no model";
}

const PUBLIC_SOURCE_LABEL = "Cloud · cached public parse";
const MATCH_SOURCE_LABEL = "On this device · no model";

export function renderHybridFlow(opts?: { compact?: boolean }): string {
  const compact = Boolean(opts?.compact);
  const id = compact ? "hybrid-strip" : "hybrid-flow";
  const cls = compact ? "hybrid-flow is-compact" : "hybrid-flow";
  if (compact) {
    return `<section class="${cls}" id="${id}" data-stage="idle" aria-label="How matching stays hybrid">
    <div class="hybrid-one-line">
      <span class="hybrid-chip" data-node="cloud">
        <span class="hybrid-title">Cloud</span>
        <span class="hybrid-source" data-source="public">${PUBLIC_SOURCE_LABEL}</span>
      </span>
      ${connector("in")}
      <span class="hybrid-chip hybrid-chip-meet" data-node="match">
        <span class="hybrid-title">Match</span>
        <span class="hybrid-source" data-source="match">${MATCH_SOURCE_LABEL}</span>
      </span>
      ${connector("out")}
      <span class="hybrid-chip" data-node="device">
        <span class="hybrid-title">Chart</span>
        <span class="hybrid-source" data-source="chart" data-chart-source>${chartSourceLabel("unavailable")}</span>
      </span>
    </div>
  </section>`;
  }
  return `<section class="${cls}" id="${id}" data-stage="idle" aria-label="How matching stays hybrid">
    <header class="hybrid-kicker">
      <span class="hybrid-kicker-dot" aria-hidden="true"></span>
      <p>How the match is made</p>
    </header>
    <div class="hybrid-rail">
      <div class="hybrid-lane" data-lane="cloud">
        <div class="hybrid-node" data-node="public">
          <span class="hybrid-ico">${icon("file")}</span>
          <div>
            <p class="hybrid-title">Public trial text</p>
            <p class="hybrid-sub">Eligibility language from <span class="nowrap">ClinicalTrials.gov</span></p>
            <p class="hybrid-source" data-source="public">${PUBLIC_SOURCE_LABEL}</p>
          </div>
        </div>
        <span class="hybrid-pipe" data-pipe="cloud" aria-hidden="true"><span class="hybrid-pulse"></span></span>
        <div class="hybrid-node" data-node="cloud">
          <span class="hybrid-ico">${icon("cloud")}</span>
          <div>
            <p class="hybrid-title">Cloud</p>
            <p class="hybrid-sub">Public eligibility, cached. No chart.</p>
            <p class="hybrid-source" data-source="public">${PUBLIC_SOURCE_LABEL}</p>
          </div>
        </div>
      </div>
      ${connector("in")}
      <div class="hybrid-meet" data-node="match">
        <span class="hybrid-ico hybrid-ico-meet">${icon("spark")}</span>
        <p class="hybrid-title">Match on this device</p>
        <p class="hybrid-sub">The chart never leaves this computer</p>
        <p class="hybrid-source" data-source="match">${MATCH_SOURCE_LABEL}</p>
      </div>
      ${connector("out")}
      <div class="hybrid-lane" data-lane="device">
        <div class="hybrid-node" data-node="chart">
          <span class="hybrid-ico">${icon("lock")}</span>
          <div>
            <p class="hybrid-title">Your chart</p>
            <p class="hybrid-sub">Stays in this browser</p>
          </div>
        </div>
        <span class="hybrid-pipe" data-pipe="device" aria-hidden="true"><span class="hybrid-pulse"></span></span>
        <div class="hybrid-node" data-node="device">
          <span class="hybrid-ico">${icon("cpu")}</span>
          <div>
            <p class="hybrid-title"><span class="nowrap">On-device</span></p>
            <p class="hybrid-sub">Gemini Nano, when available</p>
            <p class="hybrid-source" data-source="chart" data-chart-source>${chartSourceLabel("unavailable")}</p>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

export function setChartInferenceSource(root: HTMLElement, source: ChartInferenceSource): void {
  const label = chartSourceLabel(source);
  for (const el of root.querySelectorAll<HTMLElement>("[data-chart-source]")) {
    el.textContent = label;
  }
}

export function setHybridStage(root: HTMLElement, stage: HybridStage): void {
  for (const el of root.querySelectorAll<HTMLElement>(".hybrid-flow")) {
    el.dataset.stage = stage;
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Lights each stage in sequence, then settles on done. Returns when the story has played. */
export async function playHybridFlow(root: HTMLElement): Promise<void> {
  const reduce = prefersReducedMotion();
  const hold = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, reduce ? 0 : ms));
  setHybridStage(root, "cloud");
  await hold(420);
  setHybridStage(root, "device");
  await hold(520);
  setHybridStage(root, "match");
  await hold(640);
  setHybridStage(root, "done");
}
