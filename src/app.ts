import { extractPdfText } from "./intake/pdf";
import { beginFactSheetApply, endFactSheetApply, factSheetFromSelfEntry, isApplyingFactSheet } from "./intake/self-entry";
import { createOutbox, networkLabel, type Outbox, type OutboxEntry } from "./outbox/interceptor";
import { factSheetSnippets, emptyFactSheet, type FactSheet, type HomeLocation } from "./schema/fact-sheet";
import { defaultDeviceStatus, mustUseSelfEntryForm, probeDeviceModelStatus, readFirebaseConfig } from "./hybrid/client";
import type { DeviceModelStatus } from "./hybrid/modes";
import { bootstrapFirebase } from "./firebase/bootstrap";
import { extractClinicNoteOnDevice } from "./intake/nano-extract";
import { nanoDebugPanelMarkup, renderNanoDebug } from "./intake/nano-debug";
import { loadPublicEligibility, refreshPublicTrialParse, refreshRateState } from "./parse/refresh-public-parse";
import { loadCriteriaFromFirestore, loadCriteriaFromLocalJson, type CriteriaCache } from "./cache/load";
import { classifyCacheError, resolvePublicCache } from "./cache/resolve";
import { formatPhase, loadTrialMeta, nearestSite, type TrialMeta, type TrialSite } from "./cache/trial-meta";
import { haversineMiles } from "./match/distance";
import { rankTrials, type TrialMatch } from "./match/evaluate";
import {
  ATTRIBUTION,
  GROUP_DISCUSS,
  GROUP_MET,
  GROUP_NOT_MET,
  MEDICAL_DISCLAIMER,
  APP_DESCRIPTOR,
  APP_NAME,
  APP_TITLE,
  TAGLINE,
  TIER_UNLIKELY,
  attributionWithTimestamp,
} from "./ui/copy";
import { icon } from "./ui/icons";
import { setSyntheticBanner } from "./ui/synthetic-banner";
import { playHybridFlow, renderHybridFlow, setChartInferenceSource, setHybridStage } from "./ui/hybrid-flow";
import {
  bindRegionMap,
  loadRegionAtlas,
  renderRegionMap,
  syncMapSelection,
  type MapMarker,
} from "./ui/map";
import { keyCriteriaTally, renderCriteriaMatrix } from "./ui/matrix";
import { plainTrialSubtitle } from "./ui/subtitle";
import { countUp, renderStrengthRing } from "./ui/ring";
import { askYourOncologistItems, plainDiscussAsk, renderQuoteHtml } from "./ui/verdict";
import { renderNoNanoScreen } from "./ui/chrome-on-device";
import { markSic } from "./ui/sic";
import personasDoc from "../gold/personas.json";

type Persona = (typeof personasDoc.personas)[number];

export interface AppState {
  rawChart: string;
  factSheet: FactSheet;
  outbox: Outbox;
  records: CriteriaCache;
  personaId: string | null;
  trialMeta: Map<string, TrialMeta>;
}

const SENSITIVE_QUERY = new Set(["key", "token", "api_key", "apikey", "auth", "access_token", "id_token", "debug_token"]);

const view = {
  selectedNctId: null as string | null,
  all: [] as TrialMatch[],
  shown: [] as TrialMatch[],
  atlas: null as Awaited<ReturnType<typeof loadRegionAtlas>> | null,
};

export function boot(root: HTMLElement): AppState {
  const state: AppState = {
    rawChart: "",
    factSheet: emptyFactSheet("self_entry"),
    outbox: null as unknown as Outbox,
    records: { trials: [], source: "empty" },
    personaId: null,
    trialMeta: new Map(),
  };
  state.outbox = createOutbox(() => factSheetSnippets(state.factSheet, state.rawChart));
  state.outbox.install();

  const status = defaultDeviceStatus();
  applyTheme(readTheme());
  document.title = APP_TITLE;

  const demoPersonas = personasDoc.personas.filter((p) => p.id === "alex-rivera" || p.id === "sam-okonkwo");

  root.innerHTML = `
    <a class="skip" href="#main">Skip to main content</a>
    <div class="trust-strip" role="region" aria-label="Privacy proof">
      <div class="brand">
        <span class="mark" aria-hidden="true"></span>
        <span class="wordmark">${escapeHtml(APP_NAME)}</span>
        <span class="brand-rule" aria-hidden="true"></span>
        <span class="brand-descriptor">${escapeHtml(APP_DESCRIPTOR)}</span>
      </div>
      <p class="synthetic-banner" id="synthetic-banner" role="status">Synthetic demo data</p>
      <button type="button" class="proof-btn" id="proof-toggle" aria-expanded="false" aria-controls="outbox-drawer">
        <span class="proof-full" id="proof-label">Proof · 0 chart bytes sent</span>
        <span class="proof-short" id="proof-label-short">Proof</span>
      </button>
      <button type="button" class="theme-toggle" id="theme-toggle" aria-pressed="false" aria-label="Switch theme">${icon("sun")}<span class="theme-label">Light</span></button>
    </div>
    <div class="drawer-backdrop" id="drawer-backdrop" hidden></div>
    <aside class="drawer" id="outbox-drawer" hidden role="dialog" aria-labelledby="outbox-title">
      <div class="drawer-head">
        <h2 id="outbox-title">Outbox</h2>
        <p class="bytes" id="outbox-bytes">0 bytes of chart text sent</p>
        <button type="button" class="secondary" id="proof-close">Close</button>
      </div>
      <p class="hint">Requests that left this page, including public trial lookups. Chart text is blocked. Condition-only queries (Firestore cache reads, ClinicalTrials.gov condition searches) are labeled "Public query, no chart data."</p>
      <ul class="outbox" id="outbox-list"><li>Nothing has left this computer yet.</li></ul>
    </aside>
    <div class="detail-backdrop" id="detail-backdrop" hidden></div>
    <aside class="detail-panel" id="detail-panel" hidden role="dialog" aria-modal="true" aria-labelledby="detail-title"></aside>
    <div class="wrap" id="main">
      <section class="intake-stage" id="intake-stage">
        <div class="hero">
          <header>
            <p class="eyebrow">A briefing for you and your oncologist</p>
            <h1>${escapeHtml(APP_NAME)}</h1>
            <p class="hero-descriptor">${escapeHtml(APP_DESCRIPTOR)}</p>
            <p class="lede">${escapeHtml(TAGLINE)}</p>
          </header>
          <p class="disclaimer">${escapeHtml(MEDICAL_DISCLAIMER)}</p>
        </div>
        ${renderNoNanoScreen(import.meta.env.VITE_DEMO_VIDEO_URL)}
        <p class="cache-banner" id="cache-banner" hidden role="status"></p>
        ${renderHybridFlow()}
        <div class="intake-grid">
          <ol class="steps" id="intake" data-step="1">
            <li class="stepper-nav" aria-label="Intake steps">
              <button type="button" class="step-tab" data-go-step="1" aria-current="step"><span>01</span> Load</button>
              <button type="button" class="step-tab" data-go-step="2"><span>02</span> Chart</button>
              <button type="button" class="step-tab" data-go-step="3"><span>03</span> Facts</button>
            </li>
            <li class="card step" id="step-1" data-step-panel="1">
              <div class="step-body">
                <h2>Load a synthetic patient</h2>
                <p class="hint">Start with a demo chart. These are not real people. Never paste a real medical record into a shared or public build.</p>
                <div class="persona-row" role="group" aria-label="Synthetic demo patients">
                  ${demoPersonas
                    .map((p) => {
                      const home = (p.factSheet as FactSheet).home;
                      const place = home ? `${home.city}, ${home.state}` : "";
                      return `<button type="button" class="persona" data-persona="${escapeHtml(p.id)}">
                        <span class="persona-av">${escapeHtml(initials(p.displayName))}</span>
                        <span class="persona-copy"><span class="persona-name">Load ${escapeHtml(p.displayName)}</span>${place ? `<span class="persona-place">${escapeHtml(place)}</span>` : ""}</span>
                      </button>`;
                    })
                    .join("")}
                </div>
                <button type="button" class="text-btn" id="enter-chart-btn" data-go-step="2">Or enter a chart yourself</button>
              </div>
            </li>
            <li class="card step" id="step-2" data-step-panel="2">
              <div class="step-body">
                <h2>Upload or type a chart</h2>
                <p class="hint">Paste text from a portal note, or drop a PDF. We read PDFs with pdf.js on this page. There is no image upload. Nothing you type here is sent to a cloud model.</p>
                <label for="chart">Clinic note</label>
                <textarea id="chart" placeholder="Synthetic notes only in this demo."></textarea>
                <div class="drop-zone" id="drop-zone">
                  <p class="drop-lead">${icon("file")} <span>Drop a PDF here</span></p>
                  <p class="file-label">Or choose a file</p>
                  <label class="file-picker" for="pdf">
                    <input id="pdf" class="file-input" type="file" accept="application/pdf" />
                    <span class="file-btn">Choose PDF</span>
                    <span class="file-name" id="pdf-name">No file chosen</span>
                  </label>
                </div>
                <p class="status" id="device-status"></p>
                <p class="inference-source" id="chart-inference-flag" hidden>inferenceSource: on-device</p>
                <button type="button" class="primary-btn" id="read-note-btn">
                  <span class="btn-icon" aria-hidden="true">${icon("spark")}</span>
                  <span class="btn-label">Read this note on this device</span>
                </button>
                ${nanoDebugPanelMarkup()}
                <ul class="quote-gate-list" id="note-quotes" hidden></ul>
                <button type="button" class="secondary" data-go-step="3">Continue to facts</button>
              </div>
            </li>
            <li class="card step" id="step-3" data-step-panel="3">
              <div class="step-body">
                <h2>Review extracted facts</h2>
                <p class="hint" id="facts-hint">The facts used for matching stay on this computer. Edit them if something was missed.</p>
                <details class="facts-editor" id="facts-editor">
                  <summary>Enter or edit facts</summary>
                <div id="self-entry">
                  <p class="hint" id="form-fallback-hint">The on-device model isn't available, so this form is the fallback. Nothing you type here is sent to a cloud model.</p>
                  <div class="row">
                    <div>
                      <label for="age">Age</label>
                      <input id="age" type="number" min="0" max="120" />
                    </div>
                    <div>
                      <label for="ecog">ECOG</label>
                      <select id="ecog">
                        <option value="">Unknown</option>
                        <option>0</option><option>1</option><option>2</option><option>3</option><option>4</option>
                      </select>
                    </div>
                  </div>
                  <div class="row">
                    <div>
                      <label for="stage">Stage</label>
                      <select id="stage">
                        <option value="unknown">Unknown</option>
                        <option>IIIA</option><option>IIIB</option><option>IIIC</option>
                        <option>IV</option><option>IVA</option><option>IVB</option>
                      </select>
                    </div>
                    <div>
                      <label for="histology">Histology</label>
                      <select id="histology">
                        <option value="unknown">Unknown</option>
                        <option value="adenocarcinoma">Adenocarcinoma</option>
                        <option value="squamous">Squamous</option>
                        <option value="large_cell">Large cell</option>
                        <option value="nsclc_nos">NSCLC, not otherwise specified</option>
                      </select>
                    </div>
                  </div>
                  <label for="egfr">EGFR</label>
                  <input id="egfr" placeholder="For example: exon 19 deletion, or absent" />
                  <label for="alk">ALK</label>
                  <input id="alk" placeholder="For example: rearrangement, or absent" />
                  <label for="kras">KRAS</label>
                  <input id="kras" placeholder="For example: G12C, or absent" />
                  <label for="pdl1">PD-L1 TPS (%)</label>
                  <input id="pdl1" type="number" min="0" max="100" />
                  <label for="lines">Prior lines of systemic therapy</label>
                  <input id="lines" type="number" min="0" max="20" />
                  <label for="brain">Brain metastases</label>
                  <select id="brain">
                    <option value="unknown">Unknown</option>
                    <option value="none">None</option>
                    <option value="treated_stable">Treated and stable</option>
                    <option value="untreated">Untreated</option>
                  </select>
                  <label for="prior-therapies">Prior therapies, as written, comma-separated</label>
                  <input id="prior-therapies" placeholder="For example: osimertinib, platinum" />
                  <div class="row">
                    <div>
                      <label for="egfr-lab">Kidney function, eGFR (mL/min)</label>
                      <input id="egfr-lab" type="number" min="0" max="200" />
                    </div>
                    <div>
                      <label for="hemoglobin">Hemoglobin (g/dL)</label>
                      <input id="hemoglobin" type="number" min="0" max="25" step="0.1" />
                    </div>
                  </div>
                </div>
                </details>
                <button type="button" id="review">Compare with nearby trials</button>
              </div>
            </li>
          </ol>
          <aside class="chart-card" id="chart-card" data-filled="false">
            <div class="chart-card-head">
              <div class="avatar" id="chart-avatar" aria-hidden="true">?</div>
              <div>
                <p class="chart-name" id="chart-name">No chart yet</p>
                <p class="synthetic-banner" id="synthetic-banner-card">Synthetic demo data</p>
                <p class="on-device-badge">${icon("shield")} On this device</p>
              </div>
            </div>
            <div class="facts" id="facts-preview"><p class="empty-state">Load a synthetic patient or enter a chart first.</p></div>
          </aside>
        </div>
      </section>
      <p class="intake-done no-print" id="intake-done" hidden>
        <span>No chart text left this device.</span>
      </p>
      <section class="results-stage" id="results-stage" hidden>
        ${renderHybridFlow({ compact: true })}
        <div class="results-toolbar no-print">
          <span>No chart text left this device.</span>
          <button type="button" class="secondary" id="edit-intake">Edit chart or facts</button>
          <button type="button" id="print">Print this sheet</button>
        </div>
        <div class="hero-stats" id="hero-stats"></div>
        <p class="sheet-hint" id="sheet-hint"></p>
        <div class="command-tabs no-print" role="tablist" aria-label="Results layout">
          <button type="button" class="command-tab" data-pane="map" role="tab" aria-selected="false">${icon("map")} Map</button>
          <button type="button" class="command-tab is-active" data-pane="list" role="tab" aria-selected="true">${icon("list")} Trials</button>
        </div>
        <div class="command" id="command-view" data-pane="list">
          <div class="command-map" id="command-map">
            <div class="map-frame" id="map-frame"><p class="hint">The regional map loads from a bundled atlas on this page. No tiles are fetched.</p></div>
          </div>
          <div class="command-list">
            <div class="skeleton" id="sheet-skeleton" hidden>
              <div class="skel"></div><div class="skel"></div><div class="skel"></div>
            </div>
            <div class="briefing" id="question-list"></div>
          </div>
        </div>
      </section>
      <section class="sheet" id="print-sheet" aria-live="polite">
        <header class="print-brand">
          <p class="print-wordmark">${escapeHtml(APP_NAME)}</p>
          <p class="print-descriptor">${escapeHtml(APP_DESCRIPTOR)}</p>
        </header>
        <h2>Questions for your oncologist</h2>
        <p class="synthetic-banner" id="synthetic-banner-print">Synthetic demo data</p>
        <p class="care-team-note">Discuss these findings with your care team.</p>
        <p class="disclaimer" id="sheet-disclaimer" hidden>${escapeHtml(MEDICAL_DISCLAIMER)}</p>
        <div id="briefing-summary" class="summary" hidden></div>
        <div class="print-briefing" id="print-briefing"></div>
        <p class="attr" id="attribution">${escapeHtml(ATTRIBUTION)}</p>
      </section>
    </div>
  `;

  const statusEl = root.querySelector("#device-status") as HTMLElement;
  const applyDeviceMode = (next: DeviceModelStatus): boolean => {
    const formOnly = mustUseSelfEntryForm(next) || !readFirebaseConfig();
    statusEl.textContent = describeStatus(next, formOnly);
    setDeviceIndicator(root, formOnly ? "idle" : "ready", formOnly ? "Self-entry on this device" : "On this device");
    const fallbackHint = root.querySelector("#form-fallback-hint") as HTMLElement | null;
    if (fallbackHint) fallbackHint.hidden = !formOnly;
    const nanoGate = root.querySelector("#nano-gate") as HTMLElement | null;
    if (nanoGate) nanoGate.hidden = !formOnly;
    root.classList.toggle("no-nano", formOnly);
    const enterBtn = root.querySelector("#enter-chart-btn") as HTMLButtonElement | null;
    if (enterBtn) {
      enterBtn.dataset.goStep = formOnly ? "3" : "2";
      enterBtn.textContent = formOnly ? "Enter facts on this device" : "Or enter a chart yourself";
    }
    const readBtn = root.querySelector("#read-note-btn") as HTMLButtonElement | null;
    if (readBtn) readBtn.hidden = formOnly;
    if (formOnly) setChartInferenceSource(root, "unavailable");
    numberIntakeTabs(root);
    return formOnly;
  };
  let useForm = applyDeviceMode(status);
  renderNanoDebug(root, null);
  root.querySelector("#load-synthetic-btn")?.addEventListener("click", () => {
    setStep(root, 1);
    const row = root.querySelector(".persona-row") as HTMLElement | null;
    row?.classList.add("is-invited");
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    (root.querySelector<HTMLButtonElement>("[data-persona]"))?.focus();
  });
  setChartInferenceSource(root, "unavailable");
  setSyntheticBanner(root, null);

  void probeDeviceModelStatus().then((probed) => {
    useForm = applyDeviceMode(probed);
    if (!useForm) {
      statusEl.textContent = describeStatus(probed, false) + " You can paste a synthetic clinic note and read it with Chrome's on-device model.";
    }
  });

  const chart = root.querySelector("#chart") as HTMLTextAreaElement;
  chart.addEventListener("input", () => {
    state.rawChart = chart.value;
    if (state.personaId) state.personaId = null;
    setSyntheticBanner(root, null);
    setChartInferenceSource(root, "self-entry");
    const flag = root.querySelector("#chart-inference-flag") as HTMLElement | null;
    if (flag) flag.hidden = true;
    refreshProof(root, state.outbox);
    if (chart.value.trim()) setChartIdentity(root, "Entered chart", "CH");
  });

  const readNoteBtn = root.querySelector("#read-note-btn") as HTMLButtonElement | null;
  readNoteBtn?.addEventListener("click", () => {
    void (async () => {
      const note = chart.value.trim();
      if (note.length < 20) {
        statusEl.textContent = "Paste a synthetic clinic note first.";
        statusEl.classList.add("error");
        return;
      }
      statusEl.classList.remove("error");
      statusEl.textContent = "Reading this note on this device with Chrome's on-device model. Nothing is sent to a cloud model.";
      setDeviceIndicator(root, "loading", "On-device · Gemini Nano");
      setReadNoteButtonState(readNoteBtn, true);
      const flag = root.querySelector("#chart-inference-flag") as HTMLElement | null;
      try {
        const session = await bootstrapFirebase();
        if (!session) throw new Error("Firebase is not configured on this page.");
        const extracted = await extractClinicNoteOnDevice(session.app, note);
        applyFactSheet(root, state, extracted.factSheet);
        state.rawChart = note;
        state.personaId = null;
        setSyntheticBanner(root, null);
        setChartInferenceSource(root, "nano");
        if (flag) {
          flag.textContent = "inferenceSource: on-device";
          flag.hidden = false;
        }
        renderNoteQuotes(root, extracted.excerpts, extracted.droppedUnquoted);
        renderNanoDebug(root, { rawModel: extracted.rawModel, factSheet: extracted.factSheet });
        const quoteNote = extracted.excerpts.length
          ? ` Kept ${extracted.excerpts.length} verbatim quote${extracted.excerpts.length === 1 ? "" : "s"}.`
          : " No verbatim quotes were returned, so check the facts before comparing.";
        statusEl.textContent = `On-device model filled the fact chips.${quoteNote}`;
        setDeviceIndicator(root, "ready", "On-device · Gemini Nano");
        setChartIdentity(root, "Entered chart", "CH");
        setStep(root, 3);
      } catch (err) {
        statusEl.textContent = `Could not read the note on this device: ${err instanceof Error ? err.message : String(err)} The self-entry form is still available. Nothing was sent to a cloud model.`;
        statusEl.classList.add("error");
        setDeviceIndicator(root, "error", "On-device read failed");
        if (flag) flag.hidden = true;
      } finally {
        setReadNoteButtonState(readNoteBtn, false);
      }
    })();
  });

  const pdf = root.querySelector("#pdf") as HTMLInputElement;
  const pdfName = root.querySelector("#pdf-name") as HTMLElement | null;
  const onPdf = async (file: File): Promise<void> => {
    if (pdfName) pdfName.textContent = file.name;
    statusEl.textContent = "Reading the PDF on this page…";
    setDeviceIndicator(root, "loading", "Reading on this device");
    try {
      const text = await extractPdfText(file);
      chart.value = text;
      state.rawChart = text;
      state.personaId = null;
      setChartIdentity(root, file.name.replace(/\.pdf$/i, ""), initials(file.name));
      statusEl.textContent = `Read ${text.length} characters from the PDF. Nothing was uploaded.`;
      statusEl.classList.remove("error");
      setDeviceIndicator(root, "ready", "On this device");
    } catch (err) {
      statusEl.textContent = `Couldn't read that PDF: ${err instanceof Error ? err.message : String(err)}`;
      statusEl.classList.add("error");
      setDeviceIndicator(root, "error", "Could not read the PDF");
    }
  };
  pdf.addEventListener("change", () => {
    const file = pdf.files?.[0];
    if (!file) {
      if (pdfName) pdfName.textContent = "No file chosen";
      return;
    }
    void onPdf(file);
  });
  bindDropZone(root, (file) => void onPdf(file));

  root.querySelector("#print")?.addEventListener("click", () => window.print());
  root.querySelector("#theme-toggle")?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next);
    try {
      localStorage.setItem("inclusion-theme", next);
    } catch {
      // Theme preference is optional.
    }
  });
  syncThemeToggle();

  root.querySelector("#edit-intake")?.addEventListener("click", () => {
    closeDetail(root);
    setIntakeCollapsed(root, false);
    root.querySelector("#intake")?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  root.querySelector("#proof-toggle")?.addEventListener("click", () => setDrawer(root, true));
  root.querySelector("#proof-close")?.addEventListener("click", () => setDrawer(root, false));
  root.querySelector("#drawer-backdrop")?.addEventListener("click", () => setDrawer(root, false));
  root.querySelector("#detail-backdrop")?.addEventListener("click", () => closeDetail(root));
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const detail = root.querySelector("#detail-panel") as HTMLElement | null;
    if (detail && !detail.hidden) {
      closeDetail(root);
      return;
    }
    setDrawer(root, false);
  });

  for (const btn of root.querySelectorAll<HTMLButtonElement>("[data-go-step]")) {
    btn.addEventListener("click", () => setStep(root, Number(btn.dataset.goStep) || 1));
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>("[data-pane]")) {
    btn.addEventListener("click", () => setCommandPane(root, btn.dataset.pane === "map" ? "map" : "list"));
  }

  for (const btn of root.querySelectorAll<HTMLButtonElement>("[data-persona]")) {
    btn.addEventListener("click", () => {
      const persona = demoPersonas.find((p) => p.id === btn.dataset.persona);
      if (!persona) return;
      applyPersona(root, state, persona);
      statusEl.textContent = `Loaded ${persona.displayName}, a synthetic demo patient. No chart text was sent.`;
      statusEl.classList.remove("error");
      setDeviceIndicator(root, "ready", "On this device");
      setIntakeCollapsed(root, false);
      setStep(root, 3);
    });
  }

  const selfEntry = root.querySelector("#self-entry");
  selfEntry?.addEventListener("input", () => {
    if (isApplyingFactSheet()) return;
    state.personaId = null;
    state.factSheet = factSheetFromSelfEntry(root, state.factSheet);
    renderFactsPreview(root, state.factSheet);
    setSyntheticBanner(root, null);
    setChartInferenceSource(root, "self-entry");
  });

  void loadCache(state, root, statusEl);
  refreshProof(root, state.outbox);
  root.querySelector("#review")?.addEventListener("click", () => {
    if (!state.personaId) {
      state.factSheet = factSheetFromSelfEntry(root, state.factSheet);
      setChartInferenceSource(root, "self-entry");
      setSyntheticBanner(root, null);
    }
    renderFactsPreview(root, state.factSheet);
    setDeviceIndicator(root, "judging", "Matching on this device");
    refreshProof(root, state.outbox);
    root.classList.add("is-matching");
    const run = async (): Promise<void> => {
      await playHybridFlow(root);
      renderMatches(root, state);
      setIntakeCollapsed(root, true);
      statusEl.textContent = describeCache(state.records, "Fact sheet stayed on this page.");
      statusEl.classList.remove("error");
      setDeviceIndicator(root, "ready", "Judged on this device");
      refreshProof(root, state.outbox);
      root.classList.remove("is-matching");
      root.querySelector("#results-stage")?.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    void run();
  });

  return state;
}


export const READ_NOTE_IDLE_LABEL = "Read this note on this device";
export const READ_NOTE_LOADING_LABEL = "Reading on this device…";

/** Loading state for the primary on-device read button. */
export function setReadNoteButtonState(btn: HTMLButtonElement, running: boolean): void {
  btn.disabled = running;
  btn.classList.toggle("is-loading", running);
  btn.setAttribute("aria-busy", running ? "true" : "false");
  const label = btn.querySelector(".btn-label");
  if (label) label.textContent = running ? READ_NOTE_LOADING_LABEL : READ_NOTE_IDLE_LABEL;
}

/** Visible intake tabs are numbered 01, 02, … even when the chart step is hidden. */
export function numberIntakeTabs(root: HTMLElement): void {
  const hideChart = root.classList.contains("no-nano");
  let n = 0;
  for (const btn of root.querySelectorAll<HTMLButtonElement>(".step-tab")) {
    if (hideChart && btn.dataset.goStep === "2") continue;
    n += 1;
    const span = btn.querySelector("span");
    if (span) span.textContent = String(n).padStart(2, "0");
  }
}

function setStep(root: HTMLElement, step: number): void {
  const n = Math.min(3, Math.max(1, step));
  const intake = root.querySelector("#intake") as HTMLElement | null;
  if (intake) intake.dataset.step = String(n);
  for (const btn of root.querySelectorAll<HTMLButtonElement>("[data-go-step]")) {
    const current = Number(btn.dataset.goStep) === n;
    if (btn.classList.contains("step-tab")) btn.setAttribute("aria-current", current ? "step" : "false");
  }
  root.querySelector(`#step-${n}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function setCommandPane(root: HTMLElement, pane: "map" | "list"): void {
  const viewEl = root.querySelector("#command-view") as HTMLElement | null;
  if (viewEl) viewEl.dataset.pane = pane;
  for (const btn of root.querySelectorAll<HTMLButtonElement>("[data-pane]")) {
    const on = btn.dataset.pane === pane;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  }
}

function bindDropZone(root: HTMLElement, onFile: (file: File) => void): void {
  const zone = root.querySelector("#drop-zone") as HTMLElement | null;
  if (!zone) return;
  const over = (on: boolean) => zone.classList.toggle("is-drag", on);
  zone.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    over(true);
  });
  zone.addEventListener("dragleave", () => over(false));
  zone.addEventListener("drop", (ev) => {
    ev.preventDefault();
    over(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) onFile(file);
  });
}

function applyFactSheet(root: HTMLElement, state: AppState, sheet: FactSheet): void {
  beginFactSheetApply();
  try {
  state.factSheet = structuredClone(sheet);
  setInput(root, "age", sheet.ageYears == null ? "" : String(sheet.ageYears));
  setInput(root, "ecog", sheet.ecog == null ? "" : String(sheet.ecog));
  setInput(root, "stage", sheet.stage || "unknown");
  setInput(root, "histology", sheet.histology || "unknown");
  setInput(root, "egfr", formatBiomarker(sheet.biomarkers.egfr));
  setInput(root, "alk", formatBiomarker(sheet.biomarkers.alk));
  setInput(root, "kras", formatBiomarker(sheet.biomarkers.kras));
  setInput(root, "pdl1", sheet.biomarkers.pdL1TpsPercent == null ? "" : String(sheet.biomarkers.pdL1TpsPercent));
  setInput(root, "lines", sheet.priorSystemicLines == null ? "" : String(sheet.priorSystemicLines));
  setInput(root, "brain", sheet.brainMets?.status || "unknown");
  setInput(root, "prior-therapies", (sheet.priorTherapies || []).join(", "));
  setInput(root, "egfr-lab", sheet.organFunction.egfrMlMin == null ? "" : String(sheet.organFunction.egfrMlMin));
  setInput(root, "hemoglobin", sheet.organFunction.hemoglobinGdl == null ? "" : String(sheet.organFunction.hemoglobinGdl));
  renderFactsPreview(root, state.factSheet);
  } finally {
    endFactSheetApply();
  }
}

function applyPersona(root: HTMLElement, state: AppState, persona: Persona): void {
  const sheet = persona.factSheet as FactSheet;
  applyFactSheet(root, state, sheet);
  state.rawChart = persona.clinicNote;
  state.personaId = persona.id;
  const chart = root.querySelector("#chart") as HTMLTextAreaElement;
  chart.value = persona.clinicNote;
  const flag = root.querySelector("#chart-inference-flag") as HTMLElement | null;
  if (flag) flag.hidden = true;
  renderNoteQuotes(root, [], 0);
  setChartIdentity(root, persona.displayName, initials(persona.displayName));
  setSyntheticBanner(root, persona.id);
  setChartInferenceSource(root, "synthetic");
}

function formatBiomarker(b: { status?: string; variant?: string | null } | undefined): string {
  if (!b || b.status === "unknown") return "";
  if (b.status === "absent") return "absent";
  if (b.variant) return b.variant;
  if (b.status === "present") return "present";
  return "";
}

function setInput(root: HTMLElement, id: string, value: string): void {
  const el = root.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement | null;
  if (el) el.value = value;
}

function initials(name: string): string {
  const parts = name.replace(/\.pdf$/i, "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}



function setChartIdentity(root: HTMLElement, name: string, letters: string): void {
  const card = root.querySelector("#chart-card") as HTMLElement | null;
  const av = root.querySelector("#chart-avatar") as HTMLElement | null;
  const nm = root.querySelector("#chart-name") as HTMLElement | null;
  if (card) card.dataset.filled = "true";
  if (av) av.textContent = letters;
  if (nm) nm.textContent = name;
}

export function factSheetChipLabels(sheet: FactSheet): string[] {
  const bits: string[] = [];
  if (sheet.ageYears != null) bits.push(`Age ${sheet.ageYears}`);
  if (sheet.stage && sheet.stage !== "unknown") bits.push(`Stage ${sheet.stage}`);
  if (sheet.ecog != null) bits.push(`ECOG ${sheet.ecog}`);
  if (sheet.histology && sheet.histology !== "unknown") bits.push(sheet.histology.replaceAll("_", " "));
  const genes: Array<[string, FactSheet["biomarkers"]["egfr"]]> = [
    ["EGFR", sheet.biomarkers.egfr],
    ["ALK", sheet.biomarkers.alk],
    ["KRAS", sheet.biomarkers.kras],
  ];
  for (const [name, b] of genes) {
    if (b.status === "unknown") continue;
    bits.push(b.variant ? `${name} ${b.variant}` : `${name} ${b.status}`);
  }
  if (sheet.biomarkers.pdL1TpsPercent != null) bits.push(`PD-L1 ${sheet.biomarkers.pdL1TpsPercent}%`);
  if (sheet.brainMets.status && sheet.brainMets.status !== "unknown") {
    bits.push(
      sheet.brainMets.status === "none"
        ? "No brain metastases"
        : sheet.brainMets.status === "treated_stable"
          ? "Treated, stable brain metastases"
          : "Untreated brain metastases",
    );
  }
  if (sheet.priorTherapies.length) bits.push(`Prior therapy: ${sheet.priorTherapies.join(", ")}`);
  else if (sheet.priorSystemicLines != null) bits.push(`${sheet.priorSystemicLines} prior systemic line${sheet.priorSystemicLines === 1 ? "" : "s"}`);
  const of = sheet.organFunction;
  if (of.creatinineMgDl != null) bits.push(`Creatinine ${of.creatinineMgDl} mg/dL`);
  if (of.egfrMlMin != null) bits.push(`eGFR ${of.egfrMlMin} mL/min`);
  if (of.astUL != null) bits.push(`AST ${of.astUL}`);
  if (of.altUL != null) bits.push(`ALT ${of.altUL}`);
  if (of.totalBilirubinMgDl != null) bits.push(`Bilirubin ${of.totalBilirubinMgDl} mg/dL`);
  if (of.ancPerUl != null) bits.push(`ANC ${of.ancPerUl}/uL`);
  if (of.plateletsPerUl != null) bits.push(`Platelets ${of.plateletsPerUl}/uL`);
  if (of.hemoglobinGdl != null) bits.push(`Hemoglobin ${of.hemoglobinGdl} g/dL`);
  if (sheet.home) bits.push(`${sheet.home.city}, ${sheet.home.state}`);
  return bits;
}

function renderFactsPreview(root: HTMLElement, sheet: FactSheet): void {
  const el = root.querySelector("#facts-preview") as HTMLElement | null;
  if (!el) return;
  const bits = factSheetChipLabels(sheet);
  if (!bits.length) {
    el.innerHTML = `<p class="empty-state">No fact sheet yet. Load a synthetic patient or enter a chart first.</p>`;
    return;
  }
  const quotes = (sheet.excerpts || [])
    .filter((ex) => ex.quote && ex.fact)
    .map((ex) => `<li><span class="quote-fact">${escapeHtml(ex.fact)}</span> <q>${escapeHtml(ex.quote)}</q></li>`)
    .join("");
  el.innerHTML = `<ul class="fact-chips">${bits.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>${
    quotes ? `<ul class="quote-gate-list">${quotes}</ul>` : ""
  }`;
}

function renderNoteQuotes(root: HTMLElement, excerpts: { fact: string; quote: string }[], dropped: number): void {
  const el = root.querySelector("#note-quotes") as HTMLElement | null;
  if (!el) return;
  if (!excerpts.length && !dropped) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  const items = excerpts.map((ex) => `<li><span class="quote-fact">${escapeHtml(ex.fact)}</span> <q>${escapeHtml(ex.quote)}</q></li>`).join("");
  const droppedLine = dropped ? `<li class="hint">${dropped} unquoted item${dropped === 1 ? "" : "s"} left out by the quote gate.</li>` : "";
  el.innerHTML = items + droppedLine;
}

async function loadCache(state: AppState, root: HTMLElement, statusEl: HTMLElement): Promise<void> {
  const formHidden = (root.querySelector("#self-entry") as HTMLElement | null)?.hidden ?? true;
  statusEl.textContent =
    describeStatus(defaultDeviceStatus(), !formHidden) + " Loading the public trial records…";
  setDeviceIndicator(root, "loading", "Loading public trials");
  const skeleton = root.querySelector("#sheet-skeleton") as HTMLElement | null;
  if (skeleton) skeleton.hidden = false;
  setHybridStage(root, "cloud");
  let remote: CriteriaCache | undefined;
  let cacheError: ReturnType<typeof classifyCacheError> | undefined;
  try {
    const session = await bootstrapFirebase();
    if (session) {
      remote = await loadCriteriaFromFirestore(session.db);
    }
  } catch (err) {
    cacheError = classifyCacheError(err);
  }
  const local = remote && remote.trials.length ? { trials: [], source: "empty" as const } : await loadCriteriaFromLocalJson();
  const resolved = resolvePublicCache({ remote, error: cacheError, local });
  state.records = resolved.cache;
  setCacheBanner(root, resolved.message, resolved.level);
  state.trialMeta = await loadTrialMeta();
  try {
    view.atlas = await loadRegionAtlas();
  } catch {
    view.atlas = null;
  }
  const attr = root.querySelector("#attribution") as HTMLElement | null;
  if (attr) attr.textContent = attributionWithTimestamp(state.records.dataTimestamp);
  if (skeleton) skeleton.hidden = true;
  statusEl.textContent = resolved.message;
  if (resolved.level === "empty") statusEl.classList.add("error");
  else statusEl.classList.remove("error");
  setDeviceIndicator(root, "ready", formHidden ? "On this device" : "Self-entry on this device");
  setHybridStage(root, "idle");
  if (state.records.trials.length) {
    for (const flow of root.querySelectorAll<HTMLElement>(".hybrid-flow")) flow.dataset.cloud = "ready";
  }
  refreshProof(root, state.outbox);
}

function setCacheBanner(root: HTMLElement, message: string, level: "ok" | "fallback" | "empty"): void {
  const banner = root.querySelector("#cache-banner") as HTMLElement | null;
  if (!banner) return;
  if (level === "ok") {
    banner.hidden = true;
    banner.textContent = "";
    banner.removeAttribute("data-level");
    return;
  }
  banner.hidden = false;
  banner.dataset.level = level;
  banner.textContent = message;
}

function describeCache(cache: CriteriaCache, prefix = ""): string {
  const lead = prefix ? prefix + " " : "";
  if (!cache.trials.length) {
    return `${lead}No public trial records yet. An admin script writes them for this project. A local file of those records also works for development.`;
  }
  const src = cache.source === "firestore" ? "Firestore" : "a local file";
  const when = cache.dataTimestamp ? ` ClinicalTrials.gov dataTimestamp ${cache.dataTimestamp}.` : "";
  return `${lead}Loaded ${cache.trials.length} public trial records from ${src}.${when}`;
}

function renderMatches(root: HTMLElement, state: AppState): void {
  const list = root.querySelector("#question-list") as HTMLElement;
  const hint = root.querySelector("#sheet-hint") as HTMLElement | null;
  const summary = root.querySelector("#briefing-summary") as HTMLElement | null;
  const printBrief = root.querySelector("#print-briefing") as HTMLElement | null;
  if (!state.records.trials.length) {
    if (hint) hint.textContent = "Possible matches will appear here after the public trial records are in place. Print this page and take it to your appointment.";
    if (summary) summary.hidden = true;
    list.innerHTML = `<p class="empty-state">Public trial records are not available yet, so there is nothing to brief yet.</p>`;
    if (printBrief) printBrief.innerHTML = "";
    return;
  }
  const reviewed = state.records.trials.length;
  const all = rankTrials(
    state.factSheet,
    state.records.trials.map((trial) => {
      const meta = state.trialMeta.get(trial.nctId);
      const site = nearestSite(state.factSheet.home, meta?.sites);
      const miles = site?.miles;
      const item: { trial: typeof trial; briefTitle?: string; meta?: TrialMeta; miles?: number } = { trial };
      const title = (trial as { briefTitle?: string }).briefTitle || meta?.briefTitle;
      if (title) item.briefTitle = title;
      if (meta) item.meta = meta;
      if (miles != null) item.miles = miles;
      return item;
    }),
  );
  const strongMatches = all.filter((m) => m.tier === "strong");
  const possibleMatches = all.filter((m) => m.tier === "possible");
  const unlikelyMatches = all.filter((m) => m.tier === "unlikely");
  const ranked = strongMatches;
  const strong = strongMatches.length;
  const possible = possibleMatches.length;
  const unlikely = unlikelyMatches.length;
  view.all = all;
  view.shown = ranked;
  view.selectedNctId = ranked[0]?.nctId ?? null;
  if (hint) {
    hint.textContent =
      strong === 0
        ? "No strong matches in these records. Other trials to ask about are listed below. This is still only a discussion aid. Ranked by strength of evidence."
        : `${strong} strong ${strong === 1 ? "match" : "matches"}. Ranked by strength of evidence.`;
  }
  const questions = [
    "Would any of these NCT IDs be worth discussing for me?",
    "Is there a criterion marked unknown that you already know from my chart?",
    "If a trial looks close, what would we need to confirm before a referral?",
  ];
  renderHeroStats(root, { reviewed, strong });
  if (summary) {
    summary.hidden = false;
    summary.innerHTML = renderSummary(reviewed, { strong, possible, unlikely });
  }
  const otherBlock = possible ? renderOther(possibleMatches, state) : "";
  const unlikelyBlock = unlikely ? renderUnlikely(unlikelyMatches, state) : "";
  const care = `<p class="care-team-note">Discuss these findings with your care team.</p>`;
  if (ranked.length === 0) {
    list.innerHTML = `<p class="empty-state">${escapeHtml(hint?.textContent || "")}</p>${otherBlock}${unlikelyBlock}${care}<ul class="questions">${questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>`;
    if (printBrief) printBrief.innerHTML = list.innerHTML;
    renderCommandMap(root, state, all, ranked);
    return;
  }
  const cards = ranked.map((m, index) => renderCard(m, index, state)).join("");
  list.innerHTML = `${cards}${care}${otherBlock}${unlikelyBlock}<ul class="questions">${questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>`;
  if (printBrief) {
    printBrief.innerHTML = `${ranked.map((m, index) => renderPrintCard(m, index, state)).join("")}${care}${otherBlock}${unlikelyBlock}<ul class="questions">${questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>`;
  }
  renderCommandMap(root, state, all, ranked);
  bindTrialCards(root, state);
  if (view.selectedNctId) highlightSelection(root, view.selectedNctId);
}

function renderHeroStats(
  root: HTMLElement,
  opts: {
    reviewed: number;
    strong: number;
  },
): void {
  const el = root.querySelector("#hero-stats") as HTMLElement | null;
  if (!el) return;
  el.innerHTML = `
    <div class="stat"><span class="stat-num" data-count="${opts.strong}">0</span><span class="stat-label">${opts.strong === 1 ? "Strong match" : "Strong matches"}</span></div>
    <div class="stat"><span class="stat-num" data-count="${opts.reviewed}">0</span><span class="stat-label">Trials reviewed</span></div>`;
  for (const num of el.querySelectorAll<HTMLElement>("[data-count]")) {
    countUp(num, Number(num.dataset.count) || 0, 900);
  }
}

function renderCommandMap(root: HTMLElement, state: AppState, all: TrialMatch[], shown: TrialMatch[]): void {
  const frame = root.querySelector("#map-frame") as HTMLElement | null;
  if (!frame) return;
  if (!view.atlas) {
    frame.innerHTML = `<p class="hint">The offline regional atlas could not be loaded. Trial sites still appear in the list. No external map tiles are used.</p>`;
    return;
  }
  const shownIds = new Set(shown.map((m) => m.nctId));
  const markers: MapMarker[] = [];
  for (const m of all) {
    if (m.tier !== "strong") continue;
    const loc = nearestSiteCoords(state.factSheet.home, state.trialMeta.get(m.nctId)?.sites);
    if (!loc) continue;
    const item: MapMarker = {
      nctId: m.nctId,
      title: m.briefTitle || m.nctId,
      tier: m.tier,
      lat: loc.lat,
      lon: loc.lon,
      visible: shownIds.has(m.nctId),
    };
    if (loc.city) item.city = loc.city;
    if (loc.state) item.state = loc.state;
    if (loc.miles != null) item.miles = loc.miles;
    markers.push(item);
  }
  const home = state.factSheet.home;
  const mapHome = home
    ? { lat: home.lat, lon: home.lon, city: home.city, state: home.state }
    : null;
  const selected = view.selectedNctId == null ? {} : { selectedNctId: view.selectedNctId };
  frame.innerHTML = renderRegionMap({
    atlas: view.atlas,
    home: mapHome,
    markers,
    ...selected,
  });
  bindRegionMap(frame, {
    onHover: (ids) => highlightHover(root, ids[0] ?? null),
    onLeave: () => highlightHover(root, null),
    onSelect: (ids) => {
      const preferred = ids.find((id) => shownIds.has(id)) || ids[0];
      if (!preferred) return;
      openDetail(root, state, preferred);
    },
  });
}

function nearestSiteCoords(
  home: HomeLocation | null | undefined,
  sites: TrialSite[] | undefined,
): { lat: number; lon: number; city?: string; state?: string; miles?: number } | null {
  if (!sites?.length) return null;
  const usable = sites.filter((s) => s.lat != null && s.lon != null);
  if (!usable.length) return null;
  let best = usable[0];
  let bestMiles: number | undefined;
  if (home && Number.isFinite(home.lat) && Number.isFinite(home.lon)) {
    for (const site of usable) {
      if (site.lat == null || site.lon == null) continue;
      const miles = haversineMiles({ lat: home.lat, lon: home.lon }, { lat: site.lat, lon: site.lon });
      if (bestMiles == null || miles < bestMiles) {
        best = site;
        bestMiles = miles;
      }
    }
  }
  const lat = best.lat;
  const lon = best.lon;
  if (lat == null || lon == null) return null;
  const out: { lat: number; lon: number; city?: string; state?: string; miles?: number } = {
    lat,
    lon,
  };
  if (best.city) out.city = best.city;
  if (best.state) out.state = best.state;
  if (bestMiles != null) out.miles = Math.round(bestMiles);
  return out;
}

function bindTrialCards(root: HTMLElement, state: AppState): void {
  const list = root.querySelector("#question-list");
  if (!list) return;
  for (const card of list.querySelectorAll<HTMLElement>(".trial[data-nct]")) {
    card.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest("a, button, details, summary")) return;
      openDetail(root, state, card.dataset.nct || "");
    });
    card.addEventListener("pointerenter", () => highlightHover(root, card.dataset.nct || null));
    card.addEventListener("pointerleave", () => highlightHover(root, null));
    card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        openDetail(root, state, card.dataset.nct || "");
      }
    });
  }
}

function highlightHover(root: HTMLElement, nctId: string | null): void {
  for (const card of root.querySelectorAll(".trial[data-nct]")) {
    card.classList.toggle("is-hot", Boolean(nctId) && card.getAttribute("data-nct") === nctId);
  }
  const frame = root.querySelector("#map-frame") as HTMLElement | null;
  if (!frame) return;
  for (const site of frame.querySelectorAll(".map-site")) {
    const ncts = (site.getAttribute("data-ncts") || "").split(",");
    site.classList.toggle("is-hot", Boolean(nctId && ncts.includes(nctId)));
  }
}

function highlightSelection(root: HTMLElement, nctId: string | null): void {
  view.selectedNctId = nctId;
  for (const card of root.querySelectorAll(".trial[data-nct]")) {
    const on = Boolean(nctId) && card.getAttribute("data-nct") === nctId;
    card.classList.toggle("is-selected", on);
    if (on) card.setAttribute("aria-current", "true");
    else card.removeAttribute("aria-current");
  }
  const frame = root.querySelector("#map-frame") as HTMLElement | null;
  if (frame) syncMapSelection(frame, nctId);
}

async function refreshOpenedTrial(root: HTMLElement, state: AppState, nctId: string): Promise<void> {
  const panel = root.querySelector("#detail-panel") as HTMLElement | null;
  const status = panel?.querySelector("#refresh-parse-status") as HTMLElement | null;
  const btn = panel?.querySelector("#refresh-parse-btn") as HTMLButtonElement | null;
  const rate = refreshRateState();
  if (!rate.allowed) {
    if (status) status.textContent = rate.reason || "Refresh is rate-limited.";
    return;
  }
  if (btn) btn.disabled = true;
  if (status) status.textContent = "Refreshing the public parse through Firebase AI Logic (two runs, then quote and verifier gates)…";
  try {
    const session = await bootstrapFirebase();
    if (!session) throw new Error("Firebase is not configured on this page.");
    const payload = await loadPublicEligibility(nctId);
    if (!payload?.eligibilityCriteria) throw new Error("No public eligibility text is bundled for this trial.");
    const refreshed = await refreshPublicTrialParse(session.app, payload);
    const rec = state.records.trials.find((r) => r.nctId === nctId);
    if (rec) {
      rec.typedChecks = refreshed.typedChecks as typeof rec.typedChecks;
      rec.fuzzyCriteria = refreshed.fuzzyCriteria as typeof rec.fuzzyCriteria;
      rec.parserModel = refreshed.parserModel;
      rec.promptVersion = refreshed.promptVersion;
      rec.parsedAt = refreshed.parsedAt;
    }
    if (status) {
      const g = refreshed.gates;
      status.textContent = `Refreshed with ${refreshed.parserModel}. Quote kept ${g.quoteA.kept} and ${g.quoteB.kept}; ${g.consistency.agreed} agreed across runs; ${g.verifier.verified} verified. Unquoted or disagreed items went to Discuss.`;
    }
  } catch (err) {
    if (status) status.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openDetail(root: HTMLElement, state: AppState, nctId: string): void {
  if (!nctId) return;
  const match = view.all.find((m) => m.nctId === nctId) || view.shown.find((m) => m.nctId === nctId);
  if (!match) return;
  highlightSelection(root, nctId);
  const card = root.querySelector(`.trial[data-nct="${cssEscape(nctId)}"]`) as HTMLElement | null;
  card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const panel = root.querySelector("#detail-panel") as HTMLElement | null;
  const backdrop = root.querySelector("#detail-backdrop") as HTMLElement | null;
  if (!panel) return;
  panel.innerHTML = renderDetail(match, state);
  panel.hidden = false;
  if (backdrop) backdrop.hidden = false;
  document.body.classList.add("detail-open");
  (panel.querySelector("#detail-close") as HTMLElement | null)?.focus();
  panel.querySelector("#detail-close")?.addEventListener("click", () => closeDetail(root));
  panel.querySelector("#refresh-parse-btn")?.addEventListener("click", () => {
    void refreshOpenedTrial(root, state, nctId);
  });
}

function closeDetail(root: HTMLElement): void {
  const panel = root.querySelector("#detail-panel") as HTMLElement | null;
  const backdrop = root.querySelector("#detail-backdrop") as HTMLElement | null;
  if (panel) panel.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove("detail-open");
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

function renderDetail(m: TrialMatch, state: AppState): string {
  const meta = state.trialMeta.get(m.nctId);
  const phase = formatPhase(meta?.phases);
  const site = nearestSite(state.factSheet.home, meta?.sites);
  const title = m.briefTitle || m.nctId;
  const nctHref = `https://clinicaltrials.gov/study/${encodeURIComponent(m.nctId)}`;
  const asks = askYourOncologistItems(m.results, m.discussItems, 3);
  const metItems = m.results.filter((r) => r.group === GROUP_MET);
  const notMetItems = m.results.filter((r) => r.group === GROUP_NOT_MET);
  const discussTyped = m.results.filter((r) => r.group === GROUP_DISCUSS);
  return `<div class="detail-head">
      <p class="eyebrow">Trial briefing</p>
      <button type="button" class="icon-btn" id="detail-close" aria-label="Close">${icon("x")}</button>
    </div>
    <h2 class="detail-driver" id="detail-title">${escapeHtml(plainTrialSubtitle(m, meta) || title)}</h2>
    <p class="detail-official">${escapeHtml(title)}</p>
    <p class="trial-meta">
      ${phase ? `<span>${escapeHtml(phase)}</span>` : ""}
      ${site ? `<span>${escapeHtml(site.label)}</span>` : ""}
    </p>
    <p class="nct-line"><a class="nct-link" href="${nctHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.nctId)}</a> on ClinicalTrials.gov</p>
    <div class="refresh-parse">
      <button type="button" class="secondary" id="refresh-parse-btn">Refresh this trial's parse</button>
      <p class="hint" id="refresh-parse-status">Re-runs the public eligibility text through Firebase AI Logic, with the quote, two-run, and normalizer-verifier gates. Public trial text only. Rate-capped, and behind App Check.</p>
    </div>
    <p class="match"><span class="tier tier-${m.tier}">${escapeHtml(tierLabel(m.tier))}</span></p>
    ${renderCriteriaMatrix(m)}
    ${
      asks.length
        ? `<div class="asks"><p class="asks-label">Ask your oncologist</p><ul>${asks.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul></div>`
        : ""
    }
    <details class="quotes">
      <summary>Full quoted checks</summary>
      ${renderGroup(GROUP_MET, "met", metItems, true, "None on the fact sheet so far.")}
      ${renderGroup(GROUP_NOT_MET, "not-met", notMetItems, false, "None.")}
      ${renderDiscussGroup(discussTyped, m.discussItems)}
    </details>`;
}

function tierLabel(tier: TrialMatch["tier"]): string {
  if (tier === "strong") return "Strong evidence";
  if (tier === "unlikely") return TIER_UNLIKELY;
  return "Possible match";
}

function renderSummary(
  reviewed: number,
  counts: { strong: number; possible: number; unlikely: number },
): string {
  const items = [
    `<li><strong>${counts.strong}</strong> strong ${counts.strong === 1 ? "match" : "matches"}</li>`,
    `<li><strong>${reviewed}</strong> trials reviewed</li>`,
    `<li><strong>${counts.possible}</strong> other trials to ask about, <strong>${counts.unlikely}</strong> ${TIER_UNLIKELY.toLowerCase()}</li>`,
  ];
  return `<ul>${items.join("")}</ul>`;
}

function renderOther(items: TrialMatch[], state: AppState): string {
  if (!items.length) return "";
  const shown = items.slice(0, 8);
  const cards = shown.map((m, index) => renderCard(m, index, state)).join("");
  const more = items.length > 8 ? `<p class="hint">Showing 8 of ${items.length} other trials to ask about.</p>` : "";
  return `<details class="other-block"><summary>Other trials to ask about (${items.length})</summary>${more}${cards}</details>`;
}

function renderUnlikely(items: TrialMatch[], state: AppState): string {
  if (!items.length) return "";
  const cards = items.slice(0, 8).map((m, index) => renderCard(m, index, state)).join("");
  const more = items.length > 8 ? `<p class="hint">Showing 8 of ${items.length} unlikely trials.</p>` : "";
  return `<details class="unlikely-block"><summary>Show ${items.length} ${TIER_UNLIKELY.toLowerCase()} ${items.length === 1 ? "trial" : "trials"}</summary>${more}${cards}</details>`;
}

function renderCard(m: TrialMatch, index: number, state: AppState): string {
  const meta = state.trialMeta.get(m.nctId);
  const phase = formatPhase(meta?.phases);
  const site = nearestSite(state.factSheet.home, meta?.sites);
  const title = m.briefTitle || m.nctId;
  const nctHref = `https://clinicaltrials.gov/study/${encodeURIComponent(m.nctId)}`;
  const asks = askYourOncologistItems(m.results, m.discussItems, 1);
  const selected = view.selectedNctId === m.nctId;
  const subtitle = plainTrialSubtitle(m, meta);
  const tally = keyCriteriaTally(m);
  const ask = asks[0]
    ? `<div class="ask-one is-emphasis"><p class="asks-label">Ask your oncologist</p><p>${escapeHtml(asks[0])}</p><p class="ask-bridge">Print this sheet and take it to your visit.</p></div>`
    : "";
  const lead = subtitle || title;
  const official = subtitle && title !== subtitle ? title : "";
  return `<article class="trial${selected ? " is-selected" : ""}" data-nct="${escapeHtml(m.nctId)}" tabindex="0" role="button" aria-label="${escapeHtml(lead)}">
    <div class="trial-strength">
      ${renderStrengthRing({ met: tally.met }, { of: tally.total })}
      <p class="key-met">${tally.met} of ${tally.total} key criteria met</p>
    </div>
    <div class="trial-body">
      <div class="trial-head">
        <p class="trial-kicker"><span class="rank">${String(index + 1).padStart(2, "0")}</span></p>
        <p class="trial-title">${escapeHtml(lead)}</p>
        ${official ? `<p class="trial-sub">${escapeHtml(official)}</p>` : ""}
        <p class="trial-meta">
          ${phase ? `<span>${escapeHtml(phase)}</span>` : ""}
          ${site ? `<span>${icon("pin")} ${escapeHtml(site.label)}</span>` : ""}
        </p>
        <p class="nct-line"><a class="nct-link" href="${nctHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.nctId)}</a> on ClinicalTrials.gov</p>
      </div>
      <p class="match"><span class="tier tier-${m.tier}">${escapeHtml(tierLabel(m.tier))}</span></p>
      ${ask}
    </div>
  </article>`;
}

function renderPrintCard(m: TrialMatch, index: number, state: AppState): string {
  const meta = state.trialMeta.get(m.nctId);
  const phase = formatPhase(meta?.phases);
  const site = nearestSite(state.factSheet.home, meta?.sites);
  const title = m.briefTitle || m.nctId;
  const nctHref = `https://clinicaltrials.gov/study/${encodeURIComponent(m.nctId)}`;
  const asks = askYourOncologistItems(m.results, m.discussItems, 2);
  const metItems = m.results.filter((r) => r.group === GROUP_MET);
  const notMetItems = m.results.filter((r) => r.group === GROUP_NOT_MET);
  const discussTyped = m.results.filter((r) => r.group === GROUP_DISCUSS);
  return `<article class="trial print-trial">
    <div class="trial-head">
      <p class="trial-title"><span class="rank">${String(index + 1).padStart(2, "0")}</span> ${escapeHtml(title)}</p>
      <p class="trial-meta">
        ${phase ? `<span>${escapeHtml(phase)}</span>` : ""}
        ${site ? `<span>${escapeHtml(site.label)}</span>` : ""}
      </p>
      <p class="nct-line"><a class="nct-link" href="${nctHref}">${escapeHtml(m.nctId)}</a> on ClinicalTrials.gov</p>
    </div>
    <p class="match"><span class="tier tier-${m.tier}">${escapeHtml(tierLabel(m.tier))}</span> ${escapeHtml(m.label)}</p>
    ${asks.length ? `<div class="asks"><p class="asks-label">Ask your oncologist</p><ul>${asks.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul></div>` : ""}
    ${renderGroup(GROUP_MET, "met", metItems, true, "None on the fact sheet so far.")}
    ${renderGroup(GROUP_NOT_MET, "not-met", notMetItems, false, "None.")}
    ${renderDiscussGroup(discussTyped, m.discussItems)}
  </article>`;
}

function renderGroup(
  title: string,
  kind: string,
  items: { quote?: string; headline?: string; quoteLabel?: string; check: { sourceText: string; evidence_quote?: string } }[],
  open: boolean,
  empty: string,
): string {
  const body = items.length
    ? items.map((r) => renderVerdict(r)).join("")
    : `<p class="quote-empty">${escapeHtml(empty)}</p>`;
  return `<details class="group ${kind}" ${open && items.length ? "open" : ""}>
    <summary><p class="group-title">${escapeHtml(title)}</p></summary>
    <div class="group-body">${body}</div>
  </details>`;
}

function renderDiscussGroup(
  discussTyped: { quote?: string; headline?: string; quoteLabel?: string; check: { sourceText: string; evidence_quote?: string } }[],
  discussItems: { sourceText: string; reason?: string | undefined }[],
): string {
  const has = discussTyped.length || discussItems.length;
  const body = has
    ? `${discussTyped.map((r) => renderVerdict(r)).join("")}${discussItems
        .map((d) => {
          const head = escapeHtml(plainDiscussAsk(d.reason, d.sourceText) || "This criterion still needs a conversation with your care team.");
          return `<figure class="verdict"><p class="headline">${head}</p><figcaption>Trial's own words</figcaption><blockquote class="quote">${escapeHtml(markSic(d.sourceText))}</blockquote></figure>`;
        })
        .join("")}`
    : `<p class="quote-empty">None.</p>`;
  return `<details class="group discuss">
    <summary><p class="group-title">${escapeHtml(GROUP_DISCUSS)}</p></summary>
    <div class="group-body">${body}</div>
  </details>`;
}

function renderVerdict(r: {
  quote?: string;
  headline?: string;
  quoteLabel?: string;
  check: { sourceText: string; evidence_quote?: string };
}): string {
  const headline = r.headline || "";
  const label = r.quoteLabel || "Trial's own words";
  const source = r.check.sourceText || r.quote || "";
  const ev = r.check.evidence_quote || r.quote || "";
  return `<figure class="verdict">
    <p class="headline">${escapeHtml(headline)}</p>
    <figcaption>${escapeHtml(label)}</figcaption>
    <blockquote class="quote">${renderQuoteHtml(source, ev, escapeHtml)}</blockquote>
  </figure>`;
}

function describeStatus(status: ReturnType<typeof defaultDeviceStatus>, useForm: boolean): string {
  if (useForm) {
    return `On-device model status: ${status}. Using the self-entry form so your chart is not sent to a cloud model.`;
  }
  return `On-device model status: ${status}.`;
}

function chartTextBytesSent(entries: OutboxEntry[]): number {
  return entries.filter((e) => !e.blocked && (e.leaks?.length ?? 0) > 0).reduce((sum, e) => sum + (e.bodyByteLength || 0), 0);
}

function setIntakeCollapsed(root: HTMLElement, collapsed: boolean): void {
  const intake = root.querySelector("#intake") as HTMLElement | null;
  const stage = root.querySelector("#intake-stage") as HTMLElement | null;
  const results = root.querySelector("#results-stage") as HTMLElement | null;
  const done = root.querySelector("#intake-done") as HTMLElement | null;
  const main = root.querySelector("#main") as HTMLElement | null;
  if (intake) intake.hidden = collapsed;
  if (stage) stage.hidden = collapsed;
  if (results) results.hidden = !collapsed;
  if (done) done.hidden = !collapsed;
  const sheetDisclaimer = root.querySelector("#sheet-disclaimer") as HTMLElement | null;
  if (sheetDisclaimer) sheetDisclaimer.hidden = !collapsed;
  main?.classList.toggle("briefing-mode", collapsed);
}

function refreshProof(root: HTMLElement, outbox: Outbox): void {
  const bytes = chartTextBytesSent(outbox.entries);
  const full = `${bytes} ${bytes === 1 ? "byte" : "bytes"} of chart text sent`;
  const short = `Proof · ${bytes} chart ${bytes === 1 ? "byte" : "bytes"} sent`;
  const proof = root.querySelector("#proof-label") as HTMLElement | null;
  const proofShort = root.querySelector("#proof-label-short") as HTMLElement | null;
  const banner = root.querySelector("#outbox-bytes") as HTMLElement | null;
  if (proof) proof.textContent = short;
  if (proofShort) proofShort.textContent = "Proof";
  if (banner) banner.textContent = full;
  if (proof) proof.parentElement?.setAttribute("title", full);
  renderOutbox(root, outbox);
}

function renderOutbox(root: HTMLElement, outbox: Outbox): void {
  const list = root.querySelector("#outbox-list") as HTMLElement;
  if (!list) return;
  if (!outbox.entries.length) {
    list.innerHTML = "<li>Nothing has left this computer yet.</li>";
    return;
  }
  list.innerHTML = outbox.entries
    .map((e) => {
      const params = Object.entries(e.queryParams)
        .map(([k, v]) => (SENSITIVE_QUERY.has(k.toLowerCase()) ? `${k}=[redacted]` : `${k}=${v}`))
        .join(", ");
      const cls = e.blocked ? "blocked" : "";
      const label = networkLabel(e);
      return `<li class="${cls}">${escapeHtml(e.at)} · ${escapeHtml(e.method)} · ${escapeHtml(e.destination)} · ${escapeHtml(label)} · ${escapeHtml(e.url.split("?")[0] ?? e.url)}${params ? " · " + escapeHtml(params) : ""}${e.blocked ? " · blocked" : ""}</li>`;
    })
    .join("");
}

function setDrawer(root: HTMLElement, open: boolean): void {
  const drawer = root.querySelector("#outbox-drawer") as HTMLElement | null;
  const backdrop = root.querySelector("#drawer-backdrop") as HTMLElement | null;
  const toggle = root.querySelector("#proof-toggle") as HTMLButtonElement | null;
  if (drawer) drawer.hidden = !open;
  if (backdrop) backdrop.hidden = !open;
  if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) (root.querySelector("#proof-close") as HTMLElement | null)?.focus();
}

function setDeviceIndicator(root: HTMLElement, state: string, label: string): void {
  const el = root.querySelector("#on-device") as HTMLElement | null;
  const lab = root.querySelector("#on-device-label") as HTMLElement | null;
  if (el) el.setAttribute("data-state", state);
  if (lab) lab.textContent = label;
}

function readTheme(): "light" | "dark" {
  try {
    const stored = localStorage.getItem("inclusion-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Ignore storage errors.
  }
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
  syncThemeToggle();
}

function syncThemeToggle(): void {
  const btn = document.querySelector("#theme-toggle") as HTMLButtonElement | null;
  if (!btn) return;
  const light = document.documentElement.getAttribute("data-theme") === "light";
  const label = btn.querySelector(".theme-label");
  if (label) label.textContent = light ? "Dark" : "Light";
  else btn.lastChild && (btn.childNodes[btn.childNodes.length - 1].textContent = light ? "Dark" : "Light");
  const ico = btn.querySelector("svg");
  if (ico) ico.outerHTML = icon(light ? "moon" : "sun");
  btn.setAttribute("aria-pressed", light ? "true" : "false");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
