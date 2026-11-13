import { getAuth, signInAnonymously, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import type { FirebaseApp } from "firebase/app";
import { createFirebaseApp, initAppCheck, readFirebaseConfig } from "../hybrid/client";

export interface FirebaseSession {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

export async function bootstrapFirebase(): Promise<FirebaseSession | null> {
  const config = readFirebaseConfig();
  if (!config) return null;
  const app = createFirebaseApp(config);
  if (import.meta.env.VITE_APPCHECK_DEBUG === "true" || import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) {
    initAppCheck(app);
  }
  const auth = getAuth(app);
  // Silent anonymous sign-in, required before any Firestore read. No UI prompt.
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  const db = getFirestore(app);
  return { app, auth, db };
}
