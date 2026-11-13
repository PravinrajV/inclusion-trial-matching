import { describe, expect, it } from "vitest";
import { isNanoDebugEnabled, nanoDebugPanelMarkup, renderNanoDebug } from "../src/intake/nano-debug";
import { emptyFactSheet } from "../src/schema/fact-sheet";

describe("?debug=nano local diagnostic", () => {
  it("is off unless the URL has debug=nano", () => {
    expect(isNanoDebugEnabled("")).toBe(false);
    expect(isNanoDebugEnabled("?foo=1")).toBe(false);
    expect(isNanoDebugEnabled("?debug=1")).toBe(false);
    expect(isNanoDebugEnabled("?debug=nano")).toBe(true);
    expect(isNanoDebugEnabled("?debug=nano&x=1")).toBe(true);
  });

  it("shows raw JSON and the parsed sheet only when enabled, and stays in the DOM", () => {
    const root = document.createElement("div");
    root.innerHTML = nanoDebugPanelMarkup();
    const sheet = emptyFactSheet("on_device_model");
    sheet.stage = "IV";
    const rawModel = { stage: "IV", priorTherapies: ["osimertinib"] };

    renderNanoDebug(root, { rawModel, factSheet: sheet }, "");
    const panel = root.querySelector("#nano-debug") as HTMLElement;
    expect(panel.hidden).toBe(true);
    expect(root.querySelector("#nano-debug-raw")?.textContent).toContain("Run an on-device read");

    renderNanoDebug(root, { rawModel, factSheet: sheet }, "?debug=nano");
    expect(panel.hidden).toBe(false);
    expect(root.querySelector("#nano-debug-raw")?.textContent).toContain("osimertinib");
    expect(root.querySelector("#nano-debug-parsed")?.textContent).toContain('"stage": "IV"');
  });
});
