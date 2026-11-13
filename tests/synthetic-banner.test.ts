import { describe, expect, it } from "vitest";
import { setSyntheticBanner, SYNTHETIC_BANNER_TEXT } from "../src/ui/synthetic-banner";

function mount(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <p class="synthetic-banner" id="synthetic-banner" hidden>${SYNTHETIC_BANNER_TEXT}</p>
    <p class="synthetic-banner" id="synthetic-banner-card" hidden>${SYNTHETIC_BANNER_TEXT}</p>
    <p class="synthetic-banner" id="synthetic-banner-print" hidden>${SYNTHETIC_BANNER_TEXT}</p>
  `;
  return root;
}

describe("synthetic demo label", () => {
  it("stays visible on every path, including paste and self-entry (null persona)", () => {
    const root = mount();
    setSyntheticBanner(root, null);
    const banners = [...root.querySelectorAll<HTMLElement>(".synthetic-banner")];
    expect(banners).toHaveLength(3);
    for (const el of banners) {
      expect(el.hidden).toBe(false);
      expect(el.textContent).toBe(SYNTHETIC_BANNER_TEXT);
    }
    expect(root.classList.contains("has-synthetic")).toBe(true);
  });

  it("remains visible after a second paste-path call", () => {
    const root = mount();
    setSyntheticBanner(root, "alex-rivera");
    setSyntheticBanner(root, null);
    expect(root.querySelectorAll<HTMLElement>(".synthetic-banner:not([hidden])").length).toBe(3);
  });
});
