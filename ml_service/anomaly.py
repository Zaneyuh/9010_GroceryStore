"""Anomaly detection on per-cashier, per-shift transaction features.

Planned features per session: transaction count, average and max amount, void count,
refund count, discount total, share of sales outside normal hours.
Detector: scikit-learn IsolationForest (or OneClassSVM), alongside the rule checks done in
server/services/anomaly.service.ts. Built in the AI Insights step.
"""

from __future__ import annotations

from typing import Any


def detect_anomalies(sessions: list[dict[str, Any]], contamination: float = 0.05) -> list[dict[str, Any]]:
    """Returns one {session_id, score, is_anomaly, reasons} entry per input session."""
    raise NotImplementedError("Anomaly detection is added in the AI Insights step.")
