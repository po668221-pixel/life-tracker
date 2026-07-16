import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "./_firebaseAdmin.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateKeyFor(year, monthIndex, day) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function daysInMonthOf(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getMonthCompletionPct(habit, year, monthIndex) {
  const totalDays = daysInMonthOf(year, monthIndex);
  let doneDays = 0;
  for (let day = 1; day <= totalDays; day++) {
    const key = dateKeyFor(year, monthIndex, day);
    if (habit?.history?.[key]?.status === "done") doneDays++;
  }
  return Math.round((doneDays / totalDays) * 100);
}

function isInMonth(dateStr, year, monthIndex) {
  const d = new Date(dateStr);
  return d.getFullYear() === year && d.getMonth() === monthIndex;
}

function sumInMonth(entries, year, monthIndex) {
  return (entries || [])
    .filter(e => isInMonth(e.date, year, monthIndex))
    .reduce((s, e) => s + e.amount, 0);
}

function buildSummaryHtml({ name, monthLabel, habitRows, totalSav, totalExp, currency }) {
  const sym = { NGN: "₦", SAR: "﷼", CNY: "¥" }[currency] || currency || "";
  const rows = habitRows
    .map(h => `<tr><td style="padding:4px 12px 4px 0;">${h.name}</td><td style="padding:4px 0;">${h.pct}%</td></tr>`)
    .join("");
  const diff = totalSav - totalExp;
  return `
    <div style="font-family:sans-serif;color:#111827;">
      <h2>Your ${monthLabel} Life Tracker summary</h2>
      <p>Hi ${name || "there"}, here's how ${monthLabel} went:</p>
      <h3>Habits</h3>
      <table>${rows || "<tr><td>No habits logged this month.</td></tr>"}</table>
      <h3>Finances</h3>
      <p>Saved: ${sym}${totalSav.toLocaleString("en-US")}<br/>
      Spent: ${sym}${totalExp.toLocaleString("en-US")}<br/>
      Net: ${diff >= 0 ? "+" : ""}${sym}${diff.toLocaleString("en-US")}</p>
      <p style="color:#6b7280;font-size:12px;">Sent automatically by Life Tracker.</p>
    </div>
  `;
}

async function sendEmail(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Life Tracker <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

// Triggered monthly by Vercel Cron (see vercel.json). Reads every Google-
// synced user's Firestore doc, computes last month's habit/finance summary,
// and emails it via Resend. Guarded by CRON_SECRET so this can't be spammed
// by an outside request hitting the URL directly.
export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const app = getAdminApp();
  const db = getFirestore(app);
  const adminAuth = getAuth(app);

  const now = new Date();
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = lastMonthDate.getFullYear();
  const monthIndex = lastMonthDate.getMonth();
  const monthLabel = lastMonthDate.toLocaleString("en-US", { month: "long", year: "numeric" });

  const snapshot = await db.collection("users").get();
  const results = [];

  for (const docSnap of snapshot.docs) {
    const uid = docSnap.id;
    const data = docSnap.data();
    try {
      const userRecord = await adminAuth.getUser(uid);
      if (!userRecord.email) continue;

      const habitRows = (data.habits || []).map(h => ({
        name: h.name,
        pct: getMonthCompletionPct(h, year, monthIndex),
      }));
      const totalSav = sumInMonth(data.savings, year, monthIndex);
      const totalExp = sumInMonth(data.expenses, year, monthIndex);

      const html = buildSummaryHtml({
        name: userRecord.displayName,
        monthLabel,
        habitRows,
        totalSav,
        totalExp,
        currency: data.currency,
      });

      await sendEmail(userRecord.email, `Your ${monthLabel} Life Tracker summary`, html);
      results.push({ uid, email: userRecord.email, sent: true });
    } catch (err) {
      results.push({ uid, sent: false, error: String(err) });
    }
  }

  return res.status(200).json({ monthLabel, count: results.length, results });
}
