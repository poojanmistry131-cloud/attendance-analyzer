"""
recommender.py
---------------
The "Recommendation System" layer of the project.

This is a hybrid recommender:
  - Rule/threshold-based: classic attendance-requirement math to work out
    exactly how many more classes can safely be missed (or must be attended)
    to stay above the institution's minimum attendance threshold.
  - Score-based ranking: blends current %, trend slope and volatility into
    a single 0-100 risk_score so subjects can be ranked/sorted, similar to
    how a content-based recommender blends multiple signals into one score.
  - Projection: a lightweight linear regression (numpy.polyfit) projects
    where attendance will land 4 weeks from now if current behaviour
    continues, and the message is tailored to that projection.

Kept separate from data_processor.py: data_processor answers "what is
happening?", recommender.py answers "what should the student do about it?".
"""

import numpy as np

DEFAULT_THRESHOLD = 0.75  # 75% is the typical minimum attendance requirement


def safe_bunks(attended: int, total: int, threshold: float = DEFAULT_THRESHOLD) -> tuple[int, int]:
    """Return (safe_bunks, classes_needed).

    safe_bunks: how many additional classes can be missed while the
    attendance percentage stays >= threshold, assuming no more classes are
    attended in between (worst case).
        attended / (total + x) >= threshold  =>  x <= attended/threshold - total

    classes_needed: if already below threshold, how many *consecutive*
    classes must be attended (with no further absences) to climb back to
    threshold.
        (attended + y) / (total + y) >= threshold
        => y >= (threshold*total - attended) / (1 - threshold)
    """
    if total == 0:
        return 0, 0

    max_total = attended / threshold
    bunks = int(np.floor(max_total - total))

    if bunks >= 0:
        return bunks, 0

    needed = (threshold * total - attended) / (1 - threshold)
    return 0, int(np.ceil(max(needed, 0)))


def project_attendance(weekly_series: list[float], weeks_ahead: int = 4) -> float:
    """Project attendance % `weeks_ahead` weeks into the future using a
    simple linear regression fit over the weekly history (numpy.polyfit).
    Clamped to [0, 100] since percentages can't leave that range."""
    if len(weekly_series) < 2:
        return weekly_series[-1] if weekly_series else 0.0
    x = np.arange(len(weekly_series))
    y = np.array(weekly_series)
    slope, intercept = np.polyfit(x, y, 1)
    projected = slope * (len(weekly_series) - 1 + weeks_ahead) + intercept
    return round(float(np.clip(projected, 0, 100)), 1)


def risk_score(pct: float, slope: float, threshold_pct: float = 75.0) -> float:
    """Blend current attendance % and trend slope into a single 0-100
    risk score (higher = riskier). This is the "ranking" signal a
    recommendation system uses to prioritise which subjects need action.

    Calibrated so that sitting exactly at the threshold already carries
    meaningful risk (one bad week tips you under it), well above the
    threshold is Safe, and well below it is High Risk regardless of trend.
    """
    # Distance below/above threshold drives most of the score; being AT the
    # threshold starts you at a baseline of 40 (borderline Moderate).
    distance_component = (threshold_pct - pct) * 2.5
    # A declining trend makes any given % riskier; an improving trend eases it,
    # but trend can only nudge the score, never override the raw percentage.
    trend_component = np.clip(-slope * 4, -15, 15)
    score = np.clip(distance_component + trend_component + 40, 0, 100)
    return round(float(score), 1)


def classify_risk(score: float) -> str:
    if score < 35:
        return "Safe"
    if score < 65:
        return "Moderate"
    return "High Risk"


def build_message(subject: str, pct: float, risk_level: str, bunks: int,
                   needed: int, trend_label: str, worst_day: str | None,
                   projected: float, threshold_pct: float) -> str:
    """Compose a plain-language recommendation, combining the rule-based
    math with the trend and day-pattern signals."""
    parts = []

    if risk_level == "Safe":
        parts.append(
            f"You're comfortably above the {threshold_pct:.0f}% mark at {pct:.1f}%. "
            f"You can afford to miss {bunks} more class{'es' if bunks != 1 else ''} "
            f"and still stay compliant."
        )
    elif risk_level == "Moderate":
        parts.append(
            f"You're at {pct:.1f}%, close to the {threshold_pct:.0f}% line. "
            f"You have about {bunks} safe bunk{'s' if bunks != 1 else ''} left — "
            f"use them carefully."
        )
    else:
        if needed > 0:
            parts.append(
                f"You're at {pct:.1f}%, below the {threshold_pct:.0f}% requirement. "
                f"Attend the next {needed} class{'es' if needed != 1 else ''} in a row "
                f"with zero absences to get back on track."
            )
        else:
            parts.append(f"You're at {pct:.1f}%, right at the edge — don't miss the next class.")

    if trend_label == "Declining":
        parts.append("Your attendance has been trending down over recent weeks.")
    elif trend_label == "Improving":
        parts.append("Good news — your attendance has been trending upward recently.")

    if worst_day:
        parts.append(f"You tend to skip {subject} most often on {worst_day}s — watch out for that day.")

    if projected < threshold_pct and risk_level != "High Risk":
        parts.append(f"At the current trend, you're projected to drop to ~{projected:.1f}% in 4 weeks.")

    return " ".join(parts)


def recommend(subjects: list[dict], threshold: float = DEFAULT_THRESHOLD) -> list[dict]:
    """Take the per-subject stats from data_processor and produce a full
    ranked list of recommendations, riskiest subject first."""
    threshold_pct = threshold * 100
    recs = []
    for s in subjects:
        bunks, needed = safe_bunks(s["attended"], s["total_classes"], threshold)
        projected = project_attendance(s["weekly_series"], weeks_ahead=4)
        score = risk_score(s["attendance_pct"], s["trend_slope"], threshold_pct)
        level = classify_risk(score)
        message = build_message(
            s["subject"], s["attendance_pct"], level, bunks, needed,
            s["trend_label"], s["worst_day"], projected, threshold_pct
        )
        recs.append({
            "subject": s["subject"],
            "risk_level": level,
            "risk_score": score,
            "safe_bunks": bunks,
            "classes_needed": needed,
            "message": message,
            "projected_pct_4wk": projected,
        })

    return sorted(recs, key=lambda r: r["risk_score"], reverse=True)
