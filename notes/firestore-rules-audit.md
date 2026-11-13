# Firestore security rules audit

Rules file: `firestore.rules`, deployed to project `inclusion-hybridai`, database `(default)`, on November 11, 2026 at 8:46–8:49 PM ET (America/New_York).

Scope of the rules: the eligibility cache at `criteria/{schemaVersion}/trials/{nctId}` holds public ClinicalTrials.gov eligibility checks only. No patient chart, fact sheet, city, or coordinates are stored.

## Assessment

```json
{
  "score": 5,
  "summary": "Client writes are denied on every path. Authenticated clients, including anonymous users, may read only the eligibility cache, and only when schemaVersion is short and nctId matches NCT plus eight digits. All other documents are closed. There is no user-supplied role, no create/update split, and no way for a client to change cache contents. The Admin SDK and Cloud Functions bypass these rules, which is the intended server-side write path.",
  "findings": [
    {
      "check": "The Update Bypass",
      "severity": "minor",
      "issue": "None for clients. create, update, and delete are explicitly denied on the cache path, and the catch-all also denies write. A client cannot create a valid document and later change it.",
      "recommendation": "Keep writes server-side only. When a Cloud Function or admin script is added, enforce once-per-schemaVersion in that writer, not in these client rules."
    },
    {
      "check": "Authority Source",
      "severity": "minor",
      "issue": "None. Access does not depend on request.resource.data, roles, or ownerId fields.",
      "recommendation": "Do not add client-writable role fields later."
    },
    {
      "check": "Business Logic vs. Rules",
      "severity": "minor",
      "issue": "Matches the app: signed-in clients can read the public trial cache after anonymous auth. They cannot write it. Unauthenticated reads are denied, which is intended.",
      "recommendation": "Keep anonymous auth enabled so the web app can read the cache without collecting an email."
    },
    {
      "check": "Storage Abuse",
      "severity": "minor",
      "issue": "Clients cannot write, so they cannot grow documents or arrays. Authenticated users can list cache documents, which is acceptable because the cache is public trial text, not PHI.",
      "recommendation": "If the cache grows large, prefer keyed gets by nctId over unbounded client lists. No rule change is required for launch."
    },
    {
      "check": "Type Safety",
      "severity": "minor",
      "issue": "No field type checks on write, because writes are denied. Path constraints already limit schemaVersion length and nctId format on read.",
      "recommendation": "Validate document shape in the server-side writer when it exists."
    },
    {
      "check": "Field-Level vs. Identity-Level Security",
      "severity": "minor",
      "issue": "No hasOnly/diff update rules exist, and no client updates are allowed, so there is no field-level identity gap.",
      "recommendation": "Leave as is."
    }
  ]
}
```

Score 5 is for this client-rule set on a public, non-PHI cache. App Check is not expressed in Firestore rules; enforcement for AI Logic is configured at the product level, and is still waiting on the Firebase AI Logic Get started workflow (see notes/accuracy-spike.md).
