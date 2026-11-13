# Firebase AI Logic web SDK, checked November 11, 2026

Sources, all last updated 2026-11-10 UTC unless noted:

- https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
- https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options
- https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- https://developer.chrome.com/docs/ai/get-started (Chrome hardware; page itself last updated May 20, 2025, still the official hardware table)
- https://developer.chrome.com/docs/ai/prompt-api (Prompt API, last updated October 21, 2026)
- Installed package: `firebase@13.3.0` (typings from `@firebase/ai`)

No Firebase or Google Cloud project was created, and no paid API was called.

## Packages and imports

```ts
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";
```

Hybrid inference needs Firebase JS SDK v12.5.0 or later. 13.3.0 meets that. The end user needs Chrome on desktop, version 139 or higher. The Prompt API itself shipped for the web in Chrome 148.

## Inference modes

SDK string values, confirmed in `@firebase/ai` typings:

| Constant | Value |
|---|---|
| `InferenceMode.PREFER_ON_DEVICE` | `"prefer_on_device"` |
| `InferenceMode.ONLY_ON_DEVICE` | `"only_on_device"` |
| `InferenceMode.PREFER_IN_CLOUD` | `"prefer_in_cloud"` |
| `InferenceMode.ONLY_IN_CLOUD` | `"only_in_cloud"` |

Each response exposes `inferenceSource`: `"on_device"` or `"in_cloud"` (`InferenceSource` in the SDK).

Default cloud model, starting with JS SDK v13.0.0: `gemini-3.5-flash-lite`. Override with `inCloudParams`. On-device options go in `onDeviceParams` (Chrome Prompt API `createOptions`).

`initializeDeviceModel(onDownloadProgress?)` must be called after or on a user gesture, before `generateContent()`. If the model is still downloading:

- `ONLY_ON_DEVICE` waits for the download, which can take several minutes.
- `PREFER_ON_DEVICE` and `PREFER_IN_CLOUD` do not wait and fall back to the cloud.

That last point is why chart reads in Inclusion never use `PREFER_ON_DEVICE`. A missing model would send the chart to the cloud. We use `ONLY_ON_DEVICE` and, if the model is not there, the short self-entry form.

## On-device capabilities that matter here

Supported: single-turn text generation, structured JSON or enum output, optional JPEG/PNG input. Limit: 9,216 tokens.

Not on-device: chat, PDFs, audio, video, function calling, search grounding. Those throw under `ONLY_ON_DEVICE`.

Inclusion will not send images. PDF text is extracted with pdf.js on the page, then (when the model is present) the text is prompted as text.

## Chrome flags and internals

Firebase's get-started page still tells you to set this flag to Enabled, then restart Chrome:

- `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`

Inclusion itself does not use image input. The flag is listed because it is the documented Firebase setup step.

Useful internals:

- `chrome://settings/help` for the Chrome version.
- `chrome://on-device-internals` for model size, download state, and the Broker State tab.
- In DevTools: `await LanguageModel.availability({ expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] })`
- Values: `"unavailable"`, `"downloadable"`, `"downloading"`, `"available"`.
- `LanguageModel.create()` needs a user activation if the model still has to download.
- Structured output uses `responseConstraint` on `prompt()`.

## Hardware (Chrome)

Windows 10/11, macOS 13+, Linux, or Chromebook Plus. At least 22 GB free on the Chrome profile volume. GPU with more than 4 GB of VRAM, or a CPU with 16 GB of RAM and 4 or more cores. Not Chrome on Android or iOS. After download, if free space falls under 10 GB, Chrome may remove the model.

This build box is below that line (15 GB RAM, tight disk). The Windows PC "THINK" as reported (64 GB RAM, 16 cores, RTX 3070, 1.2 TB free, Chrome 157) meets the published requirements. That still has to be proven with `LanguageModel.availability()` by November 14.

## App Check

Firebase AI Logic setup in the console enforces App Check. For a hosted web app, the production provider is reCAPTCHA Enterprise (score-based, invisible). Create a Web key in Google Cloud Fraud Defense / reCAPTCHA, list only the production domains, and do not add `localhost` to a production key.

Local development uses the App Check debug provider:

```ts
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
```

Visit the app, copy the debug token from the console, and safelist it under Security > App Check > Apps > Manage debug tokens. Do not commit the token. Debug tokens are accepted in contest submissions.

`isTokenAutoRefreshEnabled` should be set to `true`. Default token TTL is 1 hour. reCAPTCHA Enterprise assessments above the no-cost quota are billed; see the App Check pricing notes on that doc.

## What we will not do on day 1

Create a Firebase project, enable billing, call Gemini, or register a reCAPTCHA key. See `notes/next-firebase-project.md`.
