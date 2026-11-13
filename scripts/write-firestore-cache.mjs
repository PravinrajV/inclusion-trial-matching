#!/usr/bin/env node
/**
 * Server-side write of the public criteria cache to Firestore.
 * Uses the Firebase CLI login for pravinraj.vincent@gmail.com (not gcloud ADC,
 * which may be a different account). Clients cannot write these paths.
 *
 * Usage: node scripts/write-firestore-cache.mjs
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const INDEX_PATH = resolve(root, "data/criteria-cache/index.json");
const PROJECT = "inclusion-hybridai";
const ACCOUNT = "pravinraj.vincent@gmail.com";

function log(line) {
  process.stderr.write(line + "\n");
}

async function getAccessToken() {
  // Use the Firebase CLI login for ACCOUNT only. Do not use gcloud ADC (it may be a different account).
  // Never log the token or refresh token.
  const require = createRequire(import.meta.url);
  const auth = require("firebase-tools/lib/auth.js");
  const account = auth.findAccountByEmail(ACCOUNT);
  if (!account || account.user?.email !== ACCOUNT) {
    throw new Error(`Firebase CLI is not logged in as ${ACCOUNT}. Refusing to write.`);
  }
  const scopes = require("firebase-tools/lib/scopes.js");
  const authScopes = [
    scopes.EMAIL,
    scopes.OPENID,
    scopes.CLOUD_PROJECTS_READONLY,
    scopes.FIREBASE_PLATFORM,
    scopes.CLOUD_PLATFORM,
  ];
  // Reuse a still-valid access token on the account if present; otherwise refresh.
  const existing = account.tokens;
  if (existing?.access_token && existing.expires_at && existing.expires_at > Date.now() + 60_000) {
    return existing.access_token;
  }
  const tok = await auth.getAccessToken(existing.refresh_token, authScopes);
  const access = typeof tok === "string" ? tok : tok?.access_token;
  if (!access) throw new Error("firebase-tools returned an empty access token.");
  return access;
}

async function writeDoc(token, path, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}?documentId=`;
  // path like criteria/1/trials / nct — use patch with name
  const name = `projects/${PROJECT}/databases/(default)/documents/${path}`;
  const res = await fetch(`https://firestore.googleapis.com/v1/${name}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (/BILLING|Blaze|quota|billing account/i.test(text)) {
      const err = new Error(`BLOCKED write ${path}: ${text.slice(0, 500)}`);
      err.blocked = true;
      throw err;
    }
    throw new Error(`Write failed ${path} ${res.status}: ${text.slice(0, 500)}`);
  }
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === "object") return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

async function main() {
  if (!existsSync(INDEX_PATH)) {
    throw new Error("No data/criteria-cache/index.json. Run scripts/parse-regional-trials.mjs first.");
  }
  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  const ok = (index.trials || []).filter((t) => t.ok);
  log(`Writing ${ok.length} trials to Firestore project ${PROJECT} as ${ACCOUNT}, server-side only.`);
  const token = await getAccessToken();
  if (!token) throw new Error("Empty access token from firebase-tools. Is that account logged in?");

  // write meta first
  await writeDoc(token, "criteria/1/meta/source", {
    dataTimestamp: index.dataTimestamp,
    apiVersion: index.apiVersion || "2.0.5",
    promptVersion: index.promptVersion,
    parserModel: index.model,
    regionalTotal: index.regionalTotal,
    cachedOk: ok.length,
    writtenAt: new Date().toISOString(),
    attribution: "ClinicalTrials.gov, National Library of Medicine, National Institutes of Health",
  });
  log("Wrote criteria/1/meta/source");

  let written = 0;
  for (const rec of ok) {
    const payload = {
      schemaVersion: "1",
      nctId: rec.nctId,
      briefTitle: rec.briefTitle || "",
      parsedAt: rec.parsedAt,
      parserModel: rec.parserModel,
      promptVersion: rec.promptVersion,
      dataTimestamp: rec.dataTimestamp || index.dataTimestamp,
      typedChecks: rec.typedChecks,
      fuzzyCriteria: rec.fuzzyCriteria,
    };
    try {
      await writeDoc(token, `criteria/1/trials/${rec.nctId}`, payload);
      written += 1;
      if (written % 25 === 0) log(`Wrote ${written}/${ok.length}`);
    } catch (err) {
      if (err.blocked) {
        log(`STOPPED: ${err.message}`);
        writeFileSync(resolve(root, "admin/cache-write.log"), `stopped after ${written}: ${err.message}\n`);
        process.exit(3);
      }
      throw err;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  log(`Done. Wrote ${written} trial documents and meta/source.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
