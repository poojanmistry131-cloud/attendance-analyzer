"""
app.py
------
FastAPI entry point for the Attendance Pattern Analyzer & Bunk-Risk
Recommender backend.

Endpoints:
    GET  /api/health                -> simple liveness check
    POST /api/upload                -> upload a CSV (Date, Subject, Status)
    GET  /api/sample                -> load the bundled synthetic dataset
    GET  /api/analysis              -> analysis (per-subject stats, trends)
    GET  /api/recommendations       -> bunk-risk recommendations
    GET  /api/calendar/{subject}    -> daily present/absent log for a
                                        subject (used for the heatmap)
    POST /api/send-reminders        -> actually email low-attendance
                                        students via Gmail SMTP

Run with:  uvicorn app:app --reload --port 8000
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import pandas as pd

import data_processor as dp
import recommender as rec
import email_service

app = FastAPI(
    title="Attendance Pattern Analyzer & Bunk-Risk Recommender",
    version="1.0.0",
)

# Allow the local static frontend (served on any localhost port) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for the currently loaded dataset (fine for a local mini-project;
# swap for a DB/session store if this ever needs multi-user support).
STATE: dict[str, pd.DataFrame] = {"df": None}

SAMPLE_PATH = "sample_data.csv"


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/upload")
async def upload_csv(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Please upload a .csv file with Date, Subject, Status columns.")
    content = await file.read()
    try:
        df = dp.load_csv(content)
    except Exception as e:
        raise HTTPException(400, f"Could not parse CSV: {e}")
    if df.empty:
        raise HTTPException(400, "No valid rows found. Check the Date/Subject/Status columns.")
    STATE["df"] = df
    return {"rows_loaded": len(df), "subjects": sorted(df["Subject"].unique().tolist())}


@app.get("/api/sample")
def load_sample():
    df = dp.load_csv_path(SAMPLE_PATH)
    STATE["df"] = df
    return {"rows_loaded": len(df), "subjects": sorted(df["Subject"].unique().tolist())}


def _require_df() -> pd.DataFrame:
    df = STATE["df"]
    if df is None:
        raise HTTPException(
            400,
            "No dataset loaded yet. Call /api/sample or POST a CSV to /api/upload first."
        )
    return df


@app.get("/api/analysis")
def analysis():
    df = _require_df()
    subjects = dp.subject_overview(df)
    summary = dp.overall_summary(df, subjects)
    return {"summary": summary, "subjects": subjects}


@app.get("/api/recommendations")
def recommendations(threshold: float = Query(0.75, ge=0.5, le=1.0)):
    df = _require_df()
    subjects = dp.subject_overview(df)
    recs = rec.recommend(subjects, threshold=threshold)
    return {"threshold": threshold, "recommendations": recs}


@app.get("/api/calendar/{subject}")
def calendar(subject: str):
    df = _require_df()
    g = df[df["Subject"] == subject]
    if g.empty:
        raise HTTPException(404, f"No records for subject '{subject}'")
    log = [
        {"date": d.strftime("%Y-%m-%d"), "status": s}
        for d, s in zip(g["Date"], g["Status"])
    ]
    return {"subject": subject, "log": log}


class ReminderRecipient(BaseModel):
    name: str
    email: str
    enrollment: Optional[str] = None
    pct: Optional[float] = None


class SendRemindersRequest(BaseModel):
    subject: str
    recipients: list[ReminderRecipient]


@app.post("/api/send-reminders")
def send_reminders(payload: SendRemindersRequest):
    if not payload.recipients:
        raise HTTPException(400, "No recipients provided.")
    try:
        result = email_service.send_reminder_emails(
            payload.subject,
            [r.model_dump() for r in payload.recipients],
        )
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
