from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ActivityType = Literal["run", "ride", "walk", "hike"]
SweatProfile = Literal["low", "normal", "high"]
Sex = Literal["female", "male", "other"]


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
    distance_km: float = Field(gt=0, le=500)
    elevation_gain_m: float = Field(default=0, ge=0, le=12000)
    weight_kg: float = Field(ge=25, le=250)
    experience_level: int = Field(default=3, ge=1, le=5)

    # Step 4 athlete profile context. Laravel fills these from user_profiles;
    # they are optional so existing clients keep working. Only body mass and the
    # fitness level change the model output today — the rest is carried as
    # validated context for future features and for auditing a prediction.
    age: int | None = Field(default=None, ge=10, le=110)
    sex: Sex = "other"
    height_cm: float | None = Field(default=None, ge=100, le=250)
    fitness_level: int | None = Field(default=None, ge=1, le=5)
    activity_experience: float | None = Field(default=None, ge=0, le=70)

    history: list[HistoryItem] = Field(default_factory=list, max_length=400)
    sweat_profile: SweatProfile = "normal"
    temperature_c: float = Field(default=22, ge=-20, le=55)
    daily_carb_target_g: float | None = Field(default=None, ge=0, le=1200)
    energy_calibration_factor: float = Field(default=1.0, ge=0.5, le=2.0)
    target_hr: float | None = Field(default=None, ge=30, le=240)
    max_hr: float | None = Field(default=None, ge=100, le=240)
    resting_hr: float | None = Field(default=None, ge=30, le=120)
    acwr: float | None = Field(default=None, ge=0, le=5)
    carb_loading: bool = False
    fuel_items: list[dict] = Field(default_factory=list, max_length=30)
    route: list[tuple[float, float]] | None = Field(
        default=None,
        description="Optional [[lat, lng], ...] polyline; used to derive distance when distance_km is omitted",
    )

    @property
    def experience(self) -> int:
        """Step 4's fitness_level wins over the legacy experience_level."""
        return self.fitness_level if self.fitness_level is not None else self.experience_level


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
    kit: dict | None = None
    notes: list[str]


class PredictResponse(BaseModel):
    duration: DurationPrediction
    fueling: FuelingPrediction
    model: dict
