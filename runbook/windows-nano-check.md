# Runbook: Gemini Nano check on the Windows PC "THINK"

Kill check: if this machine cannot run the on-device model by Friday, November 14, 2026, we stop Inclusion.

You reported that THINK has 64 GB of RAM, 16 cores, an RTX 3070, about 1.2 TB free, and desktop Chrome 157. That meets Chrome's published bar (Windows 10 or 11, 22 GB free on the Chrome profile drive, and either a GPU with more than 4 GB of VRAM or a CPU with 16 GB of RAM and 4 or more cores). This runbook is how you prove the model actually starts, which the hardware list alone does not.

The check uses a tiny local page. It does not use Firebase, and it does not call a cloud model. It sends one short, synthetic sentence to the on-device Prompt API and asks for structured JSON.

## 1. Confirm the machine

On THINK:

1. Open `chrome://settings/help` and confirm Chrome is 139 or higher (157 is fine). Use the desktop browser, not Chrome on a phone.
2. Confirm you still have at least 22 GB free on the drive that holds your Chrome profile, usually `C:`.
3. Stay on an unmetered connection for the first download (ordinary home Wi-Fi is fine). After the model is on disk, it can run offline.

## 2. Flags

Firebase's current web hybrid guide (https://firebase.google.com/docs/ai-logic/hybrid/web/get-started, updated 2026-11-10) still asks you to enable this flag:

1. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`
2. Set it to Enabled.
3. Relaunch Chrome when it asks you to.

Inclusion does not send images. The flag is listed because it is the documented Firebase setup step. If the Prompt API already works for text without it, say so in the result; leave the flag on anyway so we match the docs.

## 3. Check internals before the test page

1. Open `chrome://on-device-internals`.
2. Open the Broker State tab and look for errors.
3. Note the model name and the on-disk size if the page shows them. Chrome's docs say the exact size can change with updates, so write down what you see rather than assuming a number.
4. Open DevTools (F12) on any tab and run this in the console:

```js
await LanguageModel.availability({
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
});
```

You want `"available"`, `"downloadable"`, or `"downloading"`. If you get `"unavailable"`, stop and send the Broker State details. That is a fail for the November 14 check.

## 4. Serve the test page

Do not open the file as `file://`. Chrome is picky about that for this API.

From a checkout of this repo, in PowerShell:

```powershell
cd path\to\inclusion
npx --yes serve runbook -p 4173
```

Or, if you would rather not use npx:

```powershell
cd path\to\inclusion\runbook
python -m http.server 4173
```

Then open http://localhost:4173/nano-check.html in that same Chrome window.

## 5. Run the check

1. Click "Check availability." The page will show the `LanguageModel.availability()` result.
2. If it says `downloadable`, click "Download model and run the prompt." Stay on the page. The first download can take several minutes. You need to click the button yourself; the API requires a user gesture.
3. If it says `available`, the same button just runs the prompt.
4. The page sends this synthetic sentence, and only this sentence:

   `Synthetic note, not a real patient: 62-year-old with stage IV lung adenocarcinoma, ECOG 1.`

   It asks the model for JSON of the form `{ "ecog": 1 }` using a `responseConstraint`.
5. Pass: the model returns JSON whose `ecog` value is the number 1 (a string `"1"` is also accepted).
6. Fail: `unavailable`, an exception, empty output, or a value other than 1.

Paste the on-page report back into the Inclusion chat: availability, pass or fail, any error text, the raw model output, and the model size from `chrome://on-device-internals` if you have it. Do not paste real medical notes into this page.

## 6. If the download starts but stalls

1. Confirm free disk is still above 22 GB.
2. Look at Broker State again for errors.
3. Restart Chrome once, then reopen the test page.
4. If it is still not `available` or `downloadable` after that, we treat November 14 as a stop unless we have a clear, short path to fix it.
