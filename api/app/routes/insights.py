from fastapi import APIRouter, Depends, Query
from beanie import PydanticObjectId
from typing import Optional
from ..models.user import User
from ..models.session import Session
from ..auth.deps import get_current_user
from ..schemas.insights import InsightsOut
from ..ml.features import extract_features
from ..ml.anomaly import detect_anomalies
from ..ml.recommendations import build_recommendations
from ..ml.narrative import build_narrative
from ..ml.games import axis_for_game, secondary_axes_for_game

router = APIRouter(prefix="/insights", tags=["insights"])


def _compute_trends(sessions):
    if len(sessions) < 3:
        return {}
    roms = [s.features.get("rom", 0) for s in sessions if s.features]
    scores = [s.score for s in sessions]
    trends = {}
    if len(roms) >= 3:
        n = len(roms)
        x_mean = (n - 1) / 2
        slope_num = sum((i - x_mean) * (roms[i] - sum(roms) / n) for i in range(n))
        slope_den = sum((i - x_mean) ** 2 for i in range(n))
        slope = slope_num / slope_den if slope_den else 0
        trends["rom"] = {"direction": "up" if slope > 0.5 else "down" if slope < -0.5 else "stable", "slope": round(slope, 2)}
    if len(scores) >= 3:
        n = len(scores)
        x_mean = (n - 1) / 2
        slope_num = sum((i - x_mean) * (scores[i] - sum(scores) / n) for i in range(n))
        slope_den = sum((i - x_mean) ** 2 for i in range(n))
        slope = slope_num / slope_den if slope_den else 0
        trends["score"] = {"direction": "up" if slope > 1 else "down" if slope < -1 else "stable", "slope": round(slope, 2)}
    return trends


@router.get("/{patient_id}", response_model=InsightsOut)
async def get_insights(
    patient_id: str,
    game_type: Optional[str] = Query("game1"),
    user: User = Depends(get_current_user),
):
    sessions = (
        await Session.find(
            {"patient_id": PydanticObjectId(patient_id), "game_type": game_type}
        )
        .sort("-created_at")
        .limit(50)
        .to_list()
    )

    if not sessions:
        return InsightsOut(game_type=game_type or "game1")

    gt = game_type or "game1"
    latest = sessions[0]
    if not latest.features and latest.imu_time_series:
        features = extract_features(latest.imu_time_series, axis_for_game(gt))
        await latest.set({"features": features})
        latest.features = features

    # Бэкфилл признаков по вторичным осям (multi-axis игры) для старых сессий без axis_features.
    sec_axes = secondary_axes_for_game(gt)
    if sec_axes and latest.axis_features is None and latest.imu_time_series:
        computed = {axis: extract_features(latest.imu_time_series, axis) for axis in sec_axes}
        await latest.set({"axis_features": computed})
        latest.axis_features = computed

    axis_features = None
    if sec_axes and latest.axis_features:
        axis_features = {
            axis: {"label": label, "features": latest.axis_features.get(axis)}
            for axis, label in sec_axes.items()
            if latest.axis_features.get(axis)
        }

    history_features = [s.features for s in sessions[1:] if s.features and s.features.get("valid")]

    features = latest.features or {}
    anomaly = detect_anomalies(features, history_features)
    trends = _compute_trends(list(reversed(sessions)))
    recommendations = build_recommendations(features, history_features, anomaly, trends)

    alerts = []
    if anomaly.get("status") == "critical":
        alerts.append({"type": "critical", "message": "Обнаружены признаки боли/усталости"})
    elif anomaly.get("status") == "attention":
        alerts.append({"type": "attention", "message": "Лёгкое отклонение от нормы"})

    narrative = build_narrative(features, anomaly, recommendations, trends)

    return InsightsOut(
        features=features,
        axis_features=axis_features,
        anomaly=anomaly,
        recommendations=recommendations,
        trends=trends,
        narrative=narrative,
        alerts=alerts,
        game_type=game_type or "game1",
        session_count=len(sessions),
    )
