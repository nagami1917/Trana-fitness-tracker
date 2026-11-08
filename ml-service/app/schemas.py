from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ActivityType = Literal["run", "ride", "walk", "hike"]
SweatProfile = Literal["low", "normal", "high"]


class HistoryItem(BaseModel):
    """One past activity, used to learn this athlete's own pace."""

    activity_type: ActivityType
    distance_km: float = Field(gt=0)
    duration_min: float = Field(gt=0)
    elevation_gain_m: float = Field(default=0, ge=0)
    calories: int | None = None
    started_at: str | None = None


class PredictRequest(BaseModel):
    activity_type: ActivityType
    distance_km: float = Field(gt=0, le=400)
    elevation_gain_m: float = Field(default=0, ge=0, le=12000)
    weight_kg: float = Field(gt=25, le=250)
    experience_level: int = Field(default=3, ge=1, le=5)
    history: list[HistoryItem] = Field(default_factory=list, max_length=400)
    sweat_profile: SweatProfile = "normal"
    temperature_c: float = Field(default=22, ge=-20, le=55)
    daily_carb_target_g: float | None = Field(default=None, ge=0, le=1200)
    route: list[tuple[float, float]] | None = Field(
        default=None,
        description="Optional [[lat, lng], ...] polyline; used to derive distance when distance_km is omitted",
    )


class Range(BaseModel):
    low: float
    high: float


class DurationPrediction(BaseModel):
    minutes: float
    hours: float
    range: Range
    pace_min_per_km: float | None = None
    speed_kmh: float
    confidence: float
    reference_speed_kmh: float
    basis: str


class FuelingPrediction(BaseModel):
    intensity: str
    met: float
    calories: dict
    carbs: dict
    sodium: dict
    fluid: dict
    timeline: list[dict]
    notes: list[str]


class PredictResponse(BaseModel):
    duration: DurationPrediction
    fueling: FuelingPrediction
    model: dict
