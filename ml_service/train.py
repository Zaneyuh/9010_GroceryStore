"""Per-product training and forecasting.

Request:  {"action": "forecast", "product_id": 1, "history": [{"date": "2026-09-01", "sales": 12}, ...],
           "horizon": 7, "min_samples": 30}
Response: {"product_id", "model_name", "forecast", "confidence", "backtest_mae", "backtest_mape",
           "is_fallback", "reason"}

Scaffold: the reorder-level fallback (not enough history) works now. Training XGBoost,
CatBoost, LightGBM and Random Forest, backtesting them and choosing the best is built in
the AI Insights step.
"""

from __future__ import annotations

from typing import Any

FALLBACK_MODEL = "reorder_level_fallback"


def _validate(payload: dict[str, Any]) -> tuple[int, list[dict[str, Any]], int, int]:
    product_id = int(payload["product_id"])
    history = payload.get("history") or []
    if not isinstance(history, list):
        raise ValueError("history must be a list of {date, sales}")
    horizon = int(payload.get("horizon", 7))
    min_samples = int(payload.get("min_samples", 30))
    if horizon < 1:
        raise ValueError("horizon must be at least 1")
    return product_id, history, horizon, min_samples


def forecast_product(payload: dict[str, Any]) -> dict[str, Any]:
    product_id, history, horizon, min_samples = _validate(payload)

    if len(history) < min_samples:
        return {
            "product_id": product_id,
            "model_name": FALLBACK_MODEL,
            "forecast": None,
            "confidence": None,
            "backtest_mae": None,
            "backtest_mape": None,
            "is_fallback": True,
            "reason": f"Only {len(history)} day(s) of sales history; {min_samples} needed. Using reorder level.",
        }

    raise NotImplementedError(
        f"ML training for {horizon}-day forecasts is not built yet; it is added in the AI Insights step."
    )
