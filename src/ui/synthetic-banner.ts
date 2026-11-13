/** The judged demo is synthetic-only. Keep this label visible on every path. */
export const SYNTHETIC_BANNER_TEXT = "Synthetic demo data";

export function setSyntheticBanner(root: HTMLElement, _personaId?: string | null): void {
  root.classList.add("has-synthetic");
  for (const el of root.querySelectorAll<HTMLElement>(".synthetic-banner")) {
    el.hidden = false;
    if (!el.textContent?.trim()) el.textContent = SYNTHETIC_BANNER_TEXT;
  }
}
