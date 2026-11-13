import { describe, expect, it } from "vitest";
import type { TrialMatch } from "../src/match/evaluate";
import type { TrialMeta } from "../src/cache/trial-meta";
import { plainTrialSubtitle } from "../src/ui/subtitle";

function base(over: Partial<TrialMatch> = {}): TrialMatch {
  return {
    nctId: "NCT04486833",
    briefTitle: "Quaratusugene Ozeplasmid (Reqorsa) and Osimertinib in Patients With Advanced Lung Cancer Who Progressed on Osimertinib",
    results: [],
    discussItems: [],
    met: 1,
    notMet: 0,
    unknown: 0,
    discuss: 0,
    possibleMatch: true,
    label: "Strong. Discuss with your care team.",
    tier: "strong",
    driverMatch: "confirmed",
    population: "nsclc",
    nsclcSpecific: true,
    recruiting: true,
    firstLineDemoted: false,
    laterLineBonus: true,
    ...over,
  };
}

describe("plainTrialSubtitle", () => {
  it("turns structured EGFR later-line fields into a short plain line", () => {
    const meta: TrialMeta = {
      nctId: "NCT04486833",
      briefTitle: "Quaratusugene Ozeplasmid (Reqorsa) and Osimertinib in Patients With Advanced Lung Cancer Who Progressed on Osimertinib",
      officialTitle: "A Phase 1/2 Trial of Reqorsa in EGFR-Mutant NSCLC After Progression on Osimertinib",
      phases: ["PHASE1", "PHASE2"],
      sites: [],
      conditions: ["EGFR-mutant Non-Small Cell Lung Cancer"],
      keywords: [],
    };
    const line = plainTrialSubtitle(base(), meta);
    expect(line.toLowerCase()).toContain("egfr");
    expect(line.toLowerCase()).toContain("nsclc");
    expect(line.toLowerCase()).toMatch(/after osimertinib|after progression/);
    expect(line.length).toBeLessThanOrEqual(88);
  });
});
