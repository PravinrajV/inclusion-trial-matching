import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyFactSheet, type FactSheet } from "../src/schema/fact-sheet";
import { classifyTrial, structuredResults, type StructuredFields } from "../src/match/population";

interface GoldItem {
  nctId: string;
  kind: string;
  polarity: string;
  presence?: string;
  stringValue?: string;
  expected?: Record<string, "met" | "not_met" | "unknown">;
}

function loadJson(rel: string) {
  return JSON.parse(readFileSync(resolve(__dirname, "..", rel), "utf8"));
}

function fieldsFor(nctId: string, byId: Map<string, Record<string, unknown>>): StructuredFields {
  const t = byId.get(nctId) || {};
  return {
    briefTitle: (t.briefTitle as string) || "",
    officialTitle: (t.officialTitle as string) || "",
    overallStatus: (t.overallStatus as string) || "RECRUITING",
    conditions: (t.conditions as string[]) || [],
    keywords: (t.keywords as string[]) || [],
    interventions: (t.interventions as string[]) || [],
  };
}

function sheetWithDriver(kind: string, presence: string | undefined, variant: string | undefined): FactSheet {
  const sheet = emptyFactSheet("self_entry");
  const absent = { status: "absent" as const, variant: null };
  const set = (gene: "egfr" | "alk" | "kras" | "ros1" | "braf", on: boolean, v?: string) => {
    sheet.biomarkers[gene] = on ? { status: "present", variant: v || null } : absent;
  };
  if (kind.startsWith("egfr_variant") || kind === "egfr_status") {
    if (kind === "egfr_status" && presence === "absent") set("egfr", false);
    else set("egfr", true, variant || "exon 19 deletion");
  } else if (kind.startsWith("alk")) {
    set("alk", presence !== "absent", variant);
  } else if (kind.startsWith("kras")) {
    set("kras", presence !== "absent", variant || "G12C");
  } else if (kind.startsWith("ros1")) {
    set("ros1", presence !== "absent");
  } else if (kind.startsWith("braf")) {
    set("braf", presence !== "absent");
  }
  return sheet;
}

function isDriverKind(kind: string): boolean {
  return /^(egfr_status|alk_status|kras_status|ros1_status|braf_status|egfr_variant_in|kras_variant_in)$/.test(kind);
}

describe("structured classifier vs frozen gold labels", () => {
  const region = loadJson("data/ctgov/region-trials.json") as { trials: Array<Record<string, unknown>> };
  const byId = new Map(region.trials.map((t) => [String(t.nctId), t]));
  const personas = (loadJson("gold/personas.json") as { personas: Array<{ id: string; factSheet: FactSheet }> }).personas;
  const sets: Array<{ name: string; items: GoldItem[] }> = [
    { name: "in-set", items: loadJson("gold/criteria.json").criteria },
    { name: "held-out-1", items: loadJson("gold/held-out-criteria-2026-11-11T211725-0500.json").criteria },
    { name: "held-out-2", items: loadJson("gold/held-out-2-criteria-2026-11-11T213510-0500.json").criteria },
    { name: "held-out-3", items: loadJson("gold/held-out-3-criteria-2026-11-11T214338-0500.json").criteria },
  ];

  it("never Not-mets a trial a fitting chart should still be considered for (unsafe count is 0)", () => {
    const unsafe: string[] = [];

    for (const set of sets) {
      for (const item of set.items) {
        if (!isDriverKind(item.kind)) continue;
        const fields = fieldsFor(item.nctId, byId);
        const pop = classifyTrial(fields);

        if (item.polarity === "inclusion" && (item.presence === "present" || item.kind.endsWith("_variant_in"))) {
          const sheet = sheetWithDriver(item.kind, "present", item.stringValue);
          const { results, driverMatch } = structuredResults(sheet, pop);
          const geneNotMet = results.some((r) => r.judgment === "not_met" && r.check.kind.startsWith(item.kind.split("_")[0] || ""));
          if (driverMatch === "conflict" && geneNotMet) {
            unsafe.push(`${set.name} ${item.nctId} ${item.kind}=${item.stringValue || item.presence}: satisfied chart was marked not_met`);
          }
        }

        if (item.polarity === "inclusion" && item.presence === "absent") {
          const sheet = sheetWithDriver(item.kind, "absent", undefined);
          const { results } = structuredResults(sheet, pop);
          const requiredPresent = results.some((r) => r.judgment === "not_met" && r.headline.startsWith("Requires ") && !r.headline.startsWith("Requires no "));
          if (requiredPresent) {
            unsafe.push(`${set.name} ${item.nctId} ${item.kind} absence inclusion: wild-type chart was not-met as if the trial required the driver`);
          }
        }

        if (item.polarity === "exclusion" && (item.presence === "present" || item.kind.endsWith("_variant_in"))) {
          const sheet = sheetWithDriver(item.kind, "absent", undefined);
          const { results } = structuredResults(sheet, pop);
          const requiredPresent = results.some((r) => r.judgment === "not_met" && r.headline.startsWith("Requires ") && !r.headline.startsWith("Requires no "));
          if (requiredPresent) {
            unsafe.push(`${set.name} ${item.nctId} ${item.kind} exclusion: driver-negative chart was not-met as if the trial required the driver`);
          }
        }
      }
    }

    const inSet = sets[0]?.items || [];
    const byTrial = new Map<string, GoldItem[]>();
    for (const item of inSet) {
      const list = byTrial.get(item.nctId) || [];
      list.push(item);
      byTrial.set(item.nctId, list);
    }
    for (const [nctId, items] of byTrial) {
      for (const persona of personas) {
        const judgments = items
          .map((i) => i.expected?.[persona.id])
          .filter((j): j is "met" | "not_met" | "unknown" => Boolean(j));
        if (!judgments.length) continue;
        if (judgments.some((j) => j === "not_met")) continue;
        const pop = classifyTrial(fieldsFor(nctId, byId));
        const { driverMatch, results } = structuredResults(persona.factSheet, pop);
        if (driverMatch === "conflict" || results.some((r) => r.judgment === "not_met")) {
          unsafe.push(`in-set persona ${persona.id} on ${nctId}: gold has no not_met items but classifier marked a driver not_met`);
        }
      }
    }

    expect(unsafe, unsafe.join("\n")).toEqual([]);
  });
});
