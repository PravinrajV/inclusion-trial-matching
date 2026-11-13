/**
 * Chrome on-device (built-in) model requirements, quoted from the official
 * Prompt API documentation. Do not invent numbers; update this file from the
 * source page if Chrome changes the published requirements.
 *
 * Source: https://developer.chrome.com/docs/ai/prompt-api
 * Page published May 20, 2025; last updated October 21, 2026.
 */
export const CHROME_PROMPT_API_URL = "https://developer.chrome.com/docs/ai/prompt-api";
export const CHROME_PROMPT_API_UPDATED = "October 21, 2026";

export const CHROME_ON_DEVICE_HEADLINE =
  "Your chart stays here. This computer can't run on-device AI, but the full demo still works.";

export const CHROME_ON_DEVICE_LINE =
  "Reading free-text clinic notes needs Chrome's on-device model. Inclusion never sends notes to the cloud instead.";

export const CHROME_REQS_SUMMARY = "Requirements (from Chrome docs, Oct 21, 2026)";

/** Official operating-system list, quoted from the Prompt API page. */
export const CHROME_ON_DEVICE_OS = [
  "Windows 10 or 11",
  "macOS 13 or later (Ventura and onwards)",
  "Linux",
  "ChromeOS (from Platform 16389.0.0 onwards) on Chromebook Plus devices",
] as const;

export const CHROME_ON_DEVICE_UNSUPPORTED =
  "Chrome for Android, iOS, and ChromeOS on non-Chromebook Plus devices are not yet supported by the APIs which use the built-in language models.";

export const CHROME_ON_DEVICE_STORAGE =
  "At least 22 GB of free space on the volume that contains your Chrome profile.";

export const CHROME_ON_DEVICE_STORAGE_NOTE =
  "Built-in models are significantly smaller, but this free space is required to ensure there is room for other existing Chrome features, plus a buffer. If the available storage falls lower than 10 GB, the model is deleted to ensure other browser features can work as intended.";

export const CHROME_ON_DEVICE_GPU = "GPU: Strictly more than 4 GB of VRAM.";
export const CHROME_ON_DEVICE_CPU = "CPU: 16 GB of RAM or more and 4 CPU cores or more.";
export const CHROME_ON_DEVICE_NETWORK =
  "Unlimited data or an unmetered connection. The APIs use the internet only for the initial model download. Subsequent use of the APIs doesn't require an internet connection.";
export const CHROME_ON_DEVICE_NO_DATA =
  "No data is sent to Google or any third party when using the model.";
export const CHROME_PROMPT_API_WEB = "The Prompt API on the web is available in Chrome 148.";

export function renderChromeOnDeviceRequirements(): string {
  const os = CHROME_ON_DEVICE_OS.map((line) => `<li>${escape(line)}</li>`).join("");
  return `<div class="nano-reqs">
    <h3>Chrome on-device requirements</h3>
    <p class="nano-cite">Quoted from Chrome's Prompt API documentation, last updated ${escape(CHROME_PROMPT_API_UPDATED)}. <a href="${CHROME_PROMPT_API_URL}" target="_blank" rel="noopener noreferrer">${escape(CHROME_PROMPT_API_URL.replace("https://", ""))}</a></p>
    <p>${escape(CHROME_PROMPT_API_WEB)}</p>
    <p>The Prompt API works in Chrome when the following conditions are met.</p>
    <p><strong>Operating system</strong></p>
    <ul>${os}</ul>
    <p>${escape(CHROME_ON_DEVICE_UNSUPPORTED)}</p>
    <p><strong>Storage.</strong> ${escape(CHROME_ON_DEVICE_STORAGE)} ${escape(CHROME_ON_DEVICE_STORAGE_NOTE)}</p>
    <p><strong>GPU or CPU.</strong> Built-in models can run with a GPU or a CPU. ${escape(CHROME_ON_DEVICE_GPU)} ${escape(CHROME_ON_DEVICE_CPU)}</p>
    <p><strong>Network.</strong> ${escape(CHROME_ON_DEVICE_NETWORK)}</p>
    <p>${escape(CHROME_ON_DEVICE_NO_DATA)}</p>
  </div>`;
}

export function renderDemoVideoSlot(url: string | undefined): string {
  const href = (url ?? "").trim();
  if (href) {
    return `<div class="demo-video-slot" id="demo-video-slot">
      <p class="slot-kicker">Recorded demo</p>
      <p><a href="${escape(href)}" target="_blank" rel="noopener noreferrer">Watch the recorded demo</a></p>
    </div>`;
  }
  return `<div class="demo-video-slot" id="demo-video-slot">
    <p class="slot-kicker">Recorded demo</p>
    <p class="slot-placeholder">A public video link will appear here once the recorded demo is approved for posting. Nothing has been uploaded yet.</p>
  </div>`;
}

function escape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}


export function renderWatchDemoButton(url: string | undefined): string {
  const href = (url ?? "").trim();
  if (href) {
    return `<a class="nano-btn nano-btn-watch" id="watch-demo-btn" href="${escape(href)}" target="_blank" rel="noopener noreferrer">Watch the 3-minute demo</a>`;
  }
  return `<button type="button" class="nano-btn nano-btn-watch is-pending" id="watch-demo-btn" disabled aria-disabled="true" title="The recorded demo will be linked here once it is approved for posting.">Watch the 3-minute demo</button>
    <p class="nano-watch-note">The recorded demo will be linked here once it is approved for posting.</p>`;
}

export function renderNoNanoScreen(videoUrl: string | undefined): string {
  return `<section class="nano-gate" id="nano-gate" hidden>
    <p class="nano-kicker">On this computer</p>
    <h2 id="nano-headline">${escape(CHROME_ON_DEVICE_HEADLINE)}</h2>
    <p class="nano-lede">${escape(CHROME_ON_DEVICE_LINE)}</p>
    <div class="nano-actions">
      <button type="button" class="nano-btn nano-btn-load" id="load-synthetic-btn">Load a synthetic patient</button>
      ${renderWatchDemoButton(videoUrl)}
    </div>
    <details class="nano-reqs-disclosure" id="nano-reqs-disclosure">
      <summary>${escape(CHROME_REQS_SUMMARY)}</summary>
      ${renderChromeOnDeviceRequirements()}
    </details>
  </section>`;
}
