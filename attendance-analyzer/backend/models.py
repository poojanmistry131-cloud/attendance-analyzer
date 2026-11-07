"""
models.py
---------
Pydantic schemas that define the shape of data moving in and out of the API.
Keeping these separate from app.py keeps the route handlers readable.
"""

from pydantic import BaseModel
from typing import List, Optional, Dict


class SubjectStats(BaseModel):
    subject: str
    total_classes: int
    attended: int
    absent: int
    attendance_pct: float
    trend_slope: float           # % change per week (data-science: linear regression)
    trend_label: str             # "Improving" | "Declining" | "Stable"
    weekly_series: List[float]   # attendance % per week, for the chart
    worst_day: Optional[str]     # day of week with most bunks


class Recommendation(BaseModel):
    subject: str
    risk_level: str              # "Safe" | "Moderate" | "High Risk"
    risk_score: float            # 0-100, higher = riskier
    safe_bunks: int              # classes that can still be skipped safely
    classes_needed: int          # classes that MUST be attended to recover
    message: str                 # human-readable recommendation
    projected_pct_4wk: float     # projected attendance % 4 weeks from now


class OverallSummary(BaseModel):
    total_classes: int
    overall_pct: float
    subjects_at_risk: int
    best_subject: str
    worst_subject: str
    day_pattern: Dict[str, float]   # avg attendance % by day of week


class AnalysisResponse(BaseModel):
    summary: OverallSummary
    subjects: List[SubjectStats]


class RecommendationResponse(BaseModel):
    threshold: float
    recommendations: List[Recommendation]


class AttendanceRecord(BaseModel):
    Date: str
    Subject: str
    Status: str
