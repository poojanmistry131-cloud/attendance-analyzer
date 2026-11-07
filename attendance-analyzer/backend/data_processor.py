"""
data_processor.py
------------------
The "Data Science" + "Analysis" layer of the project.

Responsibilities:
  1. Load & clean raw attendance records (Date, Subject, Status) into a tidy
     pandas DataFrame.
  2. Compute descriptive statistics per subject (attendance %, streaks).
  3. Compute a weekly time-series per subject and fit a linear trend
     (numpy.polyfit) to detect whether a student is improving or declining.
  4. Compute day-of-week attendance patterns (which day gets bunked most).

This module has zero FastAPI/HTTP concerns — it is pure pandas/numpy so it
can be unit tested or reused (e.g. in a notebook) independently of the API.
"""

import io
import numpy as np
import pandas as pd

DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def load_csv(file_bytes: bytes) -> pd.DataFrame:
    """Parse raw CSV bytes into a cleaned, typed DataFrame."""
    df = pd.read_csv(io.BytesIO(file_bytes))
    return _clean(df)


def load_csv_path(path: str) -> pd.DataFrame:
    """Convenience loader used for the bundled sample dataset."""
    df = pd.read_csv(path)
    return _clean(df)


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    required = {"Date", "Subject", "Status"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV is missing required columns: {missing}")

    df = df.copy()
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date"])
    df["Subject"] = df["Subject"].astype(str).str.strip()
    df["Status"] = df["Status"].astype(str).str.strip().str.capitalize()
    df = df[df["Status"].isin(["Present", "Absent"])]
    df["Present"] = (df["Status"] == "Present").astype(int)
    df["Week"] = df["Date"].dt.isocalendar().year.astype(str) + "-W" + \
        df["Date"].dt.isocalendar().week.astype(str).str.zfill(2)
    df["DayOfWeek"] = df["Date"].dt.day_name()
    df = df.sort_values("Date")
    return df


def subject_overview(df: pd.DataFrame) -> list[dict]:
    """Per-subject descriptive stats + trend + weekly series + worst day."""
    results = []
    for subject, g in df.groupby("Subject"):
        total = len(g)
        attended = int(g["Present"].sum())
        absent = total - attended
        pct = round(100 * attended / total, 1) if total else 0.0

        weekly = g.groupby("Week")["Present"].mean().sort_index() * 100
        weekly_series = [round(v, 1) for v in weekly.tolist()]

        slope = _trend_slope(weekly_series)
        trend_label = "Improving" if slope > 0.5 else "Declining" if slope < -0.5 else "Stable"

        worst_day = _worst_day(g)

        results.append({
            "subject": subject,
            "total_classes": total,
            "attended": attended,
            "absent": absent,
            "attendance_pct": pct,
            "trend_slope": round(slope, 2),
            "trend_label": trend_label,
            "weekly_series": weekly_series,
            "worst_day": worst_day,
        })
    return sorted(results, key=lambda r: r["attendance_pct"])


def _trend_slope(weekly_series: list[float]) -> float:
    """Fit a straight line to weekly attendance % and return its slope.

    A positive slope means attendance is trending up week-over-week; a
    negative slope means it's trending down. This is the core "data
    science" signal used later to flag declining subjects early.
    """
    if len(weekly_series) < 2:
        return 0.0
    x = np.arange(len(weekly_series))
    y = np.array(weekly_series)
    slope, _ = np.polyfit(x, y, 1)
    return float(slope)


def _worst_day(g: pd.DataFrame) -> str | None:
    """Day of week with the lowest attendance rate for this subject
    (only considered if the subject has classes on 2+ distinct days)."""
    by_day = g.groupby("DayOfWeek")["Present"].mean()
    if by_day.empty:
        return None
    by_day = by_day.reindex([d for d in DAY_ORDER if d in by_day.index])
    return by_day.idxmin()


def overall_summary(df: pd.DataFrame, subjects: list[dict]) -> dict:
    total_classes = len(df)
    overall_pct = round(100 * df["Present"].mean(), 1) if total_classes else 0.0
    at_risk = sum(1 for s in subjects if s["attendance_pct"] < 75)
    best = max(subjects, key=lambda s: s["attendance_pct"])["subject"] if subjects else "-"
    worst = min(subjects, key=lambda s: s["attendance_pct"])["subject"] if subjects else "-"

    by_day = df.groupby("DayOfWeek")["Present"].mean() * 100
    by_day = by_day.reindex([d for d in DAY_ORDER if d in by_day.index])
    day_pattern = {k: round(v, 1) for k, v in by_day.to_dict().items()}

    return {
        "total_classes": total_classes,
        "overall_pct": overall_pct,
        "subjects_at_risk": at_risk,
        "best_subject": best,
        "worst_subject": worst,
        "day_pattern": day_pattern,
    }
