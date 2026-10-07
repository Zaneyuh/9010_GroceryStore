"""Entry point for the ML microservice, invoked by the Node backend.

Contract (see server/services/forecast.service.ts):
  * one JSON request on stdin, e.g. {"action": "health"} or {"action": "forecast", ...}
  * one JSON response on stdout
  * logs and errors on stderr; exit code 1 on failure

Self-test from a terminal:
  python ml_service/predict.py --health
"""

from __future__ import annotations

import importlib
import json
import platform
import sys
from typing import Any, Callable

REQUIRED_PACKAGES = {
    "xgboost": "xgboost",
    "catboost": "catboost",
    "lightgbm": "lightgbm",
    "scikit-learn": "sklearn",
    "pandas": "pandas",
    "numpy": "numpy",
}


def health(_payload: dict[str, Any]) -> dict[str, Any]:
    """Reports the Python version and whether each required package imports."""
    packages: dict[str, str | None] = {}
    for name, module_name in REQUIRED_PACKAGES.items():
        try:
            module = importlib.import_module(module_name)
            packages[name] = str(getattr(module, "__version__", "installed"))
        except Exception as exc:  # noqa: BLE001 - any import failure means "not usable"
            print(f"[ml] {name} not available: {exc}", file=sys.stderr)
            packages[name] = None
    return {
        "status": "ok" if all(packages.values()) else "missing_packages",
        "python": platform.python_version(),
        "packages": packages,
    }


def forecast(payload: dict[str, Any]) -> dict[str, Any]:
    from train import forecast_product

    return forecast_product(payload)


ACTIONS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "health": health,
    "forecast": forecast,
}


def main() -> int:
    try:
        if "--health" in sys.argv:
            payload: dict[str, Any] = {"action": "health"}
        else:
            raw = sys.stdin.read()
            payload = json.loads(raw) if raw.strip() else {}

        action = payload.get("action", "forecast")
        handler = ACTIONS.get(action)
        if handler is None:
            raise ValueError(f"Unknown action: {action!r}")

        result = handler(payload)
        sys.stdout.write(json.dumps(result))
        sys.stdout.flush()
        return 0
    except Exception as exc:  # noqa: BLE001 - report every failure to Node on stderr
        print(f"[ml] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
