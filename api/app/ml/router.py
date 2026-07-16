from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from .features import extract_features
from .anomaly import detect_anomalies, preload_model, _load_model
from .recommendations import build_recommendations
from ..auth.deps import get_current_user
from ..schemas.session import MAX_IMU_SAMPLES

# Вычислительные эндпоинты — только для вошедших: без авторизации любой аноним мог
# гонять извлечение признаков на произвольно больших массивах (DoS для VPS 1 ГБ).
# /ml/health остаётся открытым (лёгкий, без вычислений).
router = APIRouter(prefix="/ml", tags=["ml"])
_authed = [Depends(get_current_user)]


def _check_len(series):
    if series and len(series) > MAX_IMU_SAMPLES:
        raise HTTPException(422, f"Слишком длинный ряд IMU: максимум {MAX_IMU_SAMPLES} сэмплов")


class FeaturesRequest(BaseModel):
    imuTimeSeries: List[Dict[str, Any]]
    axis: str = "r"


class PredictRequest(BaseModel):
    features: Optional[Dict[str, Any]] = None
    imuTimeSeries: Optional[List[Dict[str, Any]]] = None
    history: List[Dict[str, Any]] = []
    trends: Dict[str, Any] = {}
    axis: str = "r"


@router.post("/features", dependencies=_authed)
async def compute_features(body: FeaturesRequest):
    _check_len(body.imuTimeSeries)
    return extract_features(body.imuTimeSeries, body.axis)


@router.post("/predict", dependencies=_authed)
async def predict(body: PredictRequest):
    _check_len(body.imuTimeSeries)
    if body.features:
        features = body.features
    elif body.imuTimeSeries:
        features = extract_features(body.imuTimeSeries, body.axis)
    else:
        return {"error": "Нужны features или imuTimeSeries"}

    anomaly = detect_anomalies(features, body.history)
    recommendations = build_recommendations(features, body.history, anomaly, body.trends)
    model = _load_model()
    return {
        "features": features,
        "anomaly": anomaly,
        "recommendations": recommendations,
        "modelVersion": model.get("model_version", "rules-1.0") if model else "rules-1.0",
    }


@router.get("/health")
async def ml_health():
    model = _load_model()
    return {
        "model_loaded": model is not None,
        "model_version": model.get("model_version") if model else None,
        "n_train": model.get("n_train") if model else None,
        "validation": model.get("validation", "none") if model else None,
        "synthetic_only": model.get("synthetic_only") if model else None,
        "metrics_note": model.get("metrics_note") if model else None,
        "mode": "ml" if model else "rule",
    }
