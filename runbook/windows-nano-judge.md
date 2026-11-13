# Runbook: on-device fuzzy judge on THINK

This is the November 16 accuracy spike's on-device half. The cloud eligibility parser is a separate job and must never receive these clinic notes.

The page talks only to Chrome's Prompt API on this computer. It judges the two fuzzy gold criteria (C25 measurable disease, C26 life expectancy) against the three synthetic personas, for six prompts in total. The notes are made up. Do not paste a real chart.

First run, November 11, 2026, 8:57 PM ET (America/New_York), Chrome 157: 5 / 6. The miss was C25 Sam (gold unknown, Nano said met by assuming baseline timing). The page has been hardened since that run:

- The structured output now requires `evidence_quote`.
- `met` or `not_met` is kept only if that quote is a verbatim substring of the clinic note (at least 8 characters) and the reason (or quote) does not hedge with assuming, implying, likely, or presumably. Otherwise the page records `unknown`.
- Status log line breaks should now be real line breaks, not a literal `\n`.

## Rerun (please do this on THINK)

The local server from the hardware check is still serving `C:\Users\Pravin\inclusion-nano-check` at `http://127.0.0.1:4173`. An updated `nano-judge.html` was copied there.

1. Open Google Chrome, not Edge.
2. Go to `http://127.0.0.1:4173/nano-judge.html`.
3. Hard refresh with Ctrl+F5 so you are not looking at the cached first-run page. You should see a sentence about `evidence_quote` under the heading.
4. Click "Check availability". You want `available`.
5. Click "Run the six fuzzy judgments". Keep the tab open.
6. Screenshot the result line and the whole table, including the Gold, Final, and Model columns. Send that back.

C25 Sam is the one to watch. Gold is `unknown`. If Nano again tries to say `met` by assuming timing, the page should downgrade it to `unknown` and note that in the Model / Reason columns.

If port 4173 is not running, in PowerShell:

```powershell
cd C:\Users\Pravin\inclusion-nano-check
python -m http.server 4173 --bind 127.0.0.1
```

Then open the URL above in Chrome and hard refresh.

A useful bar for this slice is still 5 or 6 of 6 matching gold, with `unknown` used when the note is silent (C26 for everyone; C25 for Jordan and Sam), not as a way to dodge a fact the note actually states (C25 for Alex: "Measurable lung and mediastinal disease on CT").
