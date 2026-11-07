/* ==========================================================================
   email.js
   Standalone page: pick which students get a low-attendance reminder.

   Sends REAL emails: clicking "Send reminder emails" POSTs the selected
   recipients to the FastAPI backend's /api/send-reminders endpoint, which
   delivers them via Gmail SMTP (see backend/email_service.py). The backend
   must be running (uvicorn app:app --port 8000) and backend/.env must have
   GMAIL_ADDRESS + GMAIL_APP_PASSWORD set — see backend/.env.example.
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const API_BASE = "http://127.0.0.1:8000";

// The student list + live attendance % come from roster.js. The dashboard
// (index.html) saves each student's real percentage whenever you change
// their register, and this page picks it up automatically.
let ROSTER_LIVE = getLiveRoster();
const checkedByName = {};   // name -> checked? (keeps your manual ticks across refreshes)
const lastPctByName = {};   // name -> pct at last render (to detect crossing 75%)

function pctClass(pct) {
  if (pct >= 80) return "safe";
  if (pct >= 65) return "moderate";
  return "risk";
}

function renderRoster() {
  ROSTER_LIVE = getLiveRoster();

  // Default tick = below 75%. Keep the person's own ticks, unless the
  // student just crossed the 75% line (then the default applies again).
  ROSTER_LIVE.forEach((s) => {
    const crossed = lastPctByName[s.name] !== undefined &&
      (lastPctByName[s.name] < 75) !== (s.pct < 75);
    if (checkedByName[s.name] === undefined || crossed) checkedByName[s.name] = s.pct < 75;
    lastPctByName[s.name] = s.pct;
  });

  const body = $("rosterBody");
  body.innerHTML = ROSTER_LIVE.map((s, i) => `
    <tr data-idx="${i}">
      <td class="col-check"><input type="checkbox" class="rowChk" data-idx="${i}" ${checkedByName[s.name] ? "checked" : ""} /></td>
      <td class="col-sr">${i + 1}</td>
      <td><a class="roster-link" href="index.html?student=${encodeURIComponent(s.name)}" title="Open ${s.name}'s dashboard">${s.name}</a></td>
      <td>${s.enrollment}</td>
      <td>${s.email}</td>
      <td><span class="roster-pct ${pctClass(s.pct)}">${formatPct(s.pct)}</span></td>
      <td class="col-check"></td>
    </tr>
  `).join("");

  body.querySelectorAll(".rowChk").forEach((chk) => {
    const name = ROSTER_LIVE[parseInt(chk.dataset.idx, 10)].name;
    chk.addEventListener("change", () => {
      checkedByName[name] = chk.checked;
      chk.closest("tr").classList.toggle("selected-row", chk.checked);
      updateSelectionState();
    });
    chk.closest("tr").classList.toggle("selected-row", chk.checked);
  });

  updateSelectionState();
}

function getCheckboxes() {
  return Array.from(document.querySelectorAll(".rowChk"));
}

function updateSelectionState() {
  const boxes = getCheckboxes();
  const checked = boxes.filter((c) => c.checked);
  $("selectedCount").textContent = `${checked.length} selected`;
  $("sendEmailBtn").disabled = checked.length === 0;
  $("selectAllChk").checked = checked.length === boxes.length && boxes.length > 0;
  $("selectAllChk").indeterminate = checked.length > 0 && checked.length < boxes.length;
}

$("selectAllChk").addEventListener("change", (e) => {
  getCheckboxes().forEach((chk) => {
    chk.checked = e.target.checked;
    checkedByName[ROSTER_LIVE[parseInt(chk.dataset.idx, 10)].name] = chk.checked;
    chk.closest("tr").classList.toggle("selected-row", chk.checked);
  });
  updateSelectionState();
});

$("sendEmailBtn").addEventListener("click", sendEmails);

async function sendEmails() {
  const selected = getCheckboxes()
    .filter((c) => c.checked)
    .map((c) => ROSTER_LIVE[parseInt(c.dataset.idx, 10)]);

  if (!selected.length) return;

  const subject = $("emailSubject").value || "Low attendance notice";
  const sendBtn = $("sendEmailBtn");
  const originalLabel = sendBtn.textContent;
  sendBtn.disabled = true;
  sendBtn.textContent = "Sending...";

  try {
    const res = await fetch(`${API_BASE}/api/send-reminders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject,
        recipients: selected.map((s) => ({
          name: s.name,
          email: s.email,
          enrollment: s.enrollment,
          pct: s.pct,
        })),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Failed to send emails.");
    }

    const sentCount = data.sent.length;
    const failedCount = data.failed.length;

    if (failedCount === 0) {
      toast(`Sent ${sentCount} email${sentCount !== 1 ? "s" : ""} successfully.`);
    } else {
      toast(
        `Sent ${sentCount}, failed ${failedCount}. Check browser console for details.`,
        true
      );
      console.error("Failed recipients:", data.failed);
    }
  } catch (err) {
    toast(`Error: ${err.message} (is the backend running on ${API_BASE}?)`, true);
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = originalLabel;
    updateSelectionState();
  }
}

let toastTimer;
function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = "toast" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 4200);
}

// Live sync: another tab (the dashboard) changed a student's attendance.
window.addEventListener("storage", (e) => {
  if (e.key === AL_KEYS.pct) renderRoster();
});
// Coming back via the browser's Back button restores a cached page — refresh it.
window.addEventListener("pageshow", (e) => { if (e.persisted) renderRoster(); });

renderRoster();
