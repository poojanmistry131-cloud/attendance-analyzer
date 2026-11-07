/* ==========================================================================
   script.js
   Talks to the FastAPI backend at API_BASE, renders:
     - summary strip
     - subject list (sidebar)
     - the signature "bunk fuel gauge" (hand-built SVG, no library)
     - monthly trend + day-of-week Chart.js charts
     - an interactive month calendar (year/month + date-range picker) where
       dates can be clicked to mark Present/Absent
   ========================================================================== */

const API_BASE = "http://127.0.0.1:8000";

let state = {
  analysis: null,        // { summary, subjects }
  recommendations: null, // { threshold, recommendations }
  selectedSubject: null,
  currentStudent: null,  // name of the student whose register is on screen
  students: {},          // name -> { marks: {subject: {date: status}}, fromDate, toDate }
  trendChart: null,
  dayChart: null,
  calendar: {
    fromDate: null,             // "YYYY-MM-DD"
    toDate: null,               // "YYYY-MM-DD"
    backendLogBySubject: {},    // subject -> {} — intentionally always blank now (see ensureCalendarLogLoaded)
    backendDateBoundsBySubject: {}, // subject -> { min, max } "YYYY-MM-DD", used only to size the default range
    userMarksBySubject: {},     // subject -> { "YYYY-MM-DD": "present"/"absent"/"holiday" } set by clicking
  },
};

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------------- */
/* Bootstrapping                                                          */
/* ---------------------------------------------------------------------- */

$("thresholdSelect").addEventListener("change", () => {
  if (!state.analysis) return;
  renderAll();
});

$("retryBtn").addEventListener("click", () => {
  $("emptyState").classList.add("hidden");
  autoLoad();
});

$("loadSampleDataBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleSampleDataMenu();
});

$("sampleDataMenu").addEventListener("click", (e) => {
  const item = e.target.closest(".dropdown-item");
  if (!item) return;
  loadSampleAttendanceData(item.dataset.sample);
  closeSampleDataMenu();
});

document.addEventListener("click", (e) => {
  if (!$("sampleDataDropdown").contains(e.target)) closeSampleDataMenu();
});

function toggleSampleDataMenu() {
  const isOpen = !$("sampleDataMenu").classList.contains("hidden");
  isOpen ? closeSampleDataMenu() : openSampleDataMenu();
}
function openSampleDataMenu() {
  $("sampleDataMenu").classList.remove("hidden");
  $("loadSampleDataBtn").setAttribute("aria-expanded", "true");
}
function closeSampleDataMenu() {
  $("sampleDataMenu").classList.add("hidden");
  $("loadSampleDataBtn").setAttribute("aria-expanded", "false");
}

/** The app opens straight into the bundled sample register — no manual
 *  "load" step. If the backend can't be reached, show a retry prompt. */
async function autoLoad() {
  try {
    await postSample();
    await refreshAll();
  } catch (e) {
    $("emptyStateMessage").textContent = e.message || "Something went wrong while loading attendance data.";
    $("emptyState").classList.remove("hidden");
  }
}

autoLoad();

/* ---------------------------------------------------------------------- */
/* API calls                                                              */
/* ---------------------------------------------------------------------- */

async function postSample() {
  const res = await fetch(`${API_BASE}/api/sample`);
  if (!res.ok) throw new Error("Could not load sample data. Is the backend running on :8000?");
  return res.json();
}

async function postUpload(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Upload failed.");
  }
  return res.json();
}

async function loadAnalysis() {
  const res = await fetch(`${API_BASE}/api/analysis`);
  if (!res.ok) throw new Error("Could not fetch analysis.");
  state.analysis = await res.json();
}

async function loadRecommendations() {
  const threshold = $("thresholdSelect").value;
  const res = await fetch(`${API_BASE}/api/recommendations?threshold=${threshold}`);
  if (!res.ok) throw new Error("Could not fetch recommendations.");
  state.recommendations = await res.json();
}

async function loadCalendar(subject) {
  const res = await fetch(`${API_BASE}/api/calendar/${encodeURIComponent(subject)}`);
  if (!res.ok) throw new Error("Could not fetch calendar.");
  return res.json();
}

async function refreshAll() {
  await loadAnalysis();
  await loadRecommendations();
  // Preload every subject's backend log once, so live recompute (summary,
  // sidebar, detail) can run synchronously as the user ticks the calendar.
  await Promise.all(state.analysis.subjects.map((s) => ensureCalendarLogLoaded(s.subject)));
  initStudents(); // per-student registers (loads saved marks, or seeds a first-time student)
  if (!state.calendar.fromDate) setDefaultCalendarRange(); // fallback only
  if (!state.selectedSubject && state.analysis.subjects.length) {
    // Default to the riskiest subject, since that's the one that needs attention.
    state.selectedSubject = state.recommendations.recommendations[0].subject;
  }
  $("emptyState").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  renderAll();
}

/* ---------------------------------------------------------------------- */
/* Rendering                                                              */
/* ---------------------------------------------------------------------- */

function renderAll() {
  const thresholdPct = parseFloat($("thresholdSelect").value) * 100;
  const liveMap = {};
  state.analysis.subjects.forEach((s) => { liveMap[s.subject] = computeLiveStats(s.subject, thresholdPct); });
  state.liveStats = liveMap;

  // Save first: the email page's percentages must update even if a chart
  // fails to draw (e.g. Chart.js CDN blocked offline).
  persistStudent(liveMap);

  renderSummary(liveMap);
  renderSubjectList(liveMap);
  renderDetail(liveMap);
}

function riskClass(level) {
  if (level === "Safe") return "safe";
  if (level === "Moderate") return "moderate";
  if (level === "No Data") return "neutral";
  return "risk";
}

function renderSummary(liveMap) {
  const all = Object.values(liveMap);
  const totalClasses = all.reduce((sum, s) => sum + s.total, 0);
  const totalAttended = all.reduce((sum, s) => sum + s.attended, 0);
  const overallPct = totalClasses ? (totalAttended / totalClasses) * 100 : 0;
  const atRisk = all.filter((s) => s.level === "High Risk").length;
  const marked = all.filter((s) => s.total > 0);
  const best = marked.length ? marked.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
  const worst = marked.length ? marked.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;

  $("summaryStrip").innerHTML = `
    <div class="summary-tile">
      <span class="label">Overall attendance</span>
      <span class="value">${totalClasses ? overallPct.toFixed(1) + "%" : "—"}</span>
    </div>
    <div class="summary-tile">
      <span class="label">Total classes logged</span>
      <span class="value">${totalClasses}</span>
    </div>
    <div class="summary-tile">
      <span class="label">Subjects at risk</span>
      <span class="value">${atRisk}</span>
    </div>
    <div class="summary-tile">
      <span class="label">Strongest subject</span>
      <span class="value small">${escapeHtml(best ? best.subject : "Not marked yet")}</span>
    </div>
    <div class="summary-tile">
      <span class="label">Weakest subject</span>
      <span class="value small">${escapeHtml(worst ? worst.subject : "Not marked yet")}</span>
    </div>
  `;
}

function renderSubjectList(liveMap) {
  const list = $("subjectList");
  list.innerHTML = "";
  Object.values(liveMap)
    .slice()
    .sort((a, b) => a.pct - b.pct)
    .forEach((s) => {
      const cls = riskClass(s.level);
      const item = document.createElement("div");
      item.className = "subject-item" + (s.subject === state.selectedSubject ? " active" : "");
      item.innerHTML = `
        <span class="name">${escapeHtml(s.subject)}</span>
        <span class="pct ${cls}">${s.pct.toFixed(1)}%</span>
      `;
      item.addEventListener("click", () => {
        state.selectedSubject = s.subject;
        renderAll();
      });
      list.appendChild(item);
    });
}

function renderDetail(liveMap) {
  const stats = liveMap[state.selectedSubject];
  if (!stats) return;

  const cls = riskClass(stats.level);

  $("detailSubjectName").textContent = stats.subject;
  $("detailEyebrow").textContent = state.currentStudent
    ? `${state.currentStudent} · Bunk-risk recommender`
    : "Bunk-risk recommender";
  $("riskPill").textContent = stats.level;
  $("riskPill").className = `risk-pill ${cls}`;

  $("statPct").textContent = `${stats.pct.toFixed(1)}%`;
  $("statFraction").textContent = `${stats.attended} / ${stats.total}`;
  $("statTrend").textContent = stats.level === "No Data" ? "No data yet" : `${stats.trendLabel} (${stats.slope > 0 ? "+" : ""}${stats.slope.toFixed(2)}%/mo)`;
  $("statProjection").textContent = stats.level === "No Data" ? "—" : `${stats.projected.toFixed(1)}%`;

  $("recommendationText").textContent = stats.message;

  if (stats.level === "No Data") {
    $("gaugeValue").textContent = "—";
    $("gaugeValue").parentElement.querySelector(".gauge-label").textContent = "no classes logged yet";
  } else {
    $("gaugeValue").textContent = stats.level === "High Risk" ? `+${stats.needed}` : stats.bunks;
    $("gaugeValue").parentElement.querySelector(".gauge-label").textContent =
      stats.level === "High Risk" ? "classes to attend to recover" : "safe bunks left";
  }

  drawGauge(stats.score, cls);
  drawTrendChart(stats.monthlySeries, stats.monthLabels);
  drawDayChart(stats.dayPattern);

  $("calendarSubjectName").textContent = stats.subject;
  renderCalendarRange();
}

/* ---------------------------------------------------------------------- */
/* Live analysis & recommendation engine (client-side)                    */
/*                                                                        */
/* Everything shown for a subject — attendance %, gauge, risk pill,       */
/* recommendation text, monthly trend chart, day-of-week chart — is       */
/* recomputed from the "effective log": the backend's original           */
/* Present/Absent records for that subject, overridden by whatever the    */
/* user has ticked on the calendar. This mirrors data_processor.py /      */
/* recommender.py on the backend, but runs instantly in the browser so    */
/* every calendar click updates the whole dashboard live.                 */
/* ---------------------------------------------------------------------- */

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Merge the backend log with the user's calendar ticks for one subject
 *  into a single sorted list of {date, status} — ticks win on conflict.
 *  Dates ticked "holiday" are dropped entirely: they don't count as a class
 *  day at all, so they can't help or hurt the attendance percentage.
 *  If fromDate/toDate are given, only entries inside that range are kept —
 *  this is what lets the whole dashboard scope itself to the calendar's
 *  selected date range. */
function buildEffectiveLog(subject, fromDate, toDate) {
  const backendLog = state.calendar.backendLogBySubject[subject] || {};
  const userMarks = state.calendar.userMarksBySubject[subject] || {};

  const merged = { ...backendLog };
  Object.entries(userMarks).forEach(([date, status]) => {
    if (status === "holiday") {
      delete merged[date]; // excluded from attendance entirely
    } else {
      merged[date] = status[0].toUpperCase() + status.slice(1); // "present" -> "Present"
    }
  });

  return Object.entries(merged)
    .filter(([date]) => (!fromDate || date >= fromDate) && (!toDate || date <= toDate))
    .map(([date, status]) => ({ date, status, dateObj: new Date(`${date}T00:00:00`) }))
    .sort((a, b) => a.dateObj - b.dateObj);
}

function linearSlope(series) {
  const n = series.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = series.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (series[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Project one step beyond the series using the fitted line — with monthly
 *  buckets, "one step ahead" means "next month". */
function projectNext(series) {
  if (series.length === 0) return 0;
  if (series.length === 1) return series[0];
  const slope = linearSlope(series);
  const n = series.length;
  const xMean = (n - 1) / 2;
  const yMean = series.reduce((a, b) => a + b, 0) / n;
  const intercept = yMean - slope * xMean;
  return Math.max(0, Math.min(100, slope * n + intercept));
}

/** Same attendance-requirement math as recommender.py's safe_bunks().
 *  Uses whole-number percentages so floating-point rounding can't make the
 *  answer off by one (e.g. 4.2 / 0.35 = 12.000000000000002 -> 13). */
function safeBunksCalc(attended, total, threshold) {
  if (total === 0) return { bunks: 0, needed: 0 };
  const p = Math.round(threshold * 100);          // e.g. 0.75 -> 75
  if (p >= 100) return { bunks: 0, needed: 0 };
  const bunks = Math.floor((attended * 100 - p * total) / p);
  if (bunks >= 0) return { bunks, needed: 0 };
  const needed = Math.ceil((p * total - 100 * attended) / (100 - p));
  return { bunks: 0, needed: Math.max(needed, 0) };
}

/** Same blended 0-100 risk score as recommender.py's risk_score(). */
function riskScoreCalc(pct, slope, thresholdPct) {
  const distance = (thresholdPct - pct) * 2.5;
  const trend = Math.max(-15, Math.min(15, -slope * 4));
  return Math.max(0, Math.min(100, distance + trend + 40));
}

function classifyRiskCalc(score) {
  if (score < 35) return "Safe";
  if (score < 65) return "Moderate";
  return "High Risk";
}

/** Join day names the natural way: "Thursdays", "Thursdays and Saturdays",
 *  or "Thursdays, Fridays, and Saturdays". */
function formatDayList(days) {
  const plural = days.map((d) => `${d}s`);
  if (plural.length === 1) return plural[0];
  if (plural.length === 2) return `${plural[0]} and ${plural[1]}`;
  return `${plural.slice(0, -1).join(", ")}, and ${plural[plural.length - 1]}`;
}

function buildMessageCalc(subject, pct, level, bunks, needed, trendLabel, bunkDays, projected, thresholdPct) {
  const parts = [];

  if (level === "Safe") {
    parts.push(
      `You're comfortably above the ${thresholdPct.toFixed(0)}% mark at ${pct.toFixed(1)}%. ` +
      `You can afford to miss ${bunks} more class${bunks !== 1 ? "es" : ""} and still stay compliant.`
    );
  } else if (level === "Moderate" && needed === 0) {
    parts.push(
      `You're at ${pct.toFixed(1)}%, close to the ${thresholdPct.toFixed(0)}% line. ` +
      `You have about ${bunks} safe bunk${bunks !== 1 ? "s" : ""} left — use them carefully.`
    );
  } else if (needed > 0) {
    parts.push(
      `You're at ${pct.toFixed(1)}%, below the ${thresholdPct.toFixed(0)}% requirement. ` +
      `Attend the next ${needed} class${needed !== 1 ? "es" : ""} in a row with zero absences to get back on track.`
    );
  } else {
    parts.push(`You're at ${pct.toFixed(1)}%, right at the edge — don't miss the next class.`);
  }

  if (trendLabel === "Declining") parts.push("Your attendance has been trending down over recent months.");
  else if (trendLabel === "Improving") parts.push("Good news — your attendance has been trending upward recently.");

  if (bunkDays && bunkDays.length) {
    const dayList = formatDayList(bunkDays);
    parts.push(
      bunkDays.length > 1
        ? `You often bunk ${subject} on ${dayList} — try not to skip class on these days.`
        : `You often bunk ${subject} on ${dayList} — try not to skip class on that day.`
    );
  }

  if (projected < thresholdPct && level !== "High Risk") {
    parts.push(`At the current trend, you're projected to drop to ~${projected.toFixed(1)}% next month.`);
  }

  return parts.join(" ");
}

/** The single entry point: given a subject, compute everything the
 *  dashboard needs, live, from its effective log — scoped to the calendar's
 *  currently selected From/To date range. */
function computeLiveStats(subject, thresholdPct) {
  const log = buildEffectiveLog(subject, state.calendar.fromDate, state.calendar.toDate);
  const total = log.length;
  const attended = log.filter((e) => e.status === "Present").length;

  // No classes logged yet in this range (e.g. day 1, before anything has
  // happened) — 0% is technically correct, but "High Risk" / risk-score
  // math implies a bad track record that doesn't exist yet. Show a clean
  // neutral state instead of an alarming, misleading one.
  if (total === 0) {
    return {
      subject, total: 0, attended: 0, absent: 0, pct: 0,
      monthlySeries: [], monthLabels: [], slope: 0, trendLabel: "No data",
      dayPattern: {}, worstDay: null, bunkDays: [], projected: 0,
      bunks: 0, needed: 0, score: 0, level: "No Data",
      message: `No classes have been logged yet for ${subject} in this date range. Attendance will show here once classes start.`,
    };
  }

  const pct = (attended / total) * 100;

  const monthlyMap = {};
  log.forEach((e) => {
    const key = e.date.slice(0, 7); // "YYYY-MM"
    if (!monthlyMap[key]) monthlyMap[key] = { present: 0, total: 0 };
    monthlyMap[key].total++;
    if (e.status === "Present") monthlyMap[key].present++;
  });
  const monthKeys = Object.keys(monthlyMap).sort();
  const monthlySeries = monthKeys.map((k) => (monthlyMap[k].present / monthlyMap[k].total) * 100);
  const monthLabels = monthKeys.map((k) => {
    const [y, m] = k.split("-");
    return `${MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3)} ${y.slice(2)}`;
  });

  const slope = linearSlope(monthlySeries);
  const trendLabel = slope > 0.5 ? "Improving" : slope < -0.5 ? "Declining" : "Stable";

  const dayMap = {};
  log.forEach((e) => {
    const dow = e.dateObj.toLocaleDateString("en-US", { weekday: "long" });
    if (!dayMap[dow]) dayMap[dow] = { present: 0, total: 0 };
    dayMap[dow].total++;
    if (e.status === "Present") dayMap[dow].present++;
  });
  const dayPattern = {};
  DAY_ORDER.forEach((d) => { if (dayMap[d]) dayPattern[d] = (dayMap[d].present / dayMap[d].total) * 100; });

  let worstDay = null, worstVal = 101;
  Object.entries(dayPattern).forEach(([d, v]) => { if (v < worstVal) { worstVal = v; worstDay = d; } });

  // Every day of the week the student is falling below the required
  // threshold on — not just the single worst one — so the recommendation
  // can call out "Thursdays and Saturdays" instead of picking only one.
  // Only counts a day once it has 2+ classes logged, to avoid flagging a
  // day off a single fluke absence.
  const riskyDays = Object.entries(dayPattern)
    .filter(([d, v]) => v < thresholdPct && dayMap[d].total >= 2)
    .sort((a, b) => a[1] - b[1])
    .map(([d]) => d);
  const bunkDays = riskyDays.length ? riskyDays.slice(0, 3) : (worstDay ? [worstDay] : []);

  const projected = projectNext(monthlySeries);
  const { bunks, needed } = safeBunksCalc(attended, total, thresholdPct / 100);
  const score = riskScoreCalc(pct, slope, thresholdPct);
  let level = classifyRiskCalc(score);
  if (needed > 0 && level === "Safe") level = "Moderate"; // below the requirement can never be "Safe"
  const message = buildMessageCalc(subject, pct, level, bunks, needed, trendLabel, bunkDays, projected, thresholdPct);

  return {
    subject, total, attended, absent: total - attended, pct,
    monthlySeries, monthLabels, slope, trendLabel,
    dayPattern, worstDay, bunkDays, projected, bunks, needed, score, level,
    message,
  };
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

const GAUGE_COLORS = { safe: "#3E7A5B", moderate: "#C1791E", risk: "#A9432C", neutral: "#85907F" };

function drawGauge(score, cls) {
  // score: 0 (safe) -> 100 (high risk). Needle sweeps 0deg..180deg across the dial.
  const cx = 120, cy = 125, r = 92;
  const needleAngle = (score / 100) * 180;

  const zones = [
    { from: 0, to: 35, color: GAUGE_COLORS.safe },
    { from: 35, to: 65, color: GAUGE_COLORS.moderate },
    { from: 65, to: 100, color: GAUGE_COLORS.risk },
  ];

  let arcs = zones
    .map((z) => {
      const a1 = (z.from / 100) * 180;
      const a2 = (z.to / 100) * 180;
      return `<path d="${describeArc(cx, cy, r, a1, a2)}" stroke="${z.color}" stroke-width="16" fill="none" stroke-linecap="butt" opacity="0.85"/>`;
    })
    .join("");

  const needleTip = polarToCartesian(cx, cy, r - 22, needleAngle);
  const needleColor = GAUGE_COLORS[cls];

  const svg = `
    ${arcs}
    <circle cx="${cx}" cy="${cy}" r="6" fill="${needleColor}" />
    <line x1="${cx}" y1="${cy}" x2="${needleTip.x}" y2="${needleTip.y}"
          stroke="${needleColor}" stroke-width="4" stroke-linecap="round" />
    <text x="${cx - r + 4}" y="${cy + 22}" font-size="10" fill="#85907F" font-family="IBM Plex Mono, monospace">SAFE</text>
    <text x="${cx + r - 34}" y="${cy + 22}" font-size="10" fill="#85907F" font-family="IBM Plex Mono, monospace">RISK</text>
  `;
  $("gaugeSvg").innerHTML = svg;
}

/* ---------------------------------------------------------------------- */
/* Chart.js: monthly trend + day-of-week pattern                          */
/* ---------------------------------------------------------------------- */

function drawTrendChart(monthlySeries, monthLabels) {
  const ctx = $("trendChart");
  if (state.trendChart) state.trendChart.destroy();
  state.trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: monthLabels,
      datasets: [
        {
          label: "Attendance %",
          data: monthlySeries,
          borderColor: "#16302B",
          backgroundColor: "rgba(22,48,43,0.08)",
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: "#16302B",
          fill: true,
          tension: 0.3,
        },
        {
          label: "Required",
          data: monthlySeries.map(() => parseFloat($("thresholdSelect").value) * 100),
          borderColor: "#A9432C",
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { min: 0, max: 100, ticks: { callback: (v) => v + "%" } },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

function drawDayChart(dayPattern) {
  const ctx = $("dayChart");
  const labels = Object.keys(dayPattern);
  const values = Object.values(dayPattern);
  if (state.dayChart) state.dayChart.destroy();
  state.dayChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Attendance %",
          data: values,
          backgroundColor: values.map((v) => (v < 70 ? "#A9432C" : v < 85 ? "#C1791E" : "#3E7A5B")),
          borderRadius: 4,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { min: 0, max: 100, ticks: { callback: (v) => v + "%" } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

/* ---------------------------------------------------------------------- */
/* Register calendar: cross-month date-range picker, click-to-mark        */
/* ---------------------------------------------------------------------- */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Wire the two native date-range inputs. Defaults are set separately, once
 *  the register's data is loaded (see setDefaultCalendarRange). */
function initCalendarControls() {
  ["calFromDate", "calToDate"].forEach((id) => {
    $(id).addEventListener("change", onCalControlChange);
  });
}

/** Default the range to the full span of whatever data is loaded (earliest
 *  to latest logged date, across every subject) so the dashboard opens
 *  showing complete totals instead of an arbitrary "this month" window that
 *  might not overlap the data at all. Runs once, right after data loads. */
function setDefaultCalendarRange() {
  let min = null, max = null;
  Object.values(state.calendar.backendDateBoundsBySubject).forEach((b) => {
    if (!min || b.min < min) min = b.min;
    if (!max || b.max > max) max = b.max;
  });
  if (!min || !max) return;

  state.calendar.fromDate = min;
  state.calendar.toDate = max;
  $("calFromDate").value = min;
  $("calToDate").value = max;
}

function onCalControlChange() {
  let from = $("calFromDate").value;
  let to = $("calToDate").value;
  if (!from || !to) return;
  if (from > to) [from, to] = [to, from]; // ISO date strings sort correctly, so swap if reversed

  state.calendar.fromDate = from;
  state.calendar.toDate = to;
  $("calFromDate").value = from;
  $("calToDate").value = to;

  // Every stat — gauge, percentages, trend, sidebar, summary — is scoped to
  // this range, so a range change needs a full recompute, not just a redraw.
  renderAll();
}

/** Fetch a subject's real Present/Absent history once, but only to learn the
 *  earliest/latest logged dates (for sizing the default range) — the actual
 *  daily statuses are intentionally NOT kept. Every subject starts fully
 *  blank so the student ticks their own attendance day by day, and every
 *  stat (gauge, %, trend, sidebar, summary) is built purely from those
 *  clicks via buildEffectiveLog / userMarksBySubject. */
async function ensureCalendarLogLoaded(subject) {
  if (state.calendar.backendLogBySubject[subject]) return;
  state.calendar.backendLogBySubject[subject] = {}; // always blank, on purpose
  try {
    const cal = await loadCalendar(subject);
    const dates = cal.log.map((entry) => entry.date).sort();
    if (dates.length) {
      state.calendar.backendDateBoundsBySubject[subject] = { min: dates[0], max: dates[dates.length - 1] };
    }
  } catch {
    // No history available for this subject — the range picker will just
    // fall back to whatever other subjects contribute, or stay unset.
  }
}

/** Render every month spanned by the selected date range as its own
 *  Monday-first block, stacked in a scrollable column. Cells outside the
 *  chosen range are faded and non-interactive; cells inside it cycle
 *  present -> absent -> holiday -> unmarked on click. Holiday days are
 *  visually distinct (striped) and excluded from attendance math. */
function renderCalendarRange() {
  const subject = state.selectedSubject;
  if (!subject) return;

  const { fromDate, toDate } = state.calendar;
  if (!fromDate || !toDate) return;

  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  const todayStr = toISODate(new Date());

  const totalDays = Math.round((to - from) / 86400000) + 1;
  $("calRangeDays").textContent = `${totalDays} day${totalDays !== 1 ? "s" : ""}`;

  const backendLog = state.calendar.backendLogBySubject[subject] || {};
  const userMarks = state.calendar.userMarksBySubject[subject]
    || (state.calendar.userMarksBySubject[subject] = {});

  // Every {year, month} spanned by the range, in order.
  const months = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const lastMonth = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor <= lastMonth) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  const scroll = $("calendarScroll");
  scroll.innerHTML = "";

  let presentCount = 0, absentCount = 0, holidayCount = 0;

  months.forEach(({ year, month }) => {
    const block = document.createElement("div");
    block.className = "cal-month-block";

    const title = document.createElement("div");
    title.className = "cal-month-title";
    title.textContent = `${MONTH_NAMES[month]} ${year}`;
    block.appendChild(title);

    const weekdaysRow = document.createElement("div");
    weekdaysRow.className = "cal-weekdays";
    weekdaysRow.innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      .map((d) => `<span>${d}</span>`).join("");
    block.appendChild(weekdaysRow);

    const grid = document.createElement("div");
    grid.className = "calendar-month-grid";

    const totalInMonth = daysInMonth(year, month);
    const firstWeekdaySun0 = new Date(year, month, 1).getDay(); // 0 = Sunday
    const mondayFirstOffset = (firstWeekdaySun0 + 6) % 7;       // 0 = Monday

    for (let i = 0; i < mondayFirstOffset; i++) {
      const pad = document.createElement("div");
      pad.className = "cal-cell pad";
      grid.appendChild(pad);
    }

    for (let day = 1; day <= totalInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const inRange = dateStr >= fromDate && dateStr <= toDate;

      const cell = document.createElement("div");

      if (!inRange) {
        // Outside the selected range: always neutral, blurred and unmarked.
        // Deliberately never look up userMarks/backendLog here — a date
        // outside the range must never show a status color, even if the
        // backend has real attendance data logged for it.
        cell.className = "cal-cell out-of-range";
        cell.textContent = day;
        cell.title = `${dateStr} — outside selected range`;
        grid.appendChild(cell);
        continue;
      }

      const status = userMarks[dateStr] || (backendLog[dateStr] ? backendLog[dateStr].toLowerCase() : null);
      if (status === "present") presentCount++;
      else if (status === "absent") absentCount++;
      else if (status === "holiday") holidayCount++;

      cell.className = "cal-cell in-range" + (status ? ` ${status}` : "");
      if (dateStr === todayStr) cell.classList.add("today");
      cell.innerHTML = status
        ? `<span class="stamp"><span class="daynum">${day}</span></span>`
        : `<span class="daynum">${day}</span>`;
      cell.title = status
        ? `${dateStr} — ${status[0].toUpperCase()}${status.slice(1)}`
        : `${dateStr} — unmarked`;

      cell.addEventListener("click", () => {
        const current = userMarks[dateStr] || (backendLog[dateStr] ? backendLog[dateStr].toLowerCase() : null);
        let next;
        if (current === "present") next = "absent";
        else if (current === "absent") next = "holiday";
        else if (current === "holiday") next = null;
        else next = "present";
        if (next) userMarks[dateStr] = next; else delete userMarks[dateStr];
        renderAll(); // recompute + redraw everything: gauge, stats, charts, sidebar, summary
      });

      grid.appendChild(cell);
    }

    block.appendChild(grid);
    scroll.appendChild(block);
  });

  $("calTallyNote").textContent =
    `In range: ${presentCount} present · ${absentCount} absent · ${holidayCount} holiday`;
}

initCalendarControls();

/* ---------------------------------------------------------------------- */
/* Sample data loader (button)                                            */
/*                                                                        */
/* Fills every subject's calendar with a realistic, varied attendance     */
/* pattern across a fixed demo range (1 Jan 2025 – 1 May 2025) so the     */
/* dashboard doesn't open at a flat 0%. This writes into                  */
/* userMarksBySubject exactly like a manual click does, so every date     */
/* stays individually editable afterwards — clicking a cell still cycles  */
/* present -> absent -> holiday -> unmarked as normal.                    */
/* ---------------------------------------------------------------------- */

const SAMPLE_DATA_FROM = "2025-01-01";
const SAMPLE_DATA_TO = "2025-05-01";

// Three distinct attendance profiles, cycled across whatever subjects are
// loaded. Each tells a different story on the dashboard.
const SAMPLE_PROFILES = {
  1: [75, 68, 80, 40, 55, 90, 62, 85], // mixed risk — a bit of everything
  2: [92, 88, 96, 78, 85, 90, 82, 95], // mostly strong / safe
  3: [45, 38, 55, 30, 60, 42, 50, 35], // mostly at-risk / needs attention
};

/** All Mon–Fri dates (inclusive) between two "YYYY-MM-DD" strings. */
function weekdayDatesInRange(fromStr, toStr) {
  const dates = [];
  const d = new Date(`${fromStr}T00:00:00`);
  const end = new Date(`${toStr}T00:00:00`);
  while (d <= end) {
    const dow = d.getDay(); // 0 = Sunday, 6 = Saturday
    if (dow !== 0 && dow !== 6) dates.push(toISODate(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/** Evenly spread `presentCount` "true" flags across `n` slots (no long
 *  clumps at the start/end — looks like a real, scattered register). */
function distributePresentFlags(n, presentCount) {
  const flags = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const cumBefore = Math.floor((i * presentCount) / n);
    const cumAfter = Math.floor(((i + 1) * presentCount) / n);
    flags[i] = cumAfter > cumBefore;
  }
  return flags;
}

function loadSampleAttendanceData(sampleId = "1") {
  if (!state.analysis || !state.analysis.subjects.length) {
    toast("Data isn't loaded yet — try again in a moment.", true);
    return;
  }

  const targetPcts = SAMPLE_PROFILES[sampleId] || SAMPLE_PROFILES["1"];
  const dates = weekdayDatesInRange(SAMPLE_DATA_FROM, SAMPLE_DATA_TO);

  state.analysis.subjects.forEach((s, idx) => {
    const targetPct = targetPcts[idx % targetPcts.length];
    const presentCount = Math.round((targetPct / 100) * dates.length);
    const presentFlags = distributePresentFlags(dates.length, presentCount);

    const marks = {};
    dates.forEach((dateStr, i) => { marks[dateStr] = presentFlags[i] ? "present" : "absent"; });
    state.calendar.userMarksBySubject[s.subject] = marks;
  });

  state.calendar.fromDate = SAMPLE_DATA_FROM;
  state.calendar.toDate = SAMPLE_DATA_TO;
  $("calFromDate").value = SAMPLE_DATA_FROM;
  $("calToDate").value = SAMPLE_DATA_TO;

  renderAll();
  toast(`Sample ${sampleId} attendance loaded — click any date to edit it.`);
}

/* ---------------------------------------------------------------------- */
/* Students: pick a student, each one keeps their own full register        */
/*                                                                        */
/* Every student has their own calendar marks + date range. Switching      */
/* student swaps which register the whole dashboard reads from, so the     */
/* gauge, charts, recommendation and calendar all show that student's      */
/* pattern. After every change, the student's overall attendance % is      */
/* saved to localStorage — email.html reads it, so both pages stay in sync.*/
/* ---------------------------------------------------------------------- */

// Per-subject offsets around a student's starting %, so a seeded register
// looks varied (some subjects strong, some weak) but averages to that %.
const SEED_OFFSETS = [0, 8, -8, 12, -12, 4, -4, 0];

function clampPct(v) { return Math.max(5, Math.min(98, v)); }

/** Build a first-time register for a student whose overall attendance
 *  starts near `basePct` (their roster value). */
function seedMarksForStudent(basePct) {
  const dates = weekdayDatesInRange(SAMPLE_DATA_FROM, SAMPLE_DATA_TO);
  const subjects = state.analysis.subjects;
  const k = subjects.length;

  // Per-subject present counts from the offsets...
  const counts = subjects.map((_, idx) => {
    const target = clampPct(basePct + SEED_OFFSETS[idx % SEED_OFFSETS.length]);
    return Math.round((target / 100) * dates.length);
  });
  // ...then nudge them so the OVERALL attendance lands exactly on basePct.
  const wantTotal = Math.round((basePct / 100) * dates.length * k);
  let diff = wantTotal - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0 && i < 10000; i++) {
    const j = i % k;
    const step = diff > 0 ? 1 : -1;
    if (counts[j] + step >= 0 && counts[j] + step <= dates.length) { counts[j] += step; diff -= step; }
  }

  const marks = {};
  subjects.forEach((s, idx) => {
    const flags = distributePresentFlags(dates.length, counts[idx]);
    marks[s.subject] = {};
    dates.forEach((d, i) => { marks[s.subject][d] = flags[i] ? "present" : "absent"; });
  });
  return marks;
}

function initStudents() {
  state.students = alRead(AL_KEYS.students, {});

  const fromUrl = new URLSearchParams(location.search).get("student");
  const saved = localStorage.getItem(AL_KEYS.current);
  const wanted = [fromUrl, saved].find((n) => n && ROSTER.some((r) => r.name === n));
  activateStudent(wanted || ROSTER[0].name, { render: false });
  renderStudentMenu();
}

function activateStudent(name, { render = true } = {}) {
  // Remember the range of the student we're leaving.
  if (state.currentStudent && state.students[state.currentStudent]) {
    state.students[state.currentStudent].fromDate = state.calendar.fromDate;
    state.students[state.currentStudent].toDate = state.calendar.toDate;
  }

  let rec = state.students[name];
  if (!rec) {
    const base = ROSTER.find((r) => r.name === name).pct;
    rec = { marks: seedMarksForStudent(base), fromDate: SAMPLE_DATA_FROM, toDate: SAMPLE_DATA_TO };
    state.students[name] = rec;
  }

  state.currentStudent = name;
  state.calendar.userMarksBySubject = rec.marks;
  state.calendar.fromDate = rec.fromDate || SAMPLE_DATA_FROM;
  state.calendar.toDate = rec.toDate || SAMPLE_DATA_TO;
  $("calFromDate").value = state.calendar.fromDate;
  $("calToDate").value = state.calendar.toDate;
  $("studentBtnName").textContent = name;
  try { localStorage.setItem(AL_KEYS.current, name); } catch { /* ignore */ }

  if (render) renderAll();
}

/** Save the current student's register + live overall %, for the email page. */
function persistStudent(liveMap) {
  const name = state.currentStudent;
  if (!name) return;

  const rec = state.students[name];
  rec.fromDate = state.calendar.fromDate;
  rec.toDate = state.calendar.toDate;
  alWrite(AL_KEYS.students, state.students);

  const all = Object.values(liveMap);
  const total = all.reduce((sum, s) => sum + s.total, 0);
  const attended = all.reduce((sum, s) => sum + s.attended, 0);
  if (total > 0) {
    const live = alRead(AL_KEYS.pct, {});
    live[name] = Math.round((attended / total) * 1000) / 10; // 1 decimal
    alWrite(AL_KEYS.pct, live);
  }
  renderStudentMenu();
}

function renderStudentMenu() {
  const live = alRead(AL_KEYS.pct, {});
  $("studentMenu").innerHTML = ROSTER.map((r) => {
    const pct = typeof live[r.name] === "number" ? live[r.name] : r.pct;
    const active = r.name === state.currentStudent ? " active" : "";
    return `<button class="dropdown-item${active}" data-student="${escapeHtml(r.name)}">
      ${escapeHtml(r.name)} <span class="dropdown-item-hint">${formatPct(pct)}</span>
    </button>`;
  }).join("");
}

$("studentBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = $("studentMenu");
  const open = !menu.classList.contains("hidden");
  menu.classList.toggle("hidden", open);
  $("studentBtn").setAttribute("aria-expanded", String(!open));
});

$("studentMenu").addEventListener("click", (e) => {
  const item = e.target.closest(".dropdown-item");
  if (!item) return;
  $("studentMenu").classList.add("hidden");
  $("studentBtn").setAttribute("aria-expanded", "false");
  if (item.dataset.student !== state.currentStudent) {
    activateStudent(item.dataset.student);
    toast(`Showing ${item.dataset.student}'s attendance.`);
  }
});

document.addEventListener("click", (e) => {
  if (!$("studentDropdown").contains(e.target)) {
    $("studentMenu").classList.add("hidden");
    $("studentBtn").setAttribute("aria-expanded", "false");
  }
});

/* ---------------------------------------------------------------------- */
/* Toast                                                                  */
/* ---------------------------------------------------------------------- */

let toastTimer;
function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = "toast" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
}
