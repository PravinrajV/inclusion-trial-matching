import { describe, expect, it } from "vitest";
import {
  numberIntakeTabs,
  READ_NOTE_IDLE_LABEL,
  READ_NOTE_LOADING_LABEL,
  setReadNoteButtonState,
} from "../src/app";

function tabRoot(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <button type="button" class="step-tab" data-go-step="1"><span>01</span> Load</button>
    <button type="button" class="step-tab" data-go-step="2"><span>02</span> Chart</button>
    <button type="button" class="step-tab" data-go-step="3"><span>02</span> Facts</button>
  `;
  return root;
}

describe("intake tab numbering", () => {
  it("renumbers visible tabs to 01 Load, 02 Chart, 03 Facts after Nano is available", () => {
    const root = tabRoot();
    root.classList.add("no-nano");
    numberIntakeTabs(root);
    const labels = [...root.querySelectorAll(".step-tab")].map((btn) => {
      const step = (btn as HTMLElement).dataset.goStep;
      const num = btn.querySelector("span")?.textContent;
      return `${step}:${num}`;
    });
    // Chart is skipped while hidden, so Facts becomes 02; Chart keeps its previous 02.
    expect(labels).toEqual(["1:01", "2:02", "3:02"]);

    root.classList.remove("no-nano");
    numberIntakeTabs(root);
    const after = [...root.querySelectorAll(".step-tab")].map((btn) => btn.querySelector("span")?.textContent);
    expect(after).toEqual(["01", "02", "03"]);
  });

  it("numbers Load and Facts 01 and 02 when the chart step is hidden", () => {
    const root = tabRoot();
    root.classList.add("no-nano");
    numberIntakeTabs(root);
    const facts = root.querySelector('[data-go-step="3"] span')?.textContent;
    const load = root.querySelector('[data-go-step="1"] span')?.textContent;
    expect(load).toBe("01");
    expect(facts).toBe("02");
  });
});

describe("Read this note on this device button", () => {
  it("uses a primary button with an icon, a spinner loading state, and disables while running", () => {
    const btn = document.createElement("button");
    btn.className = "primary-btn";
    btn.id = "read-note-btn";
    btn.innerHTML = `<span class="btn-icon"></span><span class="btn-label">${READ_NOTE_IDLE_LABEL}</span>`;
    expect(btn.classList.contains("primary-btn")).toBe(true);

    setReadNoteButtonState(btn, true);
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains("is-loading")).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.querySelector(".btn-label")?.textContent).toBe(READ_NOTE_LOADING_LABEL);

    setReadNoteButtonState(btn, false);
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains("is-loading")).toBe(false);
    expect(btn.querySelector(".btn-label")?.textContent).toBe(READ_NOTE_IDLE_LABEL);
  });
});
