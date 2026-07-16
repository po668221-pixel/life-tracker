import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminApp } from "./_firebaseAdmin.js";

const WATER_TARGET_L = 2;

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Wall-clock date/time parts in a given IANA timezone, read directly from
// Intl rather than constructing timezone-aware Date math -- sidesteps DST
// edge cases entirely since we only ever compare local hour/minute/day
// values, never convert between zones.
function partsInTz(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function todayKeyFor(p) {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

// Triggered every ~30 min by the GitHub Actions workflow (Vercel's free
// Hobby cron only allows once-daily schedules, too coarse for this).
// Guarded by REMINDER_CRON_SECRET -- separate from the monthly summary's
// CRON_SECRET since this endpoint is called far more often, from a
// different trigger source.
export default async function handler(req, res) {
  if (process.env.REMINDER_CRON_SECRET) {
    const authHeader = req.headers["authorization"];
    if (authHeader !== `Bearer ${process.env.REMINDER_CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const app = getAdminApp();
  const db = getFirestore(app);
  const messaging = getMessaging(app);

  const snapshot = await db.collection("users").where("notifEnabled", "==", true).get();
  const now = new Date();
  const results = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const token = data.fcmToken;
    if (!token) continue;

    try {
      const tz = data.notifTimezone || "UTC";
      const notifTime = data.notifTime || "20:00";
      const intervalHours = data.notifIntervalHours || 3;
      const [anchorH, anchorM] = notifTime.split(":").map(Number);

      const p = partsInTz(now, tz);
      const today = todayKeyFor(p);
      const minutesNow = p.hour * 60 + p.minute;
      const anchorMinutes = anchorH * 60 + anchorM;
      if (minutesNow < anchorMinutes) continue;

      const slot = Math.floor((minutesNow - anchorMinutes) / (intervalHours * 60));
      const slotKey = `${today}#${slot}`;
      if (data.notifLastFiredSlot === slotKey) continue;

      const habits = data.habits || [];
      const pendingCount = habits.filter(h => !h.history?.[today]?.status).length;
      const waterAmount = habits.find(h => h.name === "Water Intake")?.history?.[today]?.amount || 0;
      const resolved = pendingCount === 0 && waterAmount >= WATER_TARGET_L;
      if (resolved) continue;

      const bodyParts = [];
      if (pendingCount > 0) bodyParts.push(`${pendingCount} habit${pendingCount === 1 ? "" : "s"} left today`);
      if (waterAmount < WATER_TARGET_L) bodyParts.push(`Water: ${waterAmount}L of ${WATER_TARGET_L}L`);

      await messaging.send({
        token,
        notification: { title: "Life Tracker", body: bodyParts.join(". ") },
      });

      await docSnap.ref.set({ notifLastFiredSlot: slotKey }, { merge: true });
      results.push({ uid: docSnap.id, sent: true });
    } catch (err) {
      const code = err?.errorInfo?.code || err?.code;
      const staleTokenCodes = [
        "messaging/registration-token-not-registered",
        "messaging/invalid-registration-token",
        "messaging/invalid-argument", // token is the only per-user variable in this call, so this also means a bad token
      ];
      if (staleTokenCodes.includes(code)) {
        await docSnap.ref.set({ fcmToken: null }, { merge: true }).catch(() => {});
      }
      results.push({ uid: docSnap.id, sent: false, error: String(err) });
    }
  }

  return res.status(200).json({ count: results.length, results });
}
