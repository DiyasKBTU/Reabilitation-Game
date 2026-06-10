"""
RehabGame ML-service — FastAPI.

Независимый микросервис: принимает признаки/сырой IMU-ряд, возвращает
признаки, сигнал аномалии и рекомендации по слабой стороне. Node-бэкенд
вызывает его из инсайтов ВМЕСТО (или в дополнение к) встроенных JS-сервисов.
Интерфейс ответа совместим с текущим API (docs/ML_CONTRACT.md), фронт не меняется.

Запуск:
    cd ml-service
    pip install -r requirements.txt
    uvicorn app.main:app --reload --port 8000

Документация: http://localhost:8000/docs
"""
from __future__ import annotations
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .schemas import FeaturesRequest, PredictRequest, PredictResponse
from .features import extract_features
from .anomaly import detect_anomalies, preload_model
from .recommendations import build_recommendations
from . import __version__


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Предзагружаем модель при старте — первый запрос не будет тормозить.
    Заменяет устаревший @app.on_event (deprecated в свежих FastAPI)."""
    loaded = preload_model()
    mode = "ml" if loaded else "rule-based (z-score)"
    print(f"[ML-service] Запущен. Режим аномалий: {mode}")
    yield


app = FastAPI(title="RehabGame ML-service", version=__version__, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    import os
    model_path = os.path.join(os.path.dirname(__file__), "models", "anomaly_model.joblib")
    model_loaded = os.path.exists(model_path)
    model_info = {}
    if model_loaded:
        try:
            import joblib
            m = joblib.load(model_path)
            model_info = {
                "modelVersion": m.get("model_version", "unknown"),
                "trainedOn":    m.get("source", "unknown"),
                "nTrain":       m.get("n_train", "?"),
            }
        except Exception:
            pass
    return {
        "status":      "ok",
        "version":     __version__,
        "anomalyMode": "ml" if model_loaded else "rule-based",
        **model_info,
    }


@app.post("/features")
def features(req: FeaturesRequest):
    series = [s.model_dump() for s in req.imuTimeSeries]
    return extract_features(series, req.axis)


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    # Признаки: либо присланы готовыми, либо считаем из сырого ряда
    if req.features and req.features.get("valid") is not False and "rom" in req.features:
        feats = req.features
    elif req.imuTimeSeries:
        feats = extract_features([s.model_dump() for s in req.imuTimeSeries], req.axis)
    else:
        feats = {"valid": False}

    anomaly = detect_anomalies(feats, req.history)
    recs = build_recommendations(feats, history=req.history, anomaly=anomaly, trends=req.trends)
    return PredictResponse(features=feats, anomaly=anomaly, recommendations=recs)


@app.post("/recommendations")
def recommendations(req: PredictRequest):
    if req.features and req.features.get("valid") is not False:
        feats = req.features
    elif req.imuTimeSeries:
        feats = extract_features([s.model_dump() for s in req.imuTimeSeries], req.axis)
    else:
        feats = {"valid": False}
    anomaly = detect_anomalies(feats, req.history)
    return build_recommendations(feats, history=req.history, anomaly=anomaly, trends=req.trends)
