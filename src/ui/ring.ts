/** Match-strength arc: met / discuss / not-met segments. */

export function renderStrengthRing(
  counts: { met: number; discuss?: number; notMet?: number },
  opts?: { size?: number; of?: number },
): string {
  const size = opts?.size ?? 56;
  const r = 18;
  const c = 2 * Math.PI * r;
  const discuss = counts.discuss ?? 0;
  const notMet = counts.notMet ?? 0;
  const total = Math.max(1, opts?.of ?? counts.met + discuss + notMet);
  const met = (counts.met / total) * c;
  const discussLen = (discuss / total) * c;
  const notMetLen = (notMet / total) * c;
  const gap = total > 1 ? 1.6 : 0;
  const cx = 28;
  const cy = 28;
  // Start at 12 o'clock, clock-wise.
  const a0 = -Math.PI / 2;
  const sweep = (len: number) => (len / c) * Math.PI * 2;
  function arc(start: number, len: number, cls: string): string {
    if (len <= 0) return "";
    const usable = Math.max(0, len - gap);
    const a1 = start;
    const a2 = start + sweep(usable);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const large = a2 - a1 > Math.PI ? 1 : 0;
    return `<path class="${cls}" pathLength="1" d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" />`;
  }
  let cursor = a0;
  const metPath = arc(cursor, met, "ring-met");
  cursor += sweep(met);
  const discussPath = arc(cursor, discussLen, "ring-discuss");
  cursor += sweep(discussLen);
  const notPath = arc(cursor, notMetLen, "ring-not");
  return `<svg class="strength-ring" viewBox="0 0 56 56" width="${size}" height="${size}" aria-hidden="true" focusable="false">
    <circle class="ring-track" cx="${cx}" cy="${cy}" r="${r}" />
    <g class="ring-arcs">${metPath}${discussPath}${notPath}</g>
  </svg>`;
}

export function countUp(el: HTMLElement, to: number, duration = 800, suffix = ""): void {
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const formatted = (n: number) => `${Math.round(n).toLocaleString("en-US")}${suffix}`;
  if (reduce || duration <= 0) {
    el.textContent = formatted(to);
    return;
  }
  const start = performance.now();
  const from = 0;
  const tick = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = formatted(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
