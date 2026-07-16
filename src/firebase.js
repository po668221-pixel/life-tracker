import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
