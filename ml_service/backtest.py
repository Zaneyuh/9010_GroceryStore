"""Backtest metrics used to pick the best model per product."""

from __future__ import annotations

from typing import Sequence


def mae(actual: Sequence[float], predicted: Sequence[float]) -> float:
    """Mean absolute error: average units off per period."""
    if len(actual) != len(predicted) or not actual:
        raise ValueError("actual and predicted must be non-empty and the same length")
    return sum(abs(a - p) for a, p in zip(actual, predicted)) / len(actual)


def mape(actual: Sequence[float], predicted: Sequence[float]) -> float | None:
    """Mean absolute percentage error (0.12 = 12%). Days with zero sales are skipped;
    returns None when every actual value is zero."""
    if len(actual) != len(predicted) or not actual:
        raise ValueError("actual and predicted must be non-empty and the same length")
    pairs = [(a, p) for a, p in zip(actual, predicted) if a != 0]
    if not pairs:
        return None
    return sum(abs(a - p) / abs(a) for a, p in pairs) / len(pairs)


def holdout_split(values: Sequence[float], holdout: int) -> tuple[list[float], list[float]]:
    """Splits a time series into (train, test), keeping order: the last `holdout` points are the test set."""
    if holdout <= 0 or holdout >= len(values):
        raise ValueError("holdout must be between 1 and len(values) - 1")
    return list(values[:-holdout]), list(values[-holdout:])


def rank_models(results: dict[str, dict[str, float | None]]) -> list[str]:
    """Orders model names best-first by MAE, then MAPE (None counts as worst)."""
    def key(name: str) -> tuple[float, float]:
        metrics = results[name]
        mape_value = metrics.get("mape")
        return (float(metrics["mae"] or 0.0), float("inf") if mape_value is None else float(mape_value))

    return sorted(results, key=key)
