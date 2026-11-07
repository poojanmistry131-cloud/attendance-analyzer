/* ==========================================================================
   roster.js
   Shared by index.html (dashboard) and email.html.

   - ROSTER: the list of students (one source of truth for both pages).
   - Storage helpers: the dashboard saves every student's attendance marks
     and their live overall attendance % into localStorage; the email page
     reads that % so both pages always agree.

   Both pages must be served from the same origin (e.g. http://127.0.0.1:5500)
   for localStorage to be shared — which is the normal case here.
   ========================================================================== */

const ALERT_EMAIL = "12302080701097@mbit.edu.in";

// `pct` is only the starting value. Once you open a student on the
// dashboard, the real (live) percentage replaces it everywhere.
const ROSTER = [
  { name: "Poojan Patel",   enrollment: "12302080701101", email: ALERT_EMAIL, pct: 58 },
  { name: "Pradeep Yadav",  enrollment: "12302080701162", email: ALERT_EMAIL, pct: 91 },
  { name: "Moksh Shah",     enrollment: "12302080701073", email: ALERT_EMAIL, pct: 42 },
  { name: "Riya Desai",     enrollment: "12302080701138", email: ALERT_EMAIL, pct: 88 },
  { name: "Kunal Chauhan",  enrollment: "12302080701054", email: ALERT_EMAIL, pct: 65 },
  { name: "Devika Trivedi", enrollment: "12302080701119", email: ALERT_EMAIL, pct: 80 },
];

const AL_KEYS = {
  students: "al_students_v1", // { [name]: { marks, fromDate, toDate } }
  pct: "al_live_pct_v1",      // { [name]: number }  overall attendance %
  current: "al_current_student_v1",
};

function alRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function alWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / blocked — the app still works, just without syncing */
  }
}

/** ROSTER with each student's pct replaced by the live dashboard value
 *  (when the dashboard has produced one). */
function getLiveRoster() {
  const live = alRead(AL_KEYS.pct, {});
  return ROSTER.map((s) => {
    const v = live[s.name];
    return { ...s, pct: typeof v === "number" ? v : s.pct };
  });
}

function formatPct(v) {
  return `${Math.round(v * 10) / 10}%`; // 58 -> "58%", 74.6 -> "74.6%"
}
