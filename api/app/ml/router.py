from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from .features import extract_features
from .anomaly import detect_anomalies, preload_model, _load_model
from .recommendations import build_recommendations

router = APIRouter(prefix="/ml", tags=["ml"])


class FeaturesRequest(BaseModel):
    imuTimeSeries: List[Dict[str, Any]]
    axis: str = "r"


class PredictRequest(BaseModel):
    features: Optional[Dict[str, Any]] = None
    imuTimeSeries: Optional[List[Dict[str, Any]]] = None
    history: List[Dict[str, Any]] = []
    trends: Dict[str, Any] = {}
    axis: str = "r"


@router.post("/features")
async def compute_features(body: FeaturesRequest):
    return extract_features(body.imuTimeSeries, body.axis)


@router.post("/predict")
async def predict(body: PredictRequest):
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
