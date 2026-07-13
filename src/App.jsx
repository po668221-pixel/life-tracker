import { useState, useEffect } from "react";
import { Plus, Trash2, LogOut, RotateCcw, Check, X, Circle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { SpeedInsights } from "@vercel/speed-insights/react";

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const SKIP_REASONS = ["Too tired","No fixed time","Distracted","Forgot","Other plans"];

const defaultHabits = [
  { id: 1, name: "Exercise", completed: false, history: {} },
  { id: 2, name: "Water Intake", completed: false, history: {} },
  { id: 3, name: "Sleep", completed: false, history: {} },
  { id: 4, name: "Reading", completed: false, history: {} },
  { id: 5, name: "Meditation", completed: false, history: {} },
];

const defaultGoals = [
  { id: 1, name: "Career Growth", status: null, editing: false },
  { id: 2, name: "Health Milestone", status: null, editing: false },
  { id: 3, name: "Creative Project", status: null, editing: false },
];

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}

// NOT cryptographic security — this is a simple obfuscation so a PIN
// isn't sitting in localStorage as plain text. Anyone with browser dev
// tools can still read localStorage directly and bypass this; it's meant
// only as a barrier against someone casually picking up a shared device
// and seeing your dashboard already open.
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Strips everything but digits, then re-inserts thousands commas as you
// type — so "50000" reads as "50,000" while you're still entering it,
// not just after the fact.
function formatWithCommas(rawInput) {
  const digitsOnly = String(rawInput).replace(/[^\d]/g, "");
  if (!digitsOnly) return "";
  return Number(digitsOnly).toLocaleString("en-US");
}

function stripCommas(formatted) {
  return String(formatted).replace(/,/g, "");
}

// For displaying totals with thousands separators, e.g. 500000 -> "500,000".
function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}

// Local calendar date as YYYY-MM-DD. Deliberately NOT using
// Date.toISOString() here — that converts to UTC first, which silently
// shifts the date for any timezone ahead of UTC (like WAT, UTC+1) and
// causes today's entries to be filed under yesterday's key.
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dateKeyFor(year, monthIndex, day) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

// Consecutive days of status "done", walking back from yesterday, plus
// today itself if it's already marked done. Critically: if today simply
// hasn't been logged YET (the day is still in progress), that does NOT
// break the streak — it stays neutral so you're not shown "0 days" first
// thing every morning before you've had a chance to log anything. Only an
// explicit "skip" on today, or a genuinely missing past day, breaks it.
function getStreak(habit) {
  const today = new Date();
  const todayKeyStr = dateKeyFor(today.getFullYear(), today.getMonth(), today.getDate());
  const todayStatus = habit.history && habit.history[todayKeyStr] ? habit.history[todayKeyStr].status : null;

  if (todayStatus === "skip") return 0;

  let streak = todayStatus === "done" ? 1 : 0;
  let d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const key = dateKeyFor(d.getFullYear(), d.getMonth(), d.getDate());
    const entry = habit.history && habit.history[key];
    if (entry && entry.status === "done") {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// Tally skip reasons across every habit's history to surface the most
// common thing that derails the day.
function daysInMonthOf(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Percent of a habit's month "won" — done days divided by the TOTAL days
// in that month, not just days elapsed. This is deliberate: it means the
// number only reaches 100% if every single day was completed, and a lone
// early-month tap can't misleadingly read as a finished month. A skipped
// or un-logged day simply doesn't add to the count, so it naturally
// lowers the percentage the way missing a day should.
function getMonthCompletionPct(habit, year, monthIndex) {
  const totalDays = daysInMonthOf(year, monthIndex);
  let doneDays = 0;
  for (let day = 1; day <= totalDays; day++) {
    const key = dateKeyFor(year, monthIndex, day);
    if (habit?.history?.[key]?.status === "done") doneDays++;
  }
  return Math.round((doneDays / totalDays) * 100);
}

// Monday-to-Sunday dates for the week containing `reference`, as actual
// Date objects — not weekday names. The old approach kept weekly data
// under keys like "Mon"/"Tue", which meant next Monday silently
// overwrote this Monday's numbers. Using real dates fixes that.
function getWeekDates(reference) {
  const d = new Date(reference);
  const day = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    dates.push(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  }
  return dates;
}

function isOnDate(dateStr, year, monthIndex, day) {
  const d = new Date(dateStr);
  return d.getFullYear() === year && d.getMonth() === monthIndex && d.getDate() === day;
}

function sumOnDate(entries, year, monthIndex, day) {
  return entries
    .filter(e => isOnDate(e.date, year, monthIndex, day))
    .reduce((s, e) => s + e.amount, 0);
}

function isInMonth(dateStr, year, monthIndex) {
  const d = new Date(dateStr);
  return d.getFullYear() === year && d.getMonth() === monthIndex;
}

function sumInMonth(entries, year, monthIndex) {
  return entries
    .filter(e => isInMonth(e.date, year, monthIndex))
    .reduce((s, e) => s + e.amount, 0);
}

// Average daily completion % across a week, only counting days that
// actually have logged entries (so unstarted future days don't drag the
// average down). Returns null if nothing was logged that week at all.
function getWeekCompletionAvg(habits, weekDates) {
  let totalPct = 0;
  let loggedDays = 0;
  weekDates.forEach(dt => {
    const key = dateKeyFor(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const doneCount = habits.filter(h => h.history?.[key]?.status === "done").length;
    const skipCount = habits.filter(h => h.history?.[key]?.status === "skip").length;
    if (doneCount + skipCount > 0) {
      loggedDays++;
      totalPct += habits.length ? (doneCount / habits.length) * 100 : 0;
    }
  });
  return loggedDays > 0 ? Math.round(totalPct / loggedDays) : null;
}

// Scans the last several weeks (including the current one) and returns
// whichever had the highest average daily completion. Replaces the old
// "Best Week" card, which was a permanent hardcoded placeholder.
function getBestWeek(habits, weeksBack = 8) {
  let best = null;
  for (let w = 0; w < weeksBack; w++) {
    const ref = new Date();
    ref.setDate(ref.getDate() - w * 7);
    const weekDates = getWeekDates(ref);
    const avg = getWeekCompletionAvg(habits, weekDates);
    if (avg !== null && (best === null || avg > best.avg)) {
      best = { avg, weekStart: weekDates[0] };
    }
  }
  return best;
}

function getTopBlocker(habits) {
  const counts = {};
  habits.forEach(h => {
    Object.values(h.history || {}).forEach(entry => {
      if (entry.status === "skip" && entry.reason) {
        counts[entry.reason] = (counts[entry.reason] || 0) + 1;
      }
    });
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? { reason: entries[0][0], count: entries[0][1] } : null;
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => !!localStorage.getItem("lt_user"));
  const [userName, setUserName] = useState(() => localStorage.getItem("lt_user") || "");
  const [loginInput, setLoginInput] = useState("");
  const [pinSetupInput, setPinSetupInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  // Deliberately NOT read from localStorage — every fresh page load starts
  // locked, even for a returning profile, so a shared device always asks
  // for the PIN instead of showing the dashboard immediately.
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState("daily");
  const [theme, setTheme] = useState(() => load("lt_theme","dark"));
  const [anim, setAnim] = useState(() => load("lt_anim","smooth"));
  const [currency, setCurrency] = useState(() => load("lt_currency","NGN"));

  const [habits, setHabits] = useState(() => {
    const stored = load("lt_habits", defaultHabits);
    // backfill history field for habits saved before this feature existed
    return stored.map(h => ({ history: {}, ...h }));
  });
  const [savings, setSavings] = useState(() => {
    const stored = load("lt_savings", []);
    // Entries logged before per-entry currency existed get tagged NGN
    // (the app's original default) — we can't know retroactively what
    // currency they were actually entered in, but this keeps them visible
    // under a sensible label rather than silently disappearing.
    return stored.map(e => ({ currency: "NGN", ...e }));
  });
  const [expenses, setExpenses] = useState(() => {
    const stored = load("lt_expenses", []);
    return stored.map(e => ({ currency: "NGN", ...e }));
  });
  const [goals, setGoals] = useState(() => load("lt_goals", defaultGoals));

  const [newHabit, setNewHabit] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [savInput, setSavInput] = useState("");
  const [expInput, setExpInput] = useState("");
  const [savError, setSavError] = useState("");
  const [expError, setExpError] = useState("");
  const [reasonPickerFor, setReasonPickerFor] = useState(null); // habit id currently choosing a skip reason
  const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm } or null

  const sym = { NGN: "₦", SAR: "﷼", CNY: "¥" }[currency] || currency;
  const minEntryAmount = { NGN: 500, SAR: 10, CNY: 10 }[currency] || 500;
  // Only entries logged in the currently selected currency count toward
  // any total below. Switching the currency selector now changes which
  // entries you're looking at, rather than just relabeling every amount
  // as if ₦5,000 and ﷼5,000 were the same number.
  const savingsInCurrency = savings.filter(s => (s.currency || "NGN") === currency);
  const expensesInCurrency = expenses.filter(e => (e.currency || "NGN") === currency);
  const totalSav = savingsInCurrency.reduce((s,e) => s + e.amount, 0);
  const totalExp = expensesInCurrency.reduce((s,e) => s + e.amount, 0);

  useEffect(() => { if (loggedIn) localStorage.setItem("lt_user", userName); }, [loggedIn, userName]);
  useEffect(() => { localStorage.setItem("lt_theme", JSON.stringify(theme)); }, [theme]);
  useEffect(() => { localStorage.setItem("lt_anim", JSON.stringify(anim)); }, [anim]);
  useEffect(() => { localStorage.setItem("lt_currency", JSON.stringify(currency)); }, [currency]);
  useEffect(() => { localStorage.setItem("lt_habits", JSON.stringify(habits)); }, [habits]);
  useEffect(() => { localStorage.setItem("lt_savings", JSON.stringify(savings)); }, [savings]);
  useEffect(() => { localStorage.setItem("lt_expenses", JSON.stringify(expenses)); }, [expenses]);
  useEffect(() => { localStorage.setItem("lt_goals", JSON.stringify(goals)); }, [goals]);

  const themes = {
    dark:      { bg: "#111827", card: "#1f2937", border: "#374151", text: "#f9fafb", sub: "#9ca3af", input: "#374151" },
    light:     { bg: "#f9fafb", card: "#ffffff", border: "#e5e7eb", text: "#111827", sub: "#6b7280", input: "#ffffff" },
    corporate: { bg: "#f3f4f6", card: "#ffffff", border: "#d1d5db", text: "#111827", sub: "#6b7280", input: "#f9fafb" },
  };
  const t = themes[theme];
  const transition = anim === "playful" ? "all 0.5s" : "all 0.3s";

  const cardStyle = { backgroundColor: t.card, border: `1px solid ${t.border}`, borderRadius: 10, padding: 16 };
  const inputStyle = { backgroundColor: t.input, border: `1px solid ${t.border}`, borderRadius: 6, padding: "8px 12px", color: t.text, outline: "none", fontSize: 14, width: "100%" };
  const btnPrimary = { backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 14, fontWeight: 600, transition };
  const btnGray = { backgroundColor: "#4b5563", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 14, transition };
  const btnRed = { backgroundColor: "#dc2626", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 14, transition };
  const btnChip = { backgroundColor: "transparent", color: t.text, border: `1px solid ${t.border}`, borderRadius: 999, padding: "4px 10px", cursor: "pointer", fontSize: 12, transition };

  // First-time setup only: creates the profile name and PIN together.
  const createProfile = () => {
    if (!loginInput.trim()) return;
    if (pinSetupInput.trim().length < 4) { setPinError("PIN must be at least 4 digits"); return; }
    setUserName(loginInput.trim());
    localStorage.setItem("lt_pin_hash", simpleHash(pinSetupInput.trim()));
    setLoggedIn(true);
    setUnlocked(true);
    setLoginInput("");
    setPinSetupInput("");
    setPinError("");
  };

  // Returning profile: checks the entered PIN against the stored hash for
  // this session only — unlocked state isn't persisted, so next time the
  // page loads it'll ask again.
  const unlockWithPin = () => {
    const storedHash = localStorage.getItem("lt_pin_hash");
    if (simpleHash(pinInput) === storedHash) {
      setUnlocked(true);
      setPinInput("");
      setPinError("");
    } else {
      setPinError("Incorrect PIN");
    }
  };

  // Full account wipe — clears the profile, PIN, and requires setting up
  // again from scratch. Separate from lockApp, which just hides the
  // dashboard without deleting anything.
  const logout = () => {
    setLoggedIn(false);
    setUnlocked(false);
    setUserName("");
    localStorage.removeItem("lt_user");
    localStorage.removeItem("lt_pin_hash");
  };

  // Quick lock: hides the dashboard behind the PIN screen without
  // touching any data — the thing to tap before handing your phone to
  // someone else, without losing your profile.
  const lockApp = () => {
    setUnlocked(false);
    setPinInput("");
    setPinError("");
  };

  // Two-step cycle per habit per day: neutral -> done -> skip. Does NOT
  // cycle back to neutral on its own, so an accidental extra tap can't
  // silently wipe a skip reason. Clearing a day is a separate, deliberate
  // action (see clearHabitToday).
  const cycleHabit = (id) => {
    const today = todayKey();
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      const cur = h.history?.[today]?.status || null;
      const next = cur === null ? "done" : "skip";
      const newHistory = { ...(h.history || {}) };
      newHistory[today] = { status: next, reason: next === "skip" ? newHistory[today]?.reason : undefined };
      if (next === "skip") setReasonPickerFor(id);
      return { ...h, completed: next === "done", history: newHistory };
    }));
  };

  // Preserves any existing fields on today's entry (like Water Intake's
  // `amount`) instead of overwriting the whole record — previously,
  // picking a skip reason after having already logged some water would
  // silently wipe the liters you'd logged back to 0.
  const setSkipReason = (id, reason) => {
    const today = todayKey();
    setHabits(prev => prev.map(h => h.id === id
      ? { ...h, history: { ...(h.history || {}), [today]: { ...(h.history?.[today] || {}), status: "skip", reason } } }
      : h));
    setReasonPickerFor(null);
  };

  // Deliberate reset of a single habit's status for today only. Separate
  // from the circle tap so you can't lose a logged skip reason by accident.
  const clearHabitToday = (id) => {
    const today = todayKey();
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      const newHistory = { ...(h.history || {}) };
      delete newHistory[today];
      return { ...h, completed: false, history: newHistory };
    }));
    if (reasonPickerFor === id) setReasonPickerFor(null);
  };

  // Clears today's logged status for every habit (not the whole history) —
  // a scoped replacement for the old "Reset" button that used to wipe
  // everything back to unchecked. Confirms first since one tap used to be
  // able to silently wipe streaks-in-progress. Uses the in-app confirm
  // dialog rather than window.confirm(), which gets silently blocked in
  // a lot of mobile in-app browsers (Instagram/WhatsApp/Facebook webviews
  // etc.) — when that happens the button just looks unresponsive.
  const resetTodayHabits = () => {
    setConfirmDialog({
      message: "Clear today's status for every habit? This won't touch past days, but today's progress and any skip reasons logged today will be lost.",
      onConfirm: () => {
        const today = todayKey();
        setHabits(prev => prev.map(h => {
          const newHistory = { ...(h.history || {}) };
          delete newHistory[today];
          return { ...h, completed: false, history: newHistory };
        }));
        setReasonPickerFor(null);
      },
    });
  };

  // Water Intake is tracked as an actual quantity (liters) rather than a
  // plain done/skip tap, since "did you drink water" isn't meaningful
  // without how much. Status auto-flips to "done" once the daily target
  // is reached, so streaks and the consistency calendar keep working the
  // same way they do for every other habit.
  const WATER_TARGET_L = 2;
  const WATER_STEP_L = 0.25;
  const addWaterAmount = (id, delta) => {
    const today = todayKey();
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      const cur = h.history?.[today]?.amount || 0;
      const next = Math.max(0, Math.round((cur + delta) * 4) / 4);
      const wasSkip = h.history?.[today]?.status === "skip";
      const status = next >= WATER_TARGET_L ? "done" : (wasSkip ? "skip" : null);
      const newHistory = { ...(h.history || {}) };
      newHistory[today] = { amount: next, status, reason: status === "skip" ? newHistory[today]?.reason : undefined };
      return { ...h, completed: status === "done", history: newHistory };
    }));
  };

  const addHabit = () => {
    if (!newHabit.trim()) return;
    setHabits([...habits, { id: Date.now(), name: newHabit.trim(), completed: false, history: {} }]);
    setNewHabit("");
  };

  const addSavings = () => {
    const amt = parseInt(stripCommas(savInput), 10);
    if (!amt || amt < minEntryAmount) { setSavError(`Minimum is ${sym}${minEntryAmount}`); return; }
    setSavError("");
    setSavings([...savings, { date: new Date().toISOString(), amount: amt, currency }]);
    setSavInput("");
  };

  const addExpenses = () => {
    const amt = parseInt(stripCommas(expInput), 10);
    if (!amt || amt < minEntryAmount) { setExpError(`Minimum is ${sym}${minEntryAmount}`); return; }
    setExpError("");
    setExpenses([...expenses, { date: new Date().toISOString(), amount: amt, currency }]);
    setExpInput("");
  };

  // Permanently deletes today's savings and expense entries — this was
  // previously called "Reset Daily Financial", which undersold what it
  // actually does. Now confirms first (via the in-app dialog, not
  // window.confirm — see the note on resetTodayHabits above), names the
  // action honestly, and is scoped to the CURRENTLY SELECTED currency only
  // — consistent with every other total on screen. Without this scoping,
  // deleting while viewing Naira would silently also wipe today's Riyal
  // or Yuan entries, which would contradict the separate-wallets model.
  const deleteTodaysFinancialEntries = () => {
    setConfirmDialog({
      message: `Delete all ${currency} savings and expense entries logged today? This is permanent and will also reduce your ${currency} lifetime total — it can't be undone. Entries in other currencies won't be affected.`,
      onConfirm: () => {
        const todayStr = new Date().toDateString();
        setSavings(savings.filter(s => !(new Date(s.date).toDateString() === todayStr && (s.currency || "NGN") === currency)));
        setExpenses(expenses.filter(e => !(new Date(e.date).toDateString() === todayStr && (e.currency || "NGN") === currency)));
        setSavInput("");
        setExpInput("");
      },
    });
  };

  const addGoal = () => {
    if (!newGoal.trim()) return;
    setGoals([...goals, { id: Date.now(), name: newGoal.trim(), status: null, editing: false }]);
    setNewGoal("");
  };

  const setGoalStatus = (id, status) =>
    setGoals(goals.map(g => g.id === id ? { ...g, status: g.status === status ? null : status } : g));

  const toggleGoalEdit = (id) =>
    setGoals(goals.map(g => g.id === id ? { ...g, editing: !g.editing } : g));

  const updateGoalName = (id, name) =>
    setGoals(goals.map(g => g.id === id ? { ...g, name } : g));

  const saveGoalName = (id) =>
    setGoals(goals.map(g => g.id === id ? { ...g, editing: false } : g));

  const weekDates = getWeekDates(new Date());
  const chartData = weekDates.map((dt, i) => {
    const key = dateKeyFor(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const doneCount = habits.filter(h => h.history?.[key]?.status === "done").length;
    const pct = habits.length ? Math.round((doneCount / habits.length) * 100) : 0;
    return { day: DAYS[i], progress: pct };
  });
  const finChartData = weekDates.map((dt, i) => ({
    day: DAYS[i],
    savings: sumOnDate(savingsInCurrency, dt.getFullYear(), dt.getMonth(), dt.getDate()),
    expenses: sumOnDate(expensesInCurrency, dt.getFullYear(), dt.getMonth(), dt.getDate()),
  }));
  const weekTotalSav = finChartData.reduce((s, d) => s + d.savings, 0);
  const weekTotalExp = finChartData.reduce((s, d) => s + d.expenses, 0);
  const now = new Date();
  const daysInMonth = daysInMonthOf(now.getFullYear(), now.getMonth());
  const exerciseDoneToday = habits.find(h => h.name === "Exercise")?.history?.[todayKey()]?.status === "done";
  const waterDoneToday = habits.find(h => h.name === "Water Intake")?.history?.[todayKey()]?.status === "done";
  const largestExpense = expensesInCurrency.length ? Math.max(...expensesInCurrency.map(e => e.amount)) : 0;
  const topBlocker = getTopBlocker(habits);
  const bestWeek = getBestWeek(habits);

  // Last-month reference point, handling the January -> December wrap.
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const exerciseHabit = habits.find(h => h.name === "Exercise");
  const waterHabit = habits.find(h => h.name === "Water Intake");
  const exercisePctThisMonth = exerciseHabit ? getMonthCompletionPct(exerciseHabit, now.getFullYear(), now.getMonth()) : 0;
  const waterPctThisMonth = waterHabit ? getMonthCompletionPct(waterHabit, now.getFullYear(), now.getMonth()) : 0;
  const exercisePctLastMonth = exerciseHabit ? getMonthCompletionPct(exerciseHabit, lastMonthDate.getFullYear(), lastMonthDate.getMonth()) : 0;
  const waterPctLastMonth = waterHabit ? getMonthCompletionPct(waterHabit, lastMonthDate.getFullYear(), lastMonthDate.getMonth()) : 0;

  // Real month-scoped financial totals, filtered from the full savings/
  // expenses lists by each entry's stored date. totalSav/totalExp remain
  // lifetime sums — kept separate on purpose, see the Lifetime Totals card.
  const totalSavThisMonth = sumInMonth(savingsInCurrency, now.getFullYear(), now.getMonth());
  const totalExpThisMonth = sumInMonth(expensesInCurrency, now.getFullYear(), now.getMonth());
  const totalSavLastMonth = sumInMonth(savingsInCurrency, lastMonthDate.getFullYear(), lastMonthDate.getMonth());
  const totalExpLastMonth = sumInMonth(expensesInCurrency, lastMonthDate.getFullYear(), lastMonthDate.getMonth());

  if (!loggedIn) return (
    <div style={{ minHeight:"100vh", backgroundColor: t.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ ...cardStyle, width: 340, padding: 36 }}>
        <h1 style={{ color: t.text, fontSize: 28, fontWeight: 700, marginBottom: 8, textAlign:"center" }}>Life Tracker</h1>
        <p style={{ color: t.sub, fontSize:13, marginBottom:20, textAlign:"center" }}>Set a PIN so this stays private on shared devices.</p>
        <input style={{ ...inputStyle, marginBottom: 12 }} placeholder="Enter your name" value={loginInput}
          onChange={e => setLoginInput(e.target.value)} onKeyPress={e => e.key === "Enter" && createProfile()} />
        <input type="password" inputMode="numeric" style={{ ...inputStyle, marginBottom: 6 }} placeholder="Create a PIN (min 4 digits)" value={pinSetupInput}
          onChange={e => { setPinSetupInput(e.target.value); if (pinError) setPinError(""); }} onKeyPress={e => e.key === "Enter" && createProfile()} />
        {pinError && <div style={{ fontSize:12, color:"#ef4444", marginBottom:10 }}>{pinError}</div>}
        <button onClick={createProfile} style={{ ...btnPrimary, width:"100%", justifyContent:"center", padding:"10px 0", fontSize:16, marginTop: pinError ? 0 : 8 }}>Enter</button>
        <p style={{ fontSize:11, color: t.sub, marginTop:14, textAlign:"center" }}>This PIN is stored locally on this device only — it's a privacy lock, not a secure login.</p>
      </div>
    </div>
  );

  if (!unlocked) return (
    <div style={{ minHeight:"100vh", backgroundColor: t.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ ...cardStyle, width: 340, padding: 36 }}>
        <h1 style={{ color: t.text, fontSize: 24, fontWeight: 700, marginBottom: 8, textAlign:"center" }}>Welcome back, {userName}</h1>
        <p style={{ color: t.sub, fontSize:13, marginBottom:20, textAlign:"center" }}>Enter your PIN to continue</p>
        <input type="password" inputMode="numeric" autoFocus style={{ ...inputStyle, marginBottom: 6 }} placeholder="PIN" value={pinInput}
          onChange={e => { setPinInput(e.target.value); if (pinError) setPinError(""); }} onKeyPress={e => e.key === "Enter" && unlockWithPin()} />
        {pinError && <div style={{ fontSize:12, color:"#ef4444", marginBottom:10 }}>{pinError}</div>}
        <button onClick={unlockWithPin} style={{ ...btnPrimary, width:"100%", justifyContent:"center", padding:"10px 0", fontSize:16, marginTop: pinError ? 0 : 8 }}>Unlock</button>
        <button onClick={logout} style={{ background:"none", border:"none", cursor:"pointer", color: t.sub, fontSize:12, width:"100%", marginTop:14 }}>Not you? Log out and start over</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", backgroundColor: t.bg, color: t.text, fontFamily:"sans-serif" }}>
      <SpeedInsights />

      <div style={{ backgroundColor: t.card, borderBottom:`1px solid ${t.border}`, padding:"12px 24px" }}>
        <div style={{ maxWidth:1100, margin:"0 auto", display:"flex", flexWrap:"wrap", alignItems:"center", justifyContent:"space-between", gap:10 }}>
          <span style={{ fontWeight:700, fontSize:18 }}>Welcome, {userName}!</span>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:"center" }}>
            <select value={theme} onChange={e => setTheme(e.target.value)} style={{ ...inputStyle, width:"auto", padding:"6px 10px" }}>
              <option value="dark">🌙 Dark</option>
              <option value="light">☀️ Light</option>
              <option value="corporate">🏢 Corporate</option>
            </select>
            <select value={anim} onChange={e => setAnim(e.target.value)} style={{ ...inputStyle, width:"auto", padding:"6px 10px" }}>
              <option value="smooth">Smooth</option>
              <option value="playful">Playful</option>
            </select>
            <select value={currency} onChange={e => setCurrency(e.target.value)}
              style={{ backgroundColor:"#2563eb", color:"#fff", border:"2px solid #60a5fa", borderRadius:6, padding:"6px 12px", fontWeight:700, fontSize:14, cursor:"pointer" }}>
              <option value="NGN">₦ Naira</option>
              <option value="SAR">﷼ Riyals</option>
              <option value="CNY">¥ Yuan</option>
            </select>
            <button onClick={lockApp} style={btnGray}><LogOut size={15}/> Lock</button>
            <button onClick={logout} style={btnRed}><LogOut size={15}/> Logout</button>
          </div>
        </div>
      </div>

      <div style={{ backgroundColor: t.card, borderBottom:`1px solid ${t.border}`, position:"sticky", top:0, zIndex:10 }}>
        <div style={{ maxWidth:1100, margin:"0 auto", display:"flex" }}>
          {["daily","weekly","monthly"].map(tt => (
            <button key={tt} onClick={() => setTab(tt)} style={{
              padding:"14px 28px", fontWeight:600, fontSize:15, background:"none", border:"none",
              cursor:"pointer", color: tab===tt ? "#3b82f6" : t.sub,
              borderBottom: tab===tt ? "3px solid #3b82f6" : "3px solid transparent",
              textTransform:"capitalize", transition
            }}>{tt}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:"0 auto", padding:"32px 20px" }}>

        {tab === "daily" && (
          <div style={{ display:"flex", flexDirection:"column", gap:32 }}>

            <div>
              <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Daily Habits</h2>
              <p style={{ color: t.sub, fontSize:14, marginBottom:16 }}>
                {new Date().toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}
              </p>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(240px, 1fr))", gap:12, marginBottom:12 }}>
                {habits.map(h => {
                  const status = h.history?.[todayKey()]?.status || null;
                  const streak = getStreak(h);
                  const skipReason = h.history?.[todayKey()]?.reason;
                  const statusColor = status === "done" ? "#22c55e" : status === "skip" ? "#ef4444" : t.sub;
                  const isWater = h.name === "Water Intake";
                  const waterAmount = h.history?.[todayKey()]?.amount || 0;
                  return (
                    <div key={h.id} style={{ ...cardStyle, display:"flex", flexDirection:"column", gap:8, outline: status === "done" ? "2px solid #22c55e" : status === "skip" ? "2px solid #ef4444" : "none", transition }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        {isWater ? (
                          <div style={{ display:"flex", gap:10, alignItems:"center", flex:1 }}>
                            <span style={{ width:20, height:20, borderRadius:"50%", border:`2px solid ${statusColor}`, display:"flex", alignItems:"center", justifyContent:"center", color:statusColor, flexShrink:0 }}>
                              {status === "done" && <Check size={13}/>}
                              {status === "skip" && <X size={13}/>}
                              {!status && <Circle size={6} fill={t.sub} stroke="none"/>}
                            </span>
                            <span style={{ fontWeight:600, color: t.text }}>{h.name}</span>
                          </div>
                        ) : (
                          <button onClick={() => cycleHabit(h.id)} style={{ display:"flex", gap:10, alignItems:"center", cursor:"pointer", flex:1, background:"none", border:"none", padding:0, textAlign:"left" }}>
                            <span style={{ width:20, height:20, borderRadius:"50%", border:`2px solid ${statusColor}`, display:"flex", alignItems:"center", justifyContent:"center", color:statusColor, flexShrink:0 }}>
                              {status === "done" && <Check size={13}/>}
                              {status === "skip" && <X size={13}/>}
                              {!status && <Circle size={6} fill={t.sub} stroke="none"/>}
                            </span>
                            <span style={{ fontWeight:600, color: t.text }}>{h.name}</span>
                          </button>
                        )}
                        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                          {status && (
                            <button onClick={() => clearHabitToday(h.id)} title="Clear today's status" style={{ background:"none", border:"none", cursor:"pointer", color: t.sub, fontSize:11 }}>clear</button>
                          )}
                          {habits.length > 5 && (
                            <button onClick={() => setHabits(habits.filter(x => x.id !== h.id))} style={{ background:"none", border:"none", cursor:"pointer", color:"#ef4444" }}><Trash2 size={16}/></button>
                          )}
                        </div>
                      </div>
                      {isWater && (
                        <div>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                            <span style={{ fontSize:20, fontWeight:700, color: t.text }}>{waterAmount}L</span>
                            <span style={{ fontSize:12, color: t.sub }}>of {WATER_TARGET_L}L target</span>
                          </div>
                          <div style={{ backgroundColor:"#374151", borderRadius:999, height:6, marginBottom:8 }}>
                            <div style={{ backgroundColor:"#3b82f6", borderRadius:999, height:6, width:`${Math.min(waterAmount/WATER_TARGET_L*100,100)}%`, transition }}></div>
                          </div>
                          <div style={{ display:"flex", gap:6 }}>
                            <button onClick={() => addWaterAmount(h.id, -WATER_STEP_L)} style={{ ...btnGray, padding:"4px 10px", fontSize:13 }}>-{WATER_STEP_L}L</button>
                            <button onClick={() => addWaterAmount(h.id, WATER_STEP_L)} style={{ ...btnPrimary, padding:"4px 10px", fontSize:13 }}>+{WATER_STEP_L}L</button>
                            {status !== "skip" && (
                              <button onClick={() => setReasonPickerFor(h.id)} style={{ ...btnGray, padding:"4px 10px", fontSize:13, marginLeft:"auto" }}>Skip today</button>
                            )}
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize:12, color: t.sub }}>
                        {streak > 0 ? `${streak} day streak` : "No streak yet"}
                        {status === "skip" && skipReason ? ` · skipped: ${skipReason}` : ""}
                      </div>
                      {reasonPickerFor === h.id && (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:4 }}>
                          {SKIP_REASONS.map(r => (
                            <button key={r} onClick={() => setSkipReason(h.id, r)} style={btnChip}>{r}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize:12, color: t.sub, marginBottom:4 }}>Floor goal: even 5 minutes counts as done — tap the circle once to mark it, don't wait for a "full" session.</p>
              <p style={{ fontSize:12, color: t.sub, marginBottom:12 }}>Tap the circle: not logged → done → skipped (asks what got in the way). Water Intake tracks actual liters and marks itself done at target. Use "clear" to undo today's status.</p>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <input style={{ ...inputStyle, flex:1, minWidth:160 }} placeholder="New habit name..." value={newHabit}
                  onChange={e => setNewHabit(e.target.value)} onKeyPress={e => e.key==="Enter" && addHabit()} />
                <button onClick={addHabit} style={btnPrimary}><Plus size={16}/> Add</button>
                <button onClick={resetTodayHabits} style={btnGray}><RotateCcw size={16}/> Reset today</button>
              </div>
            </div>

            <div>
              <h2 style={{ fontSize:22, fontWeight:700, marginBottom:16 }}>Daily Financial</h2>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:16, marginBottom:12 }}>
                <div style={cardStyle}>
                  <h3 style={{ fontWeight:600, marginBottom:12 }}>Savings</h3>
                  <div style={{ display:"flex", gap:8, marginBottom:6 }}>
                    <input type="text" inputMode="numeric" placeholder={`Amount (min ${sym}${minEntryAmount})`} value={savInput}
                      onChange={e => { setSavInput(formatWithCommas(e.target.value)); if (savError) setSavError(""); }}
                      onKeyPress={e => e.key === "Enter" && addSavings()} style={{ ...inputStyle, flex:1 }} />
                    <button onClick={addSavings} style={{ ...btnPrimary, backgroundColor:"#16a34a" }}>Add</button>
                  </div>
                  {savError && <div style={{ fontSize:12, color:"#ef4444", marginBottom:6 }}>{savError}</div>}
                  <div style={{ fontSize:13, color: t.sub, marginBottom:6 }}>Total: {sym}{fmt(totalSav)}</div>
                  <div style={{ backgroundColor:"#374151", borderRadius:999, height:6 }}>
                    <div style={{ backgroundColor:"#22c55e", borderRadius:999, height:6, width:`${Math.min(totalSav/50000*100,100)}%`, transition }}></div>
                  </div>
                </div>
                <div style={cardStyle}>
                  <h3 style={{ fontWeight:600, marginBottom:12 }}>Expenses</h3>
                  <div style={{ display:"flex", gap:8, marginBottom:6 }}>
                    <input type="text" inputMode="numeric" placeholder={`Amount (min ${sym}${minEntryAmount})`} value={expInput}
                      onChange={e => { setExpInput(formatWithCommas(e.target.value)); if (expError) setExpError(""); }}
                      onKeyPress={e => e.key === "Enter" && addExpenses()} style={{ ...inputStyle, flex:1 }} />
                    <button onClick={addExpenses} style={{ ...btnPrimary, backgroundColor:"#ea580c" }}>Add</button>
                  </div>
                  {expError && <div style={{ fontSize:12, color:"#ef4444", marginBottom:6 }}>{expError}</div>}
                  <div style={{ fontSize:13, color: t.sub, marginBottom:6 }}>Total: {sym}{fmt(totalExp)}</div>
                  <div style={{ backgroundColor:"#374151", borderRadius:999, height:6 }}>
                    <div style={{ backgroundColor:"#f97316", borderRadius:999, height:6, width:`${Math.min(totalExp/50000*100,100)}%`, transition }}></div>
                  </div>
                </div>
              </div>
              <button onClick={deleteTodaysFinancialEntries} style={btnRed}>
                <Trash2 size={16}/> Delete today's entries
              </button>
            </div>
          </div>
        )}

        {tab === "weekly" && (
          <div style={{ display:"flex", flexDirection:"column", gap:32 }}>
            <div>
              <h2 style={{ fontSize:22, fontWeight:700, marginBottom:16 }}>Weekly Habit Progress</h2>
              <div style={cardStyle}>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                    <XAxis dataKey="day" stroke={t.sub} />
                    <YAxis stroke={t.sub} />
                    <Tooltip contentStyle={{ backgroundColor: t.card, border:`1px solid ${t.border}`, color: t.text }} formatter={v => [`${v}%`, "Completion"]} />
                    <Line type="monotone" dataKey="progress" stroke="#3b82f6" strokeWidth={3} dot={{ fill:"#3b82f6", r:5 }} activeDot={{ r:7 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p style={{ fontSize:13, color: t.sub, marginTop:8 }}>Check off habits daily to see your weekly completion trend.</p>
            </div>

            <div>
              <h2 style={{ fontSize:22, fontWeight:700, marginBottom:16 }}>Weekly Financial Comparison</h2>
              <div style={cardStyle}>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={finChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                    <XAxis dataKey="day" stroke={t.sub} />
                    <YAxis stroke={t.sub} />
                    <Tooltip contentStyle={{ backgroundColor: t.card, border:`1px solid ${t.border}`, color: t.text }} formatter={v => [`${sym}${fmt(v)}`, ""]} />
                    <Line type="monotone" dataKey="savings" stroke="#3b82f6" strokeWidth={3} dot={{ fill:"#3b82f6", r:5 }} name="Savings" />
                    <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={3} dot={{ fill:"#ef4444", r:5 }} name="Expenses" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display:"flex", gap:20, marginTop:10, fontSize:13 }}>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}><div style={{ width:14, height:14, borderRadius:"50%", backgroundColor:"#3b82f6" }}></div> Savings</div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}><div style={{ width:14, height:14, borderRadius:"50%", backgroundColor:"#ef4444" }}></div> Expenses</div>
              </div>
            </div>

            <div style={cardStyle}>
              <h3 style={{ fontWeight:700, fontSize:17, marginBottom:16 }}>Weekly Financial Summary</h3>
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span>Total Saved This Week:</span><span style={{ fontWeight:700, color:"#22c55e" }}>{sym}{fmt(weekTotalSav)}</span></div>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span>Total Spent This Week:</span><span style={{ fontWeight:700, color:"#ef4444" }}>{sym}{fmt(weekTotalExp)}</span></div>
                <div style={{ borderTop:`1px solid ${t.border}`, paddingTop:12, display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontWeight:700 }}>Difference:</span>
                  <span style={{ fontWeight:700, color: weekTotalSav >= weekTotalExp ? "#22c55e" : "#ef4444" }}>{sym}{fmt(Math.abs(weekTotalSav - weekTotalExp))}</span>
                </div>
                <div style={{ fontSize:13, color: t.sub }}>
                  {weekTotalSav >= weekTotalExp
                    ? `✓ You are saving more than you're spending by ${sym}${fmt(weekTotalSav - weekTotalExp)}`
                    : `⚠ You are spending more than you're saving by ${sym}${fmt(weekTotalExp - weekTotalSav)}`}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "monthly" && (
          <div style={{ display:"flex", flexDirection:"column", gap:32 }}>

            <div>
              <h2 style={{ fontSize:36, fontWeight:800, marginBottom:4 }}>
                {new Date().toLocaleString("en-US",{month:"long"})} {new Date().getFullYear()} - Monthly Overview
              </h2>
              <p style={{ color: t.sub }}>Track your progress across all categories</p>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(200px, 1fr))", gap:12 }}>
              {[
                { label:"Exercise", value: exerciseDoneToday ? "✓ Done Today" : "Not done today", note:"Today's status" },
                { label:"Water Intake", value: waterDoneToday ? "✓ Done Today" : "Not done today", note:"Today's status" },
                { label:"Total Savings", value:`${sym}${fmt(totalSav)}`, note:"Cumulative savings" },
                { label:"Total Expenses", value:`${sym}${fmt(totalExp)}`, note:"Cumulative expenses" },
              ].map((c,i) => (
                <div key={i} style={cardStyle}>
                  <div style={{ fontSize:12, color: t.sub, marginBottom:4 }}>{c.label}</div>
                  <div style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>{c.value}</div>
                  <div style={{ fontSize:12, color: t.sub }}>{c.note}</div>
                </div>
              ))}
            </div>

            <div>
              <h3 style={{ fontSize:18, fontWeight:700, marginBottom:12 }}>Daily Consistency</h3>
              <div style={cardStyle}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gap:6 }}>
                  {[...Array(daysInMonth)].map((_,i) => {
                    const dayNum = i + 1;
                    const now = new Date();
                    const dateKey = dateKeyFor(now.getFullYear(), now.getMonth(), dayNum);
                    const isFuture = dayNum > now.getDate();
                    const total = habits.length;
                    const doneCount = habits.filter(h => h.history?.[dateKey]?.status === "done").length;
                    const skipCount = habits.filter(h => h.history?.[dateKey]?.status === "skip").length;
                    const loggedCount = doneCount + skipCount;
                    let bg = "#374151", color = "#9ca3af";
                    if (isFuture) {
                      bg = "transparent"; color = "#6b7280";
                    } else if (loggedCount === 0) {
                      bg = "#374151"; color = "#9ca3af";
                    } else if (skipCount > 0) {
                      const alpha = 0.3 + 0.7 * (skipCount / total);
                      bg = `rgba(239, 68, 68, ${alpha})`;
                      color = alpha > 0.6 ? "#450a0a" : "#fecaca";
                    } else {
                      const alpha = 0.3 + 0.7 * (doneCount / total);
                      bg = `rgba(34, 197, 94, ${alpha})`;
                      color = alpha > 0.6 ? "#052e13" : "#bbf7d0";
                    }
                    return (
                      <div key={i} title={loggedCount ? `${doneCount} done, ${skipCount} skipped of ${total}` : "Not logged"} style={{ aspectRatio:"1", display:"flex", alignItems:"center", justifyContent:"center", borderRadius:6, fontSize:12, fontWeight:600, backgroundColor: bg, color, border: isFuture ? `1px dashed ${t.border}` : "none" }}>{dayNum}</div>
                    );
                  })}
                </div>
                <div style={{ display:"flex", gap:16, marginTop:12, fontSize:12, flexWrap:"wrap", alignItems:"center" }}>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}><div style={{ width:14, height:14, borderRadius:4, backgroundColor:"#22c55e" }}></div> More done = darker green</div>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}><div style={{ width:14, height:14, borderRadius:4, backgroundColor:"#ef4444" }}></div> Any skip = red, darker with more skips</div>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}><div style={{ width:14, height:14, borderRadius:4, backgroundColor:"#374151" }}></div> Not logged</div>
                </div>
                <p style={{ fontSize:12, color: t.sub, marginTop:10 }}>Based on all {habits.length} habit{habits.length===1?"":"s"}. A day with any skip shows red regardless of what else got done, since that's the pattern worth catching.</p>
              </div>
            </div>

            <div>
              <h3 style={{ fontSize:18, fontWeight:700, marginBottom:12 }}>Month Comparison</h3>
              <p style={{ fontSize:12, color: t.sub, marginBottom:12 }}>Percent of the month's days completed — out of the whole month, not just days so far. Only reaches 100% if every day was marked done.</p>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:16 }}>
                <div style={cardStyle}>
                  <div style={{ fontSize:13, color: t.sub, fontWeight:600, marginBottom:16 }}>Last month</div>
                  {[["Exercise", `${exercisePctLastMonth}%`],["Water Intake", `${waterPctLastMonth}%`],["Savings", `${sym}${fmt(totalSavLastMonth)}`],["Expenses", `${sym}${fmt(totalExpLastMonth)}`]].map(([k,v]) => (
                    <div key={k} style={{ marginBottom:12 }}>
                      <div style={{ fontSize:12, color: t.sub }}>{k}</div>
                      <div style={{ fontSize:22, fontWeight:700, color: k==="Expenses" ? "#f97316" : t.sub }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={cardStyle}>
                  <div style={{ fontSize:13, color: t.sub, fontWeight:600, marginBottom:16 }}>This month (in progress)</div>
                  {[
                    ["Exercise", `${exercisePctThisMonth}%`],
                    ["Water Intake", `${waterPctThisMonth}%`],
                    ["Savings", `${sym}${fmt(totalSavThisMonth)}`],
                    ["Expenses", `${sym}${fmt(totalExpThisMonth)}`],
                  ].map(([k,v]) => (
                    <div key={k} style={{ marginBottom:12 }}>
                      <div style={{ fontSize:12, color: t.sub }}>{k}</div>
                      <div style={{ fontSize:22, fontWeight:700, color: k==="Expenses" ? "#f97316" : "#22c55e" }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <h3 style={{ fontSize:18, fontWeight:700, marginBottom:12 }}>Key Insights</h3>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:12 }}>
                {[
                  { icon:"🎯", title:"Best Week", sub: bestWeek ? `Week of ${bestWeek.weekStart.toLocaleDateString("en-US",{month:"short",day:"numeric"})}` : "No data yet", stat: bestWeek ? `${bestWeek.avg}% avg completion` : "Start tracking!", color:"#22c55e" },
                  { icon:"⚠️", title:"Most Common Blocker", sub: topBlocker ? `Logged ${topBlocker.count} time${topBlocker.count===1?"":"s"}` : "No skips logged yet", stat: topBlocker ? topBlocker.reason : "Keep logging daily!", color:"#eab308" },
                  { icon:"💾", title:"Largest Expense", sub: expensesInCurrency.length ? "Single transaction" : "No entries yet", stat:`${sym}${fmt(largestExpense)}`, color:"#3b82f6" },
                ].map((ins,i) => (
                  <div key={i} style={{ ...cardStyle, border:`2px solid ${ins.color}` }}>
                    <div style={{ fontSize:24, marginBottom:6 }}>{ins.icon}</div>
                    <div style={{ fontWeight:600, marginBottom:4 }}>{ins.title}</div>
                    <div style={{ fontSize:13, color: t.sub }}>{ins.sub}</div>
                    <div style={{ fontSize:13, fontWeight:700, color: ins.color, marginTop:6 }}>{ins.stat}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 style={{ fontSize:18, fontWeight:700, marginBottom:12 }}>Monthly Goals</h3>
              <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:12 }}>
                {goals.map(g => (
                  <div key={g.id} style={cardStyle}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, gap:8 }}>
                      {g.editing ? (
                        <input
                          autoFocus
                          value={g.name}
                          onChange={e => updateGoalName(g.id, e.target.value)}
                          onKeyPress={e => e.key === "Enter" && saveGoalName(g.id)}
                          onBlur={() => saveGoalName(g.id)}
                          style={{ ...inputStyle, flex:1, fontWeight:600, fontSize:15 }}
                        />
                      ) : (
                        <span
                          onClick={() => toggleGoalEdit(g.id)}
                          title="Click to edit"
                          style={{ fontWeight:600, fontSize:15, cursor:"text", flex:1, borderBottom:`1px dashed ${t.border}`, paddingBottom:2 }}
                        >
                          {g.name} ✏️
                        </span>
                      )}
                      {goals.length > 1 && (
                        <button onClick={() => setGoals(goals.filter(x => x.id !== g.id))} style={{ background:"none", border:"none", cursor:"pointer", color:"#ef4444" }}><Trash2 size={15}/></button>
                      )}
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                      {[
                        { key:"started", label:"Started", active:"#2563eb", border:"#3b82f6" },
                        { key:"inprogress", label:"In Progress", active:"#ca8a04", border:"#eab308" },
                        { key:"done", label:"Done", active:"#16a34a", border:"#22c55e" },
                      ].map(({ key, label, active, border }) => (
                        <button key={key} onClick={() => setGoalStatus(g.id, key)} style={{
                          border: `4px solid ${g.status === key ? active : t.border}`,
                          backgroundColor: g.status === key ? active : "transparent",
                          color: g.status === key ? "#fff" : t.sub,
                          borderRadius: 8, padding:"12px 6px", fontWeight:700, fontSize:13,
                          cursor:"pointer", transition
                        }}>
                          {g.status === key ? "✓ " : ""}{label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <input style={{ ...inputStyle, flex:1, minWidth:180 }} placeholder="Enter goal name..." value={newGoal}
                  onChange={e => setNewGoal(e.target.value)} onKeyPress={e => e.key==="Enter" && addGoal()} />
                <button onClick={addGoal} style={btnPrimary}><Plus size={16}/> Add Goal</button>
              </div>
            </div>

            <div>
              <h3 style={{ fontSize:18, fontWeight:700, marginBottom:12 }}>Monthly Financial</h3>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:16, marginBottom:16 }}>
                <div style={cardStyle}>
                  <div style={{ fontWeight:600, marginBottom:8 }}>Monthly Savings</div>
                  <div style={{ fontSize:32, fontWeight:700, color:"#22c55e", marginBottom:8 }}>{sym}{fmt(totalSavThisMonth)}</div>
                  <div style={{ backgroundColor:"#374151", borderRadius:999, height:6 }}>
                    <div style={{ backgroundColor:"#22c55e", borderRadius:999, height:6, width:`${Math.min(totalSavThisMonth/500000*100,100)}%`, transition }}></div>
                  </div>
                </div>
                <div style={cardStyle}>
                  <div style={{ fontWeight:600, marginBottom:8 }}>Monthly Expenses</div>
                  <div style={{ fontSize:32, fontWeight:700, color:"#f97316", marginBottom:8 }}>{sym}{fmt(totalExpThisMonth)}</div>
                  <div style={{ backgroundColor:"#374151", borderRadius:999, height:6 }}>
                    <div style={{ backgroundColor:"#f97316", borderRadius:999, height:6, width:`${Math.min(totalExpThisMonth/500000*100,100)}%`, transition }}></div>
                  </div>
                  {totalExpThisMonth > 400000 && <div style={{ fontSize:12, color:"#ef4444", marginTop:6 }}>🚨 Alert: Over budget!</div>}
                </div>
              </div>
              <div style={{ ...cardStyle, marginBottom:16 }}>
                <h4 style={{ fontWeight:700, fontSize:16, marginBottom:14 }}>Monthly Financial Summary</h4>
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between" }}><span>Total Saved This Month:</span><span style={{ fontWeight:700, color:"#22c55e" }}>{sym}{fmt(totalSavThisMonth)}</span></div>
                  <div style={{ display:"flex", justifyContent:"space-between" }}><span>Total Spent This Month:</span><span style={{ fontWeight:700, color:"#ef4444" }}>{sym}{fmt(totalExpThisMonth)}</span></div>
                  <div style={{ borderTop:`1px solid ${t.border}`, paddingTop:12, display:"flex", justifyContent:"space-between" }}>
                    <span style={{ fontWeight:700 }}>Difference:</span>
                    <span style={{ fontWeight:700, color: totalSavThisMonth>=totalExpThisMonth ? "#22c55e" : "#ef4444" }}>{sym}{fmt(Math.abs(totalSavThisMonth-totalExpThisMonth))}</span>
                  </div>
                  <div style={{ fontSize:13, color: t.sub }}>
                    {totalSavThisMonth >= totalExpThisMonth
                      ? `✓ Great month! You saved more than you spent by ${sym}${fmt(totalSavThisMonth - totalExpThisMonth)}`
                      : `⚠ You spent more than you saved this month by ${sym}${fmt(totalExpThisMonth - totalSavThisMonth)}`}
                  </div>
                </div>
              </div>
              <div style={cardStyle}>
                <h4 style={{ fontWeight:700, fontSize:16, marginBottom:14 }}>Lifetime Totals</h4>
                <p style={{ fontSize:12, color: t.sub, marginBottom:14 }}>Everything you've ever logged, across every month — separate from the monthly figures above.</p>
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between" }}><span>Total saved, all time:</span><span style={{ fontWeight:700, color:"#22c55e" }}>{sym}{fmt(totalSav)}</span></div>
                  <div style={{ display:"flex", justifyContent:"space-between" }}><span>Total spent, all time:</span><span style={{ fontWeight:700, color:"#ef4444" }}>{sym}{fmt(totalExp)}</span></div>
                  <div style={{ borderTop:`1px solid ${t.border}`, paddingTop:12, display:"flex", justifyContent:"space-between" }}>
                    <span style={{ fontWeight:700 }}>Net, all time:</span>
                    <span style={{ fontWeight:700, color: totalSav>=totalExp ? "#22c55e" : "#ef4444" }}>{sym}{fmt(Math.abs(totalSav-totalExp))}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>

      {confirmDialog && (
        <div style={{ position:"fixed", inset:0, backgroundColor:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:20 }}>
          <div style={{ ...cardStyle, maxWidth:380, width:"100%" }}>
            <p style={{ marginBottom:20, lineHeight:1.5 }}>{confirmDialog.message}</p>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={() => setConfirmDialog(null)} style={btnGray}>Cancel</button>
              <button
                onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                style={btnRed}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
