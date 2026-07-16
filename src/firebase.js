import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyBYNwvopHM31NajcUSaUpCBDh9Ga44R-qk",
  authDomain: "life-tracker-e0597.firebaseapp.com",
  projectId: "life-tracker-e0597",
  storageBucket: "life-tracker-e0597.firebasestorage.app",
  messagingSenderId: "13998634255",
  appId: "1:13998634255:web:b7b0b289bf55d07effba7a",
  measurementId: "G-Z7PZFL3LDW",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Web Push VAPID key from Firebase Console -> Project settings -> Cloud
// Messaging -> Web Push certificates. Public/client-safe by design, same
// trust level as firebaseConfig above -- not a secret.
export const VAPID_KEY = "BNjrrRZPqC8mzG_bXDdPwnjSY3KmqgbF3uO1tISeM8SRP8frmVFvNmwiNCx6CUECDPCj_0haJMHeJYQtv27_-Wk";

// getMessaging() throws in browsers/webviews without push support, so this
// resolves to null there instead of crashing app startup; callers must
// check for null before using it.
export const messagingPromise = isSupported().then(supported => (supported ? getMessaging(app) : null));
