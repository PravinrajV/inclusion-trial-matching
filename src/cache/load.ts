import { collection, doc, getDoc, getDocs, type Firestore } from "firebase/firestore";
import { CRITERIA_CACHE_SCHEMA_VERSION, type ParsedTrial } from "../schema/criterion";

export interface CachedTrial extends ParsedTrial {
  briefTitle?: string | undefined;
  dataTimestamp?: string | undefined;
}

export interface CriteriaCache {
  trials: CachedTrial[];
  dataTimestamp?: string | undefined;
  source: "firestore" | "local" | "empty";
}

function asTrial(data: Record<string, unknown>, nctId: string): CachedTrial | null {
  if (!Array.isArray(data.typedChecks)) return null;
  const trial: CachedTrial = {
    schemaVersion: CRITERIA_CACHE_SCHEMA_VERSION,
    nctId: String(data.nctId || nctId),
    parsedAt: String(data.parsedAt || ""),
    parserModel: String(data.parserModel || ""),
    promptVersion: String(data.promptVersion || ""),
    typedChecks: data.typedChecks as CachedTrial["typedChecks"],
    fuzzyCriteria: Array.isArray(data.fuzzyCriteria) ? (data.fuzzyCriteria as CachedTrial["fuzzyCriteria"]) : [],
  };
  if (typeof data.briefTitle === "string" && data.briefTitle) trial.briefTitle = data.briefTitle;
  if (typeof data.dataTimestamp === "string" && data.dataTimestamp) trial.dataTimestamp = data.dataTimestamp;
  return trial;
}

export async function loadCriteriaFromFirestore(db: Firestore): Promise<CriteriaCache> {
  const version = CRITERIA_CACHE_SCHEMA_VERSION;
  const snap = await getDocs(collection(db, "criteria", version, "trials"));
  const trials: CachedTrial[] = [];
  let dataTimestamp: string | undefined;
  for (const docSnap of snap.docs) {
    const trial = asTrial(docSnap.data(), docSnap.id);
    if (trial) {
      trials.push(trial);
      if (!dataTimestamp && trial.dataTimestamp) dataTimestamp = trial.dataTimestamp;
    }
  }
  try {
    const meta = await getDoc(doc(db, "criteria", version, "meta", "source"));
    const ts = meta.data()?.dataTimestamp;
    if (typeof ts === "string" && ts) dataTimestamp = ts;
  } catch {
    // Meta is optional. Trial documents still carry the timestamp.
  }
  return { trials, dataTimestamp, source: "firestore" };
}

export async function loadCriteriaFromLocalJson(url = "/trial-records.json"): Promise<CriteriaCache> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { trials: [], source: "empty" };
    const data = (await res.json()) as { dataTimestamp?: string; trials?: Record<string, unknown>[] };
    const trials = (data.trials || []).map((row, i) => asTrial(row, String(row.nctId || i))).filter((t): t is CachedTrial => Boolean(t));
    const dataTimestamp = typeof data.dataTimestamp === "string" ? data.dataTimestamp : undefined;
    return { trials, dataTimestamp, source: trials.length ? "local" : "empty" };
  } catch {
    return { trials: [], source: "empty" };
  }
}
