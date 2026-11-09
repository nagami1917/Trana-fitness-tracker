"""TRANA ML API — duration + fueling prediction service (FastAPI).

Endpoints
---------
GET  /health              liveness + model readiness
GET  /model/info          model card (metrics, features, importances)
POST /predict             duration + fueling in one call (used by Laravel)
POST /predict/duration    duration only
POST /predict/fueling     fueling only (given a known duration)
POST /model/reload        reload artifacts after re-training (admin token)

Deploy on any Python host (Render, Railway, Fly.io, Cloud Run). It is a pure
stateless worker: no database access at inference time.
"""

from __future__ import annotations

import os
import hmac
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from fueling_model.predict import FuelingInput, estimate_met, recommend
from duration_model.model_store import DurationModel, route_metrics
from .schemas import PredictRequest, PredictResponse

app = FastAPI(
    title="TRANA ML API",
    version="1.0.0",
    description="Predicts activity duration and personalized fueling recommendations.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = DurationModel()


def require_api_token(authorization: str = Header(default="")) -> None:
    """Protect prediction endpoints when a shared server-to-server token is configured."""
    expected = os.getenv("ML_API_TOKEN", "")
    if not expected:
        return  # Local development can run without a token; set one for deployments.
    scheme, _, provided = authorization.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(provided.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid prediction service token")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model_ready": model.ready,
        "model_version": (model.card or {}).get("version"),
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


@app.get("/model/info", dependencies=[Depends(require_api_token)])
def model_info() -> dict:
    return model.info()


@app.post("/predict/duration", dependencies=[Depends(require_api_token)])
def predict_duration(payload: PredictRequest) -> dict:
    distance = _effective_distance(payload)
    return model.predict(
        activity_type=payload.activity_type,
        distance_km=distance,
        elevation_gain_m=payload.elevation_gain_m,
        weight_kg=payload.weight_kg,
        history=[h.model_dump() for h in payload.history],
        experience=payload.experience,
    )


@app.post("/predict/fueling", dependencies=[Depends(require_api_token)])
def predict_fueling(payload: PredictRequest, duration_min: float | None = None) -> dict:
    distance = _effective_distance(payload)
    duration = duration_min or model.predict(
        activity_type=payload.activity_type,
        distance_km=distance,
        elevation_gain_m=payload.elevation_gain_m,
        weight_kg=payload.weight_kg,
        history=[h.model_dump() for h in payload.history],
        experience=payload.experience,
    )["minutes"]

    inp = FuelingInput(
        activity_type=payload.activity_type,
        duration_min=duration,
        weight_kg=payload.weight_kg,
        elevation_per_km=payload.elevation_gain_m / max(distance, 0.1),
        avg_speed_kmh=distance / (duration / 60.0),
        sweat_profile=payload.sweat_profile,
        temperature_c=payload.temperature_c,
        daily_carb_target_g=payload.daily_carb_target_g,
    )
    return recommend(inp)


@app.post("/predict", response_model=PredictResponse, dependencies=[Depends(require_api_token)])
def predict_all(payload: PredictRequest) -> PredictResponse:
    distance = _effective_distance(payload)
    duration = model.predict(
        activity_type=payload.activity_type,
        distance_km=distance,
        elevation_gain_m=payload.elevation_gain_m,
        weight_kg=payload.weight_kg,
        history=[h.model_dump() for h in payload.history],
        experience=payload.experience,
    )

    fueling = recommend(
        FuelingInput(
            activity_type=payload.activity_type,
            duration_min=duration["minutes"],
            weight_kg=payload.weight_kg,
            elevation_per_km=payload.elevation_gain_m / max(distance, 0.1),
            avg_speed_kmh=distance / (duration["minutes"] / 60.0),
            sweat_profile=payload.sweat_profile,
            temperature_c=payload.temperature_c,
            daily_carb_target_g=payload.daily_carb_target_g,
        )
    )

    return PredictResponse(
        duration=duration,
        fueling=fueling,
        model={
            "name": (model.card or {}).get("name", "TRANA duration model"),
            "version": (model.card or {}).get("version", "fallback"),
            "metrics": (model.card or {}).get("metrics", {}),
            "served_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
    )


@app.post("/model/reload")
def reload_model(x_admin_token: str = Header(default="")) -> dict:
    expected = os.getenv("ADMIN_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Model reload is not configured")
    if not hmac.compare_digest(x_admin_token.encode(), expected.encode()):
        raise HTTPException(status_code=403, detail="Invalid admin token")
    global model
    model = DurationModel()
    return {"reloaded": True, "model_ready": model.ready, "version": (model.card or {}).get("version")}


def _effective_distance(payload: PredictRequest) -> float:
    """Prefer the drawn route when the client sends one; fall back to the typed distance."""
    metrics = route_metrics(payload.route)
    if metrics.get("distance_km"):
        return max(0.1, metrics["distance_km"])
    return payload.distance_km


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("api.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
