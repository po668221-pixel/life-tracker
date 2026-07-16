importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js");

// Service workers can't import the app's ESM bundle, so this config is
// duplicated from src/firebase.js -- same public, non-secret values.
firebase.initializeApp({
  apiKey: "AIzaSyBYNwvopHM31NajcUSaUpCBDh9Ga44R-qk",
  authDomain: "life-tracker-e0597.firebaseapp.com",
  projectId: "life-tracker-e0597",
  storageBucket: "life-tracker-e0597.firebasestorage.app",
  messagingSenderId: "13998634255",
  appId: "1:13998634255:web:b7b0b289bf55d07effba7a",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || "Life Tracker", { body: body || "" });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
