import { describe, expect, it } from "vitest";
import {
  CHROME_ON_DEVICE_HEADLINE,
  CHROME_ON_DEVICE_LINE,
  CHROME_PROMPT_API_URL,
  CHROME_ON_DEVICE_STORAGE,
  CHROME_ON_DEVICE_GPU,
  CHROME_REQS_SUMMARY,
  renderNoNanoScreen,
  renderWatchDemoButton,
} from "../src/ui/chrome-on-device";
import { PUBLIC_QUERY_LABEL } from "../src/outbox/interceptor";

describe("privacy and no-Nano copy", () => {
  it("uses the locked no-Nano headline and cites the official Prompt API page", () => {
    expect(CHROME_ON_DEVICE_HEADLINE).toBe(
      "Your chart stays here. This computer can't run on-device AI, but the full demo still works.",
    );
    expect(CHROME_ON_DEVICE_LINE).toBe(
      "Reading free-text clinic notes needs Chrome's on-device model. Inclusion never sends notes to the cloud instead.",
    );
    expect(CHROME_REQS_SUMMARY).toBe("Requirements (from Chrome docs, Oct 21, 2026)");
    expect(CHROME_PROMPT_API_URL).toBe("https://developer.chrome.com/docs/ai/prompt-api");
    expect(CHROME_ON_DEVICE_STORAGE).toContain("22 GB");
    expect(CHROME_ON_DEVICE_GPU).toContain("4 GB");
  });

  it("uses the public-query label verbatim", () => {
    expect(PUBLIC_QUERY_LABEL).toBe("Public query, no chart data");
  });
});

  it("renders load and watch actions, and keeps the watch button as an intentional placeholder without a video link", () => {
    const html = renderNoNanoScreen(undefined);
    expect(html).toContain("Load a synthetic patient");
    expect(html).toContain("Watch the 3-minute demo");
    expect(html).toContain("is-pending");
    expect(html).toContain("disabled");
    expect(html).toContain("The recorded demo will be linked here once it is approved for posting.");
    expect(html).toContain("<details");
    expect(html).toContain(CHROME_REQS_SUMMARY);
    expect(html).toContain(CHROME_PROMPT_API_URL.replace("https://", ""));
    expect(renderWatchDemoButton("https://www.youtube.com/watch?v=example")).toContain("href=\"https://www.youtube.com/watch?v=example\"");
    expect(renderWatchDemoButton("https://www.youtube.com/watch?v=example")).not.toContain("is-pending");
  });
