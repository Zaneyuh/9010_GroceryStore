"""Wrappers for the four forecasting models.

Each builder imports its library lazily, so `predict.py --health` and the reorder-level
fallback still work when a library is missing. Hyperparameters are starting values and
will be tuned when the models are trained (AI Insights step).
"""

from __future__ import annotations

from typing import Any, Callable

RANDOM_STATE = 42

# Order matters: when backtest errors tie, the earlier model wins.
MODEL_NAMES = ("xgboost", "catboost", "lightgbm", "random_forest")


def _xgboost() -> Any:
    from xgboost import XGBRegressor

    return XGBRegressor(n_estimators=300, max_depth=4, learning_rate=0.05, subsample=0.9, random_state=RANDOM_STATE)


def _catboost() -> Any:
    from catboost import CatBoostRegressor

    return CatBoostRegressor(iterations=300, depth=4, learning_rate=0.05, random_seed=RANDOM_STATE, verbose=False)


def _lightgbm() -> Any:
    from lightgbm import LGBMRegressor

    # min_child_samples is lowered from the default 20 because per-product histories are short.
    return LGBMRegressor(
        n_estimators=300, num_leaves=15, min_child_samples=5, learning_rate=0.05, random_state=RANDOM_STATE, verbose=-1
    )


def _random_forest() -> Any:
    from sklearn.ensemble import RandomForestRegressor

    return RandomForestRegressor(n_estimators=300, max_depth=8, random_state=RANDOM_STATE, n_jobs=-1)


BUILDERS: dict[str, Callable[[], Any]] = {
    "xgboost": _xgboost,
    "catboost": _catboost,
    "lightgbm": _lightgbm,
    "random_forest": _random_forest,
}


def build_model(name: str) -> Any:
    """Returns an unfitted regressor with a scikit-learn style fit/predict interface."""
    try:
        return BUILDERS[name]()
    except KeyError as exc:
        raise ValueError(f"Unknown model {name!r}; expected one of {MODEL_NAMES}") from exc
