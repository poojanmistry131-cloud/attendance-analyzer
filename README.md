# 📊 Attendance Ledger

An **Attendance Pattern Analyzer & Bunk-Risk Recommender** built with **Python (FastAPI)** and plain **HTML / CSS / JavaScript**. Mark or upload attendance, see how many classes you can safely skip, get risk warnings per subject, and email students whose attendance has fallen too low!

## How to Run (For Beginners)

### Before you start

Install these on your computer:

1. **Python 3.8 or higher** from https://www.python.org/downloads/
   - Run the installer and **tick the box "Add Python to PATH"** at the bottom of the first screen.
   - Click "Install Now".
2. **VS Code** from https://code.visualstudio.com/
3. A web browser (Chrome, Edge, Firefox).

To check that Python is installed, open Command Prompt and type `python --version`. You should see a version number.

### Steps

1. Open this repository page on GitHub.
2. Click the green **Code** button, then click **Download ZIP**.
3. Open your Downloads folder. You will find a file named `attendance-analyzer-student-sync.zip`.
4. Right-click on the zip file and click **Extract All**.
5. Move the extracted folder to your **C: drive** (or Desktop).
6. Open **VS Code**.
7. Press `Ctrl + Shift + E` to open the Explorer panel.
8. Click **Open Folder**.
9. Select the extracted folder `attendance-analyzer-student-sync` and click **Select Folder**.
10. Install the **Live Server** extension in VS Code (press `Ctrl + Shift + X`, search "Live Server", click Install).
11. Open the terminal in VS Code by pressing `` Ctrl + ` `` (the backtick key, just below the Esc key).
12. Go into the backend folder by typing:

    cd attendance-analyzer\backend

    Make sure you can see the files `app.py` and `requirements.txt` in this folder.

13. Install the required libraries by typing:

    pip install -r requirements.txt

14. Start the backend server by typing:

    uvicorn app:app --reload --port 8000

    You should see `Uvicorn running on http://127.0.0.1:8000`. **Keep this terminal open!**

15. In VS Code Explorer, open `attendance-analyzer/frontend/index.html`, right-click it and choose **Open with Live Server**.
16. The dashboard opens in your browser. Enjoy the app! 🎉

### Common problems

- **'python' is not recognized** → Python is not added to PATH. Reinstall Python and tick "Add Python to PATH".
- **'pip' is not recognized** → Try `python -m pip install -r requirements.txt`.
- **'uvicorn' is not recognized** → Try `python -m uvicorn app:app --reload --port 8000`.
- **No such file or directory: requirements.txt** → You are in the wrong folder. Use the `cd` command (step 12) until you see `app.py` in the folder.
- **Dashboard shows "Couldn't load the register"** → The backend is not running. Start it again (step 14) and click **Retry**.

## Features

- Per-subject attendance percentage, attended / total classes and trend (Improving / Declining / Stable)
- **Bunk-risk recommender** – tells you how many classes you can still skip safely, or how many you must attend to recover
- Risk score (0–100) with levels: **Safe**, **Moderate**, **High Risk**
- 4-week attendance projection using a linear trend model
- Hand-built SVG **"bunk fuel gauge"** for each subject
- Monthly trend chart and day-of-week pattern chart (Chart.js)
- Register-style present / absent **attendance calendar** with a custom date range
- Per-student registers for the whole class (switch students from the top bar)
- Three built-in sample datasets (mixed risk, mostly strong, mostly at-risk)
- Upload your own attendance **CSV file**
- Adjustable required-attendance threshold (65% – 85%)
- **Email page** – select low-attendance students and send real reminder emails through Gmail

## Requirements

- Python 3.8 or higher
- FastAPI, Uvicorn, pandas, numpy, python-multipart, python-dotenv (all installed from `requirements.txt`)
- A modern web browser
- (Optional) A Gmail account with an App Password, only for the email feature

## How to Run (which use github in daily bases)

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/<your-repo-name>.git
cd <your-repo-name>/attendance-analyzer/backend
```

### 2. (Optional) Create a virtual environment

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS / Linux
python3 -m venv venv
source venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Run the backend (port 8000)

```bash
uvicorn app:app --reload --port 8000
```

Visit `http://127.0.0.1:8000/docs` for the interactive Swagger UI to try the API directly.

### 5. Run the frontend (new terminal)

The frontend is plain HTML/CSS/JS – no build step, no `npm install`.

**Option A – VS Code Live Server (recommended):** right-click `frontend/index.html` → **Open with Live Server**.

**Option B – Python's built-in server:**

```bash
cd attendance-analyzer/frontend
python -m http.server 5500
```

Then open `http://127.0.0.1:5500` in your browser.

On macOS / Linux, use `python3` if `python` does not work.

## How to Use

1. Open the dashboard in your browser.
2. Pick a student from the **Select student** dropdown in the top bar.
3. Click **Load sample data** and choose Sample 1, 2 or 3 – or upload your own CSV with these columns:

   ```csv
   Date,Subject,Status
   2026-01-05,Data Structures,Present
   2026-01-06,Data Structures,Absent
   ```

4. Choose the required attendance (65% – 85%) from the threshold dropdown. Every recommendation recalculates.
5. Click a subject in the sidebar (riskiest first) to see its gauge, charts, recommendation and attendance calendar.
6. Change the **From / To** dates or tick present / absent days in the calendar – the percentage updates live.
7. Click **Email** in the top bar to open the reminder page.

## Sending Reminder Emails (Optional)

The email feature sends real emails through Gmail, so it needs a one-time setup:

1. Turn on **2-Step Verification** on your Gmail account: https://myaccount.google.com/security
2. Create an **App Password** (Google Account → Security → 2-Step Verification → App passwords). Google gives you a 16-character password.
3. In the `backend` folder, copy `.env.example` to a new file named `.env` and fill it in:

   ```env
   GMAIL_ADDRESS=youraddress@gmail.com
   GMAIL_APP_PASSWORD=your16charapppassword
   ```

4. Restart the backend (`uvicorn app:app --reload --port 8000`).
5. Open the **Email** page, tick the students you want to notify (students below 75% are ticked automatically), edit the subject if you like and click **Send reminder emails**.

> ⚠️ **Never upload your `.env` file to GitHub.** It contains your Gmail App Password. Keep it only on your own computer.

## Project Structure

```
attendance-analyzer-student-sync/
├── README.md
└── attendance-analyzer/
    ├── backend/
    │   ├── app.py              # FastAPI app with all API routes
    │   ├── data_processor.py   # Analysis + data science (pandas, numpy)
    │   ├── recommender.py      # Bunk-risk recommendation engine
    │   ├── email_service.py    # Gmail SMTP reminder emails
    │   ├── models.py           # Pydantic schemas
    │   ├── sample_data.csv     # Sample attendance dataset
    │   ├── .env.example        # Template for Gmail settings
    │   └── requirements.txt
    └── frontend/
        ├── index.html          # Dashboard
        ├── email.html          # Email reminder page
        ├── style.css           # Ledger / gradebook theme
        ├── script.js           # Dashboard logic, gauge, charts, calendar
        ├── email.js            # Email page logic
        └── roster.js           # Student list shared by both pages
```

## How It Works

```
CSV upload / sample data
        │
        ▼
data_processor.py  ──►  per-subject stats, weekly trend slope, worst day
        │
        ▼
recommender.py     ──►  risk score, safe-bunk count, 4-week projection,
        │                plain-language recommendation
        ▼
app.py (FastAPI)   ──►  JSON over REST
        │
        ▼
frontend (HTML/CSS/JS) ──► gauge, charts, calendar, recommendation card
```

**Safe-bunk formula:** with `attended` classes out of `total`, you can skip `attended / threshold − total` more classes (rounded down) and still stay above the threshold.

**Risk levels:** score below 35 = Safe, below 65 = Moderate, otherwise High Risk.

## API Reference

| Method | Route                                 | Purpose                                         |
| ------ | ------------------------------------- | ----------------------------------------------- |
| GET    | `/api/health`                         | Liveness check                                  |
| GET    | `/api/sample`                         | Load the bundled sample dataset                 |
| POST   | `/api/upload`                         | Upload a CSV (`multipart/form-data`, field `file`) |
| GET    | `/api/analysis`                       | Per-subject stats + overall summary             |
| GET    | `/api/recommendations?threshold=0.75` | Bunk-risk recommendations per subject           |
| GET    | `/api/calendar/{subject}`             | Daily present / absent log for one subject      |
| POST   | `/api/send-reminders`                 | Email low-attendance students via Gmail         |

## Customization

| Where                         | What to change                                              |
| ----------------------------- | ----------------------------------------------------------- |
| `frontend/roster.js` → `ROSTER` | Student names, enrollment numbers, emails, starting %     |
| `frontend/roster.js` → `ALERT_EMAIL` | The email address that receives the reminders        |
| `frontend/script.js` → `API_BASE` | Backend address (default `http://127.0.0.1:8000`)       |
| `frontend/email.js` → `API_BASE`  | Same as above, for the email page                       |
| `frontend/script.js` → `SAMPLE_DATA_FROM / TO` | Default date range of the sample data      |
| `backend/sample_data.csv`     | Replace with your own attendance data                       |

## Troubleshooting

- **`ModuleNotFoundError: No module named 'fastapi'`** → run `pip install -r requirements.txt` (inside the `backend` folder).
- **`pip` not found** → try `python -m pip install -r requirements.txt`.
- **Dashboard cannot load data** → make sure the backend is running on port 8000 and `API_BASE` in `script.js` matches it.
- **"Gmail is not configured"** → create `backend/.env` with `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD`, then restart the backend.
- **"Gmail login failed"** → use the 16-character **App Password**, not your normal Gmail password.
- **Email page shows old percentages** → open the dashboard and the email page from the same address (for example both on `127.0.0.1:5500`), because they share data through the browser's localStorage.

## Future Ideas

- Store all students' registers in a database (SQLite / PostgreSQL) instead of memory
- Add login so each student sees only their own data
- Use a `scikit-learn` model to predict the chance of dropping below the threshold
- Add a "what-if" slider to test future attendance

## License

This project is open source. Feel free to use and modify it.
