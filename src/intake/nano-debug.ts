/**
 * Local-only diagnostic for on-device Nano extract.
 * Enabled by ?debug=nano. Nothing in this panel is sent off the device.
 * The outbox chart-text guard is unchanged.
 */
import type { FactSheet } from "../schema/fact-sheet";
import { stripPatientNames } from "./nano-extract";

export function isNanoDebugEnabled(search: string = typeof location !== "undefined" ? location.search : ""): boolean {
  return new URLSearchParams(search).get("debug") === "nano";
}

export function nanoDebugPanelMarkup(): string {
  return `<details class="nano-debug" id="nano-debug" hidden>
  <summary>Local Nano diagnostic (stays on this device)</summary>
  <p class="hint">Raw on-device model JSON and the parsed fact sheet. This panel is local only. Chart text is not sent anywhere.</p>
  <h3>Raw model JSON</h3>
  <pre id="nano-debug-raw">Run an on-device read to capture output.</pre>
  <h3>Parsed fact sheet</h3>
  <pre id="nano-debug-parsed"></pre>
</details>`;
}

export function renderNanoDebug(
  root: HTMLElement,
  payload: { rawModel?: unknown; factSheet?: FactSheet } | null,
  search?: string,
): void {
  const panel = root.querySelector("#nano-debug") as HTMLElement | null;
  if (!panel) return;
  const enabled = isNanoDebugEnabled(search);
  panel.hidden = !enabled;
  if (!enabled) return;
  const rawEl = root.querySelector("#nano-debug-raw");
  const parsedEl = root.querySelector("#nano-debug-parsed");
  if (payload?.rawModel !== undefined && rawEl) {
    rawEl.textContent = JSON.stringify(stripPatientNames(payload.rawModel), null, 2);
  }
  if (payload?.factSheet && parsedEl) {
    parsedEl.textContent = JSON.stringify(stripPatientNames(payload.factSheet), null, 2);
  }
}
