import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { judgeTypedCheck } from "../src/match/typed";
import type { FactSheet } from "../src/schema/fact-sheet";
import type { TypedCheck, TypedKind } from "../src/schema/criterion";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const personas = JSON.parse(readFileSync(join(root, "gold/personas.json"), "utf8")) as {
  personas: { id: string; factSheet: FactSheet }[];
};
interface GoldCriterion {
  id: string;
  kind: TypedKind | "fuzzy";
  polarity: TypedCheck["polarity"];
  sourceText: string;
  numberValue?: number;
  stringValue?: string;
  stages?: TypedCheck["stages"];
  histologies?: TypedCheck["histologies"];
  presence?: TypedCheck["presence"];
  allowedBrainMets?: TypedCheck["allowedBrainMets"];
  expected: Record<string, "met" | "not_met" | "unknown">;
}

const gold = JSON.parse(readFileSync(join(root, "gold/criteria.json"), "utf8")) as {
  criteria: GoldCriterion[];
};

describe("gold set typed criteria", () => {
  it("has at least 20 criteria and 3 personas", () => {
    expect(personas.personas).toHaveLength(3);
    expect(gold.criteria.length).toBeGreaterThanOrEqual(20);
    expect(gold.criteria.length).toBeLessThanOrEqual(30);
  });

  it("matches the expected judgments for every typed criterion", () => {
    const byId = new Map(personas.personas.map((p) => [p.id, p.factSheet]));
    const typed = gold.criteria.filter((c): c is GoldCriterion & { kind: TypedKind } => c.kind !== "fuzzy");
    expect(typed.length).toBeGreaterThanOrEqual(20);
    for (const criterion of typed) {
      for (const [personaId, expected] of Object.entries(criterion.expected)) {
        const sheet = byId.get(personaId);
        expect(sheet, personaId).toBeTruthy();
        const got = judgeTypedCheck(sheet as FactSheet, criterion as TypedCheck);
        expect(got, `${criterion.id} × ${personaId}`).toBe(expected);
      }
    }
  });
});
