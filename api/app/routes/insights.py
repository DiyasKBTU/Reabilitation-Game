from fastapi import APIRouter, Depends, Query
from beanie import PydanticObjectId
from typing import Optional
from ..models.user import User
from ..models.session import Session
from ..auth.deps import get_current_user, verify_patient_access
from ..schemas.insights import InsightsOut
from ..ml.features import extract_features
from ..ml.multiaxis import analyze_axes
from ..ml.recommendations import build_recommendations
from ..ml.narrative import build_narrative
from ..ml.pattern import classify_pattern
from ..ml.games import analyzed_axes_for_game, axis_for_game, secondary_axes_for_game
from ..ml.validity import is_analyzable, mark_validity
from ..calibration import ensure_baseline, compute_deltas

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
    patient = await verify_patient_access(patient_id, user)   # IDOR-гард + загрузка карточки
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
    analyzed = analyzed_axes_for_game(gt)   # [(ось, подпись), ...]; первая — основная
    primary_axis = axis = axis_for_game(gt)

    # Последняя ВАЛИДНАЯ сессия, а не просто самая свежая: «пустой прогон» (машина/платформа
    # разбилась без управления → ROM≈0) не должен доминировать в дашборде врача и давать
    # ложный вердикт. Признаки старым сессиям без features бэкфиллим по пути (с тем же гардом).
    latest = None
    for s in sessions:
        if not s.features and s.imu_time_series:
            feats = mark_validity(extract_features(s.imu_time_series, axis))
            await s.set({"features": feats})
            s.features = feats
        if is_analyzable(s.features):
            latest = s
            break

    # Ни одной аналитически пригодной сессии (только пустые прогоны / нет данных) → дашборд
    # покажет «нет данных движения» вместо ложного вердикта по мусорной сессии.
    if latest is None:
        return InsightsOut(game_type=gt, session_count=len(sessions))

    # Бэкфилл признаков по вторичным осям (multi-axis игры) для выбранной последней сессии.
    sec_axes = secondary_axes_for_game(gt)
    if sec_axes and latest.axis_features is None and latest.imu_time_series:
        computed = {ax: mark_validity(extract_features(latest.imu_time_series, ax)) for ax in sec_axes}
        await latest.set({"axis_features": computed})
        latest.axis_features = computed

    # baseline аномалий и наклон трендов — только по пригодным сессиям, чтобы пустые
    # прогоны (ROM≈0) не искажали личную норму пациента и динамику.
    analyzable = [s for s in sessions if is_analyzable(s.features)]

    # Признаки оси для сессии: основная — из features, прочие — из axis_features (бэкфилл
    # на лету из сырого ряда для старых сессий, без записи в БД — чтобы GET оставался лёгким).
    def _axis_feats(session, ax):
        if ax == primary_axis:
            return session.features
        f = (session.axis_features or {}).get(ax)
        if f is None and session.imu_time_series:
            f = mark_validity(extract_features(session.imu_time_series, ax))
        return f

    # Текущие признаки и история по КАЖДОЙ анализируемой оси (City Driver: roll + pitch).
    current_by_axis, history_by_axis = {}, {}
    for ax, _label in analyzed:
        cur = _axis_feats(latest, ax)
        if not cur:
            continue
        if ax != primary_axis and not is_analyzable(cur):
            continue   # вторичная ось без реального движения в этой сессии — не анализируем
        current_by_axis[ax] = cur
        hist = []
        for s in analyzable:
            if s is latest:
                continue
            hf = _axis_feats(s, ax)
            if hf and is_analyzable(hf):
                hist.append(hf)
        history_by_axis[ax] = hist

    # Пер-осевой детект + агрегированный (общий) вердикт.
    multi = analyze_axes(analyzed, current_by_axis, history_by_axis)
    anomaly = multi["overall"]

    # Признаки вторичных осей для врача + их собственный пер-осевой вердикт.
    axis_features = None
    if sec_axes and latest.axis_features:
        axis_features = {
            ax: {
                "label": label,
                "features": latest.axis_features.get(ax),
                "anomaly": multi["axes"].get(ax, {}).get("anomaly"),
            }
            for ax, label in sec_axes.items()
            if latest.axis_features.get(ax)
        }

    features = latest.features or {}
    primary_history = history_by_axis.get(primary_axis, [])
    trends = _compute_trends(list(reversed(analyzable)))
    recommendations = build_recommendations(features, primary_history, anomaly, trends)
    # Паттерн движения (норма/спастика/асимметрия/тремор) — по основной оси. Подсказка, не диагноз.
    pattern = classify_pattern(features)

    alerts = []
    if anomaly.get("status") == "critical":
        alerts.append({"type": "critical", "message": "Обнаружены признаки боли/усталости"})
    elif anomaly.get("status") == "attention":
        alerts.append({"type": "attention", "message": "Лёгкое отклонение от нормы"})

    narrative = build_narrative(features, anomaly, recommendations, trends)

    # Калибровка: персональная точка старта + прогресс текущей сессии относительно неё.
    baseline = await ensure_baseline(patient, gt)
    delta_vs_baseline = compute_deltas(features, baseline.get("features") if baseline else None)

    return InsightsOut(
        features=features,
        axis_features=axis_features,
        anomaly=anomaly,
        baseline=baseline,
        delta_vs_baseline=delta_vs_baseline,
        recommendations=recommendations,
        trends=trends,
        narrative=narrative,
        pattern=pattern,
        alerts=alerts,
        game_type=game_type or "game1",
        session_count=len(sessions),
    )
